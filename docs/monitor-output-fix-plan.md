# Monitor Output Fix Plan

## Current Status

The previous fix was rejected. The Mac app produced noise in Stereo downmix and Binaural monitor modes, and those modes behaved as if only ch1/ch2 were present. Stereo Pair could audition individual channel pairs, so the failure was not proven to be the device itself. The plan below superseded the earlier LFE/ch3-focused plan.

This plan has now been implemented and verified. The submitted app build is only acceptable because the actual WebAudio monitor graph is automatically rendered and checked channel-by-channel.

Final implementation note:

- The earlier worklet-topology change to one multichannel output was not kept. It regressed Stereo Pair ch3+ on the Mac backend path, so the final fix preserves the previously working one-output-per-source-channel worklet topology.
- The final Stereo downmix/Binaural fix keeps the real 16ch PCM frame stride intact, but limits the monitor graph to the selected stream channel indexes. This prevents unselected device channels from being mixed into Stereo downmix/Binaural while still preserving ch3-ch8 when those channels are selected.
- The final PCM transport fix preserves partial frames across stdout/IPC chunks. Real process chunks do not guarantee `channels * 4` byte alignment, so the renderer must not drop trailing bytes per chunk.
- The FFmpeg pre-render architecture was rejected for performance monitoring because 200 ms latency is not playable.
- The current architecture keeps backend PCM low-latency and performs Stereo downmix/Binaural directly inside the monitor AudioWorklet render callback. The worklet emits two mono outputs for these modes instead of building a renderer WebAudio fanout graph or using FFmpeg pre-rendering.
- The previous 2ch pre-render code path has been removed, not merely disabled. The invariant is that Mac backend input monitoring preserves the real source channel count until the AudioWorklet render callback reads monitor source indexes.
- Correction after the latest user report: device-input Stereo downmix and Binaural must not inherit the stream/channel selection list. Those modes monitor the actual source PCM channels reported by the device/backend format. Otherwise an L/R stream selection `[0,1]` causes ch3+ to be dropped even though Stereo Pair can still audition those pairs.
- Correction after the later user report: the production app loads `src/renderer/public/monitor-worklet.js`, not `src/renderer/src/monitor-worklet.js`. The public worklet must be synchronized before every dev/start/build run, and verification must render the public/built worklet. Otherwise source-level tests can pass while the app still ships the stale worklet that outputs only LR.

## Problem Statement

For Mac Audio Input monitor output:

- Stereo Pair mode can play each selected channel pair.
- Stereo downmix and Binaural modes become noise.
- Stereo downmix and Binaural modes only pick up LR/ch1/ch2 instead of ch1-ch8.

The fix must prove that ch1-ch8 each produce finite, non-clipped stereo output in both Stereo downmix and Binaural modes. Ch3/C, ch4/LFE, ch5-ch6 surrounds, and ch7-ch8 rear/side channels must not be silent unless explicitly muted.

## Findings

- The app has two monitor source paths:
  - browser direct `getUserMedia` path uses `MediaStreamAudioSourceNode -> ChannelSplitterNode`;
  - backend PCM path uses `AudioWorkletNode` fed by native helper chunks.
- The WebAudio specification says `ChannelSplitterNode` only has active outputs equal to the input stream channel count. Outputs above the real stream channel count are silence. Therefore if Chromium opens the Mac input as 2ch, an app-side `createChannelSplitter(16)` cannot recover ch3-ch16.
- The current browser direct code treats missing `track.getSettings().channelCount` as usable and then falls back to `config.inputChannels`. That can falsely declare a 2ch browser stream to be 16ch.
- The current backend PCM `AudioWorkletNode` exposes one mono output per channel. Stereo Pair only connects two outputs at a time, while downmix/binaural connect many outputs. The graph under test is therefore different between the mode that works and the modes that fail.
- The AudioWorklet spec supports multiple outputs, but it also explicitly distinguishes multiple outputs from a single multichannel output. SurroundWebPlayer uses the safer, proven shape for this product: one multichannel source into `ChannelSplitterNode`, then per-channel panners.
- SurroundWebPlayer routes all channels through `ChannelSplitterNode` and `PannerNode`; its LFE path is filtered, not muted. The app's Binaural path currently uses custom KU100 convolver paths for matching labels before falling back to `PannerNode`, so it is not the same graph.
- The previous verification script tested gain tables and some FFmpeg filter strings, but it did not render the real renderer WebAudio graph. That is why a noisy/broken graph could still pass.

## Root Cause Hypotheses To Prove Or Disprove

1. Browser direct false positive: Mac/Electron provides a 2ch `MediaStream`, but `getSettings().channelCount` is absent or unreliable, so the app assumes 16ch and routes silent splitter outputs for ch3+.
2. Backend worklet graph shape: using `numberOfOutputs = channels` creates a different source topology from SurroundWebPlayer. Downmix/binaural exercise all outputs simultaneously and may be exposing a graph or output-index bug not hit by Stereo Pair.
3. Binaural renderer mismatch: custom KU100 `ConvolverNode` routing or gain normalization can create noise even when the source PCM is valid. The monitor path should first match SurroundWebPlayer's `PannerNode` behavior, then reintroduce KU100 only behind tests.
4. PCM normalization regression: native helper conversion may still output unexpected channel order or bad frame alignment. This must be checked with per-channel signal identity tests, not inferred from logs.

## Revised Implementation Plan

1. Freeze the failing state in docs and stop relying on the previous green verification.
2. Add a renderer/WebAudio graph verification harness:
   - feed deterministic Float32 PCM into the same monitor worklet used by the app;
   - render Stereo downmix and Binaural through browser/Electron WebAudio, not just pure JS gain math;
   - test one active channel at a time for ch1-ch8;
   - fail on silence, NaN/Infinity, sustained full-scale output, unexpected clipping, or energy appearing only when ch1/ch2 are active.
3. Add a browser direct channel probe:
   - after `getUserMedia`, measure actual splitter outputs with one-channel analyzers where possible;
   - if `channelCount` is absent, lower than requested, or unproven, do not use browser direct for downmix/binaural.
4. Change Mac downmix/binaural monitor source selection:
   - Stereo Pair may use browser direct when auditioning exposed pairs;
   - Stereo downmix and Binaural must use backend PCM unless browser direct proves all requested discrete channels are present.
5. Investigate backend PCM worklet topology against SurroundWebPlayer:
   - emit one multichannel output from `AudioWorkletNode` with `outputChannelCount: [channels]`;
   - split it with `ChannelSplitterNode(channels)`;
   - keep Stereo Pair, Downmix, and Binaural on the same splitter-based source graph.
   - Result: this was tested and not kept because it regressed Stereo Pair ch3+ on the real Mac backend path. The final submitted version keeps the previously working one-output-per-source-channel topology.
6. Align Binaural monitor rendering with SurroundWebPlayer first:
   - use `PannerNode` for all channels in the monitor path;
   - keep LFE audible through a low-pass filter instead of muting it;
   - only keep/re-enable KU100 convolver mode after the WebAudio render test proves it is finite and non-noisy for ch1-ch8.
7. Recheck native helper PCM separately:
   - validate exact frame byte count and channel count from helper output;
   - test synthetic per-channel impulse/sine through the helper/backend boundary if possible;
   - do not use helper log shape as proof of audible correctness.
8. Build the Mac app only after all verification gates pass.
9. Carry selected monitor channel indexes through the backend monitor graph:
   - keep the PCM parser and frame stride at the real device channel count;
   - connect only selected stream channel indexes for Stereo downmix and Binaural;
   - use the same selected index list for monitor-output meters.
10. Preserve PCM frame alignment across process chunk boundaries:

- treat `channels * 4` bytes as the frame size for Float32 interleaved PCM;
- keep partial frame bytes from each chunk;
- prepend them to the next chunk before posting to the monitor worklet;
- test with deliberately non-frame-aligned chunk sizes.

11. Move Stereo downmix/Binaural monitor rendering into the AudioWorklet:

- capture the same backend interleaved PCM as Stereo Pair uses;
- for Stereo Pair, keep one mono output per source channel;
- for Stereo downmix/Binaural, have the worklet emit two mono outputs;
- mix selected channels directly per render quantum inside the worklet;
- keep device input monitor low-latency for all monitor modes.

12. Remove all Mac monitor paths that pre-render source PCM to 2ch before renderer/worklet:

- remove the filtered FFmpeg preview monitor function;
- remove `renderedMonitorOutput` handling;
- verify no source or built output contains that path.

13. Fix device-input monitor source indexes:

- for device input Stereo downmix and Binaural, set monitor source indexes to every current source PCM channel `0..N-1`;
- keep file-input downmix/binaural tied to selected stream channels;
- add a regression test proving `[0,1]` selected channels on an 8ch device source still monitors ch1-ch8.

14. Fix public/built AudioWorklet drift:

- synchronize `src/renderer/src/monitor-worklet.js` to `src/renderer/public/monitor-worklet.js` before dev/start/build;
- verify the public worklet, not only the source worklet;
- verify the built `out/renderer/monitor-worklet.js` when it exists;
- fail if the public worklet is missing `outputMode`, `monitorChannelIndexes`, or `mixStereoFrame`.

## Verification Gate

Required before submitting another app:

- Done: Renderer graph test: Stereo downmix ch1-ch8 all produce finite nonzero stereo output.
- Done: Renderer graph test: Binaural ch1-ch8 all produce finite nonzero stereo output.
- Done: Noise checks: no NaN/Infinity, no continuous full-scale output, no clipping above the chosen threshold.
- Done: Source-path test: browser direct downmix/binaural refuses or falls back when actual discrete channels are not proven.
- Done: Backend PCM test: pushed fragmented Float32 chunks remain frame-aligned and ch1-ch8 identity is preserved.
- Done: `npm run build:audio-helper` passes.
- Done: `npm run build` passes.
- Done: `npm run build:mac:dir` passes.
- Done: The final `.app` timestamps and bundled `app.asar`/helper binaries are checked after packaging.
- Done: Live CoreAudio verification feeds real `Pro Tools Audio Bridge 16` PCM into the Electron monitor graph and verifies C/LFE, SL/SR, Stereo downmix, and Binaural outputs after packaging.
- Done: Fragmented-chunk verification feeds non-frame-aligned byte chunks and confirms Stereo downmix/Binaural remain finite, non-silent, and non-clipping.
- Done: Worklet direct-mix verification confirms ch1-ch8 Stereo downmix/Binaural are finite, non-silent, and non-clipping after packaging.
- Done: Source and build output contain no `renderedMonitorOutput`, `startFilteredInputDeviceMonitor`, `shouldUsePreRenderedStereoMonitor`, `filtered audio input preview`, or `16ch -> 2ch` path.
- Done after latest correction: monitor index selection test proves device-input Stereo downmix/Binaural use all source channels even when selected stream channels are `[0,1]`.
- Done after latest correction: packaged app was rebuilt and live CoreAudio verification passed against `Pro Tools Audio Bridge 16`, with finite non-silent Stereo downmix and Binaural output.
- Done after later correction: public/built AudioWorklet drift is fixed and verified. The packaged app now includes the worklet that mixes Downmix/Binaural inside the worklet instead of the stale worklet that only emitted LR.

## References Checked

- W3C Web Audio API: `ChannelSplitterNode` active outputs equal the real input channel count, and inactive outputs are silence.
- W3C Web Audio API: `ChannelMergerNode` combines mono inputs in input order and silent unconnected inputs remain silent channels.
- W3C Web Audio API: `AudioWorkletNodeOptions.outputChannelCount` configures each output, while callback output channel matching differs for single-output and multi-output nodes.
- W3C Media Capture and Streams: `channelCount` is a constrainable setting, and `getSettings()` reports settings that may differ from measured performance.
