# Windows / Linux Portability Assessment

Created: 2026-05-08

This assessment is tracked in the repository because Windows/Linux support is a significant architecture topic, not a simple packaging task.

## Conclusion

Implementing Windows or Linux support is now a substantial platform-backend project, not a small packaging task.

Current beta decision: App Audio has been removed as a supported input source. This assessment still documents why the old App Audio path was hard to port, but active cross-platform work should prioritize File source and Audio Input capture.

The current application is structurally macOS-first. The Electron UI and FFmpeg encoding pipeline are mostly reusable, but important capture and routing features are coupled to macOS Core Audio helper behavior. A Windows or Linux build can likely open the UI and may support File source work after validation, but Audio Input, device enumeration, and monitor device routing need platform-specific replacements.

Feature parity on Windows or Linux should be treated as difficult.

## What Is Portable

- Renderer UI structure.
- Icecast configuration and persistence.
- Ogg Opus FFmpeg output pipeline.
- Stereo MP3 output modes, because MP3 encoding and spatial processing are handled in the shared FFmpeg pipeline after backend PCM capture.
- MP3 Shoutcast 1 source relay logic, because it uses Node TCP sockets rather than a platform audio API.
- Stream channel templates up to 7.1.
- File source streaming path, because it uses FFmpeg file input.
- WebAudio-based monitor playback logic in `src/renderer/src/monitor-audio.js`, assuming the runtime supports the required WebAudio APIs.
- KU100 near-field HRTF renderer data and channel mapping logic.

## Future Backend Compatibility For MP3 Stereo Output

This section answers a forward-looking question: if Windows and Linux audio backends are developed after the current macOS work, does the current Opus/MP3/Downmix/HRTF/Shoutcast structure conflict with those future platform backends?

Assessment: the current structure does not require an impossible Windows or Linux backend. The important point is to keep the boundary stable.

Platform backends should stop at capture and optional native monitor playback. `src/main/ffmpeg-manager.js` should remain responsible for the shared stream graph:

- Opus-only output.
- Opus plus stereo MP3 simulcast.
- Stereo MP3 only output.
- MP3 server transport selection between Icecast and Shoutcast 1.
- MP3 audio source selection: L/R stereo pair, stereo downmix, or KU100 near-field HRTF.

This means Windows and Linux backends do not need to implement MP3, Opus, Icecast, Shoutcast, stereo downmix, or KU100 HRTF themselves. They only need to supply a compatible PCM capture contract:

```text
Float32 little-endian PCM
sample rate
channel count
stable pacing into FFmpeg stdin
```

Channel labels/layout should be treated as a required future contract extension for robust
multichannel work. The current shared FFmpeg path mainly consumes sample rate and channel count,
then derives labels from renderer channel-template selection. That is workable for known default
orders, but Windows/Linux backends should eventually report normalized channel order explicitly.

If a platform API naturally captures another format, such as Int16 PCM, planar Float32, or a device-native non-interleaved format, the platform helper should convert it before crossing the backend boundary or explicitly extend the shared input contract. The shared FFmpeg code should not become Windows-specific or Linux-specific.

### Compatibility verdict

The current design is compatible with future Windows/Linux backend development if these constraints are preserved:

- The backend owns capture API details only: WASAPI/ASIO/DirectShow on Windows, PipeWire/PulseAudio/ALSA on Linux.
- The backend emits or exposes PCM with known sample rate and channel count before FFmpeg starts encoding.
- The shared stream graph owns channel selection, Opus encoding, MP3 encoding, downmix, HRTF, meters, and network output.
- Channel labels/layout should be normalized as the backend contract matures. If an OS backend cannot provide labels, the app must fall back to an explicit default channel order and avoid pretending that the mapping is driver-verified.
- Native low-latency monitor playback is optional backend capability. It must not replace or fork the streaming encode pipeline.
- Packaging must include backend helpers and shared HRIR assets, but packaging does not change the backend/encoder boundary.

The design would start to conflict with future backends if any of these happen:

- A Windows or Linux backend directly implements MP3/Opus encoding or Shoutcast/Icecast transport.
- A backend applies its own stereo downmix or HRTF before the shared FFmpeg graph, causing different audio policy per OS.
- A backend emits PCM without stable format metadata and the shared graph guesses channel count or sample rate.
- A backend exposes OS-specific channel labels directly to renderer/FFmpeg without normalization.
- A native monitor path becomes the only way to hear or route audio, instead of an optional capability.

### Windows backend requirements

Windows can maintain the same feature model if the future backend conforms to the shared PCM boundary.

Required backend responsibilities:

- Enumerate Windows capture devices through MMDevice/WASAPI, ASIO, or DirectShow fallback.
- Capture Audio Input into the shared PCM contract.
- Report actual sample rate and channel count before encoding begins.
- Preserve or normalize channel ordering enough for Stereo Pair, Downmix, and KU100 HRTF to be meaningful.
- Keep any native low-latency monitor implementation separate from stream encoding.

What the Windows backend should not do:

- It should not implement a separate MP3 downmix policy.
- It should not generate MP3 or Opus itself.
- It should not own Shoutcast 1 networking.
- It should not hide driver-dependent channel order behind macOS/Core Audio labels.

Windows validation still required:

- Build the Windows helper with `npm run build:audio-helper:win` before Windows beta packaging.
- Confirm the packaged app can find `native/audio-backends/windows/.build/SurroundAudioBackend.exe` from the unpacked app resources.
- Confirm the Windows packaged FFmpeg binary has `libmp3lame` encoding and the `headphone` audio filter available.
- Confirm `resources/ku100-hrir/**` is unpacked and reachable from the packaged Windows app.
- Confirm the Windows backend reports real channel count and sample rate for multichannel input devices.
- Confirm long-run PCM pacing with WASAPI/ASIO and DirectShow fallback.
- Confirm firewall and server behavior for Shoutcast 1 direct TCP relay.

Risk:

- The current Windows build scripts and stable packaging config are packaging scaffolds, not a complete release pipeline for the Windows helper.
- DirectShow fallback may expose only stereo or driver-dependent layouts.
- ASIO/WASAPI channel ordering may not match the macOS/Core Audio labels. If labels are unavailable, the UI should clearly treat the mapping as backend-reported or default-order only.
- Stable Windows Audio Input is still a backend quality issue, not an MP3 pipeline issue.

### Linux backend requirements

Linux can maintain the same feature model if a future PipeWire/PulseAudio backend conforms to the same shared PCM boundary.

Required backend responsibilities:

- Enumerate capture sources through PipeWire first, with PulseAudio or ALSA only as scoped fallback paths.
- Capture Audio Input into the shared PCM contract.
- Report actual sample rate and channel count before encoding begins.
- Normalize channel order or explicitly mark it as backend/default order.
- Gate unavailable backend features through capability reporting instead of exposing broken controls.

What the Linux backend should not do:

- It should not implement a separate MP3 downmix policy.
- It should not generate MP3 or Opus itself.
- It should not own Shoutcast 1 networking.
- It should not depend on one distribution's PipeWire/PulseAudio naming as a global app contract.

Linux validation still required:

- Confirm the Linux packaged FFmpeg binary has `libmp3lame` encoding and the `headphone` audio filter available.
- Confirm `resources/ku100-hrir/**` is unpacked and reachable from the packaged Linux app.
- Confirm the File picker admits the intended test formats. The current audio-file filter does not list `mp3`, although `All Files` can still select one.
- Implement and validate a PipeWire/PulseAudio backend before claiming Audio Input parity.
- Confirm channel ordering and multichannel device exposure under PipeWire/PulseAudio.

Risk:

- Linux distribution audio stacks differ, so Audio Input parity should be gated by backend capability reporting.
- PipeWire/PulseAudio monitor-source behavior is not the same as macOS Core Audio input capture.

### Shared implementation guardrails

To keep future Windows/Linux development feasible, new features should follow this split:

```text
OS backend:
  device enumeration
  capture API
  native permission/runtime diagnostics
  optional native monitor playback
  PCM format reporting

shared main/renderer code:
  input source selection UI
  channel template selection
  Opus/MP3 encoding
  Icecast/Shoutcast output
  Stereo Pair / Stereo Downmix / KU100 HRTF policy
  HRIR asset lookup
  stream meters and logging
```

If a future platform backend needs a different capture format for performance, extend the shared backend contract deliberately. Do not silently add platform branches inside the MP3 or HRTF filter graph.

### Downmix policy note

The current Stereo Downmix policy is intentionally aligned with Monitor Output:

- L/R at `1.0`.
- Center at `0.707` to both sides.
- LFE muted.
- Side/rear channels at `0.707` to their matching side.
- Final `0.707` master gain.

Using `0.707` for center and surround contribution is a common multichannel-to-stereo downmix convention, but it is not the only reasonable policy for live music/DJ material. A future selectable "conservative downmix" profile could reduce side/rear contribution, for example to `0.5` (-6 dB), but that is a product/DSP policy choice and is not implemented in the current beta.

For cross-platform consistency, any future downmix profile must remain in the shared FFmpeg/DSP layer rather than inside a macOS, Windows, or Linux capture backend.

## Monitor Output Portability

The release Audio Input monitor path should prefer the shortest validated route available on the platform. In the current beta that means browser/WebAudio direct monitoring when audio-device access is available. If that direct path is unavailable, the app can fall back to the portable backend PCM monitor path:

```text
backend PCM -> Electron main process -> renderer IPC -> WebAudio Worklet -> output device
```

The backend PCM path is portable, but it is not guaranteed to be low enough latency for live musician monitoring. Lowering renderer buffers and PCM forwarding helps, but the remaining latency may come from Electron/WebAudio scheduling and the operating-system audio output path.

If lower latency is required, the next step is not to add more macOS-specific logic to shared files. The correct architecture is an optional native monitor backend:

```text
platform capture API -> platform native playback API
```

Platform mapping:

- macOS: Core Audio process tap into Core Audio output render path.
- Windows: WASAPI capture/loopback into WASAPI render-client playback path.
- Linux: PipeWire/PulseAudio capture into PipeWire/PulseAudio playback path.

This should be exposed through backend capabilities such as:

```js
{
  webAudioMonitorPlayback: true,
  nativeInputDeviceMonitor: false,
  nativeMonitorPlayback: false,
  nativeMonitorOutputSelection: false,
  lowLatencyAppAudioMonitor: false
}
```

Native monitor support should be optional per OS. Windows/Linux work must not be blocked by a macOS-only native monitor. WebAudio remains the fallback and should continue to carry Binaural HRTF until native DSP is explicitly planned.

## Hard macOS Coupling

### Native Core Audio helper

Files:

- `native/audio-tap-helper/Sources/AudioTapHelper/main.m`
- `scripts/build-audio-tap-helper.sh`
- `src/main/audio-backends/macos/core-audio-helper.js`
- `src/main/audio-backends/macos/device-scanner.js`

The helper is Objective-C and depends on:

- `CoreAudio/AudioHardware.h`
- `CoreAudio/AudioHardwareTapping.h`
- `AudioHardwareCreateProcessTap`
- private aggregate devices
- Core Audio device UID and stream index concepts

The build script calls `xcrun clang`, requires a macOS SDK, and explicitly checks for `AudioHardwareTapping.h`. This has no Windows/Linux equivalent.

Legacy/research helper responsibilities:

- List app/process capture candidates.
- List output streams.
- Capture App Audio PCM for removed/research paths.
- Capture Audio Input PCM.
- Emit raw Float32 PCM to stdout.
- Emit JSON status/format lines to stderr.

Any Windows/Linux implementation needs a new helper or backend with the same contract.

### Removed / Historical App Audio source

App Audio has been removed from the current beta line. If it is reintroduced later, the old macOS
path looked like this:

- Renderer selects App Audio process and output stream.
- `src/main/audio-backends/macos-core-audio.js` delegates to `src/main/audio-backends/macos/core-audio-helper.js`.
- The macOS backend helper spawns `SurroundAudioBackend --stream-pcm`.
- `src/main/ffmpeg-manager.js` reads Float32 PCM from helper stdout.
- FFmpeg receives `f32le` through `pipe:0`.

This is not just "select another FFmpeg input". The old design expected a per-app/process tap with known channels and sample rate. Windows/Linux would need a backend that can either:

- provide equivalent per-app capture, or
- expose a documented limitation such as output-device loopback only.

Without that backend, reintroduced App Audio would not be functional.

### Audio Input source

Current path:

- `src/main/audio-backends/macos/device-scanner.js` uses FFmpeg `avfoundation` to list devices.
- It then merges Core Audio stream metadata from `SurroundAudioBackend --list-input-streams`.
- `src/main/ffmpeg-manager.js` requires `config.inputDeviceUID`.
- `SurroundAudioBackend --stream-audio-input --device-uid ...` produces Float32 PCM.

This is also macOS-only. Windows/Linux need separate device enumeration and PCM capture.

Important point: Audio Input no longer uses direct FFmpeg capture as the main streaming path. It depends on the native helper for stable PCM pacing. That makes porting harder than a simple `ffmpeg -f dshow` or `ffmpeg -f alsa` swap.

### Monitor output device enumeration

Current path:

- `src/renderer/src/renderer.js` uses Chromium `navigator.mediaDevices.enumerateDevices()`.
- Optional output selection uses `navigator.mediaDevices.selectAudioOutput()` when available.

An earlier unused `src/main/monitor-scanner.js` path used FFmpeg `audiotoolbox -list_devices`, but that macOS-specific module has been removed from the beta backend branch.

Renderer monitor playback itself is WebAudio-based, but selecting a specific output device depends on browser/Electron support and permissions. This needs separate validation per platform.

### macOS permissions

Current path:

- `src/main/index.js` uses `systemPreferences.getMediaAccessStatus('microphone')`.
- `systemPreferences.askForMediaAccess('microphone')`.
- macOS privacy settings deep link.

This is mostly guarded by `process.platform === 'darwin'`, but equivalent user guidance and permission handling would be needed on Windows/Linux.

## Platform Packaging Is Not Enough

The current package scripts expose:

- `npm run build:win`
- `npm run build:linux`

Stable Windows/Linux packaging still should not be treated as release support. Packaging can produce
an Electron app shell before the platform backend is release-ready.

The beta Windows path is more advanced than the stable packaging path:

- `electron-builder.beta.yml` unpacks `native/audio-backends/windows/.build/**`.
- `src/main/audio-backends/windows-wasapi.js` can load `SurroundAudioBackend.exe` from the
  unpacked app path.
- `npm run build:beta:win` does not build that helper; it packages whatever helper is already
  present.

The stable `electron-builder.yml` still packages only the macOS helper under `mac.extraResources`.
Linux has no native backend resource yet.

## Likely Windows Path

Minimum viable Windows work from the current branch:

- Follow the Windows-specific guide: [Windows Backend Development Guide](windows-backend-development.md).
- Validate and harden `src/main/audio-backends/windows-wasapi.js`.
- Validate native MMDevice/WASAPI Audio Input capture through `SurroundAudioBackend.exe`.
- Validate ASIO input capture for multichannel devices.
- Keep DirectShow as a fallback path when the native helper is missing.
- Keep App Audio unsupported; WASAPI Process Loopback remains research/reference code.
- Make Windows helper build/package behavior reliable before release.

Candidate APIs:

- WASAPI loopback for output-device capture.
- WASAPI input capture for audio inputs.
- Windows MMDevice API for device enumeration.
- Per-process capture may be possible on newer Windows APIs, but should be treated as a separate research task from simple loopback.

Risk:

- Output loopback is easier than true per-app/process capture.
- Multichannel preservation depends on the selected endpoint format and driver.
- Device/channel layout naming differs from the current Core Audio stream model.
- SmartScreen/signing is a release issue separate from implementation.

Rough difficulty from the current branch:

- File-only Windows build: low to medium; still needs release validation.
- Basic Windows audio-input capture: initial WASAPI/MMDevice and ASIO paths exist; long-run pacing and device compatibility still need testing.
- Basic output-device loopback streaming: medium to high.
- App-level capture with surround preservation: high.
- Reintroducing App Audio with parity to the old macOS process-tap behavior: high.

## Likely Linux Path

Minimum viable Linux backend:

- Add `src/main/audio-backends/linux-*`.
- Implement capture through PipeWire or PulseAudio monitor sources.
- Implement audio-input enumeration/capture.
- Implement sink/source enumeration for monitor routing.
- Gate unsupported features per detected backend.
- Package/declare runtime dependencies.

Candidate APIs:

- PipeWire for modern Linux desktop audio.
- PulseAudio monitor sources for simpler output loopback.
- ALSA for low-level audio inputs, but it is a poor fit for app-level capture.

Risk:

- Linux distributions vary significantly.
- PipeWire/PulseAudio availability differs.
- Sandboxed packages such as snap may need plugs/permissions.
- AppImage depends on host runtime details such as FUSE.
- True per-app capture is not the same as monitor-source capture.
- Multichannel routing depends on sink configuration and desktop audio policy.

Rough difficulty:

- File-only Linux build: low to medium, if unsupported sources are disabled cleanly.
- PulseAudio/PipeWire output loopback streaming: medium.
- Input-device capture with robust device selection: medium.
- App-level capture with surround preservation: high.
- Reintroducing App Audio with parity to the old macOS process-tap behavior: high.

## Architectural Work Remaining Before Porting

The main backend boundary now exists. Remaining work is validation, hardening, and filling missing
platform backends.

Current status and remaining work:

1. Platform backend boundary exists.

   Current shape:

   ```text
   src/main/audio-backends/
     index.js
     macos-core-audio.js
     windows-dshow.js
     windows-wasapi.js
     unsupported.js
   ```

   A future Linux backend would likely add `linux-pipewire.js` or similar.

2. Capability reporting exists, but should continue to mature.

   Example:

   ```js
   {
     inputDeviceCapture: true,
     fileSource: true,
     monitorPlayback: true,
     monitorDeviceEnumeration: true,
     outputLoopbackCapture: false
   }
   ```

3. Renderer UI responds to capabilities for supported source controls.

   Unsupported tabs/options should continue to be disabled with clear labels rather than failing
   after click.

4. Keep direct macOS helper and FFmpeg `avfoundation` calls inside the macOS backend.

   The main process should call the selected backend, not `core-audio-helper` or macOS device scanner modules directly.

5. Keep hardening the stable PCM contract into FFmpeg.

   `ffmpeg-manager.js` remains reusable if each backend emits:
   - raw Float32 PCM stdout/stream
   - sample rate
   - channel count
   - optional channel layout
   - error/status events

6. Split release support from packaging support.

   Packaging scripts can remain, but README/downloads should keep Windows/Linux as preparing until the backend and user workflows pass real tests.

## Can One Shared Standard Cover macOS / Windows / Linux?

Short answer: not for the full feature set.

There is no single OS-level audio capture standard that provides the same features as the old macOS
Core Audio Process Tap research path on Windows and Linux. The realistic answer is to create a
shared internal contract for SurroundStreamer, then implement one backend per OS behind that
contract.

### Candidate shared layers

#### FFmpeg device inputs

FFmpeg looks attractive because it already supports many platform input APIs, but it does not remove platform differences.

Examples:

- macOS: `avfoundation`
- Windows: `dshow`, `wasapi`
- Linux: `alsa`, `pulse`, sometimes PipeWire through Pulse/PipeWire compatibility paths depending on the build

Problems:

- Device naming and enumeration differ per platform.
- App/process capture is not a stable common FFmpeg abstraction.
- Multichannel channel layouts differ per driver/backend.
- Pacing and buffering can differ, which already mattered for Audio Input stability.
- Preserve Surround is not just "read N channels"; it depends on endpoint/session routing.

FFmpeg should remain the common encoder/output layer, but not the only capture abstraction.

#### WebAudio / Electron media APIs

Electron/Chromium APIs are cross-platform, but they do not provide the current full feature set.

Useful for:

- monitor playback
- maybe generic microphone/input capture

Not sufficient for:

- reliable app-specific audio capture
- output-device loopback capture with surround preservation
- native device stream/channel metadata
- deterministic low-latency PCM capture equivalent to the helper path

Also, browser media APIs can be permission- and security-model dependent, and may expose fewer channels than the hardware/backend actually supports.

#### PortAudio / RtAudio / miniaudio / libsoundio

These libraries can help create a shared native helper for input/output devices.

Useful for:

- cross-platform audio-input capture
- cross-platform output-device playback
- possibly simpler monitor device handling

Not sufficient by themselves for:

- per-app/process capture
- output loopback on every OS
- app-audio surround preservation

They are good candidates for a shared "Audio Input" helper, but not a complete replacement for Core Audio Process Tap.

#### JUCE

JUCE is a cross-platform audio framework, but adopting it would be a major architectural choice.

Useful for:

- audio device I/O
- cross-platform audio callback model
- possible future DSP/UI-native work

Not sufficient by itself for:

- per-app capture
- Electron integration without a native helper boundary

JUCE would probably be too heavy if the goal is only to add platform capture helpers.

#### GStreamer

GStreamer can be cross-platform, but the capture plugins and platform behavior still differ.

Useful for:

- media pipeline abstraction
- possible alternative to FFmpeg for some capture/playback scenarios

Risk:

- larger runtime/distribution burden
- still backend-specific for device/app capture
- not obviously simpler than keeping FFmpeg and adding platform helpers

### Best shared standard for this project

The best common standard is not an external OS API. It is an internal helper contract:

```text
SurroundStreamer audio backend contract

Commands:
  --capabilities
  --list-audio-inputs
  --list-output-devices
  --list-apps
  --list-app-output-streams
  --capture-input --device-id <id> [--stream-index <n>]
  --capture-app --app-id <id> [--output-id <id>] [--stream-index <n>]
  --capture-loopback --output-id <id>

stdout:
  raw PCM, preferably 32-bit float little-endian

stderr:
  JSON events:
    {"event":"format","sampleRate":48000,"channels":6,"layout":"5.1","bitsPerChannel":32}
    {"event":"error","message":"..."}
    {"event":"status","message":"..."}
```

Then the Electron/FFmpeg side can stay mostly common:

- receive Float32 PCM
- read JSON format events
- pass PCM to FFmpeg with `-f f32le -ar ... -ac ... -i pipe:0`
- use the same Opus/Icecast output path
- use the same monitor queue and WebAudio monitor path

Platform-specific implementations would sit behind the helper contract:

- macOS helper: Apple Core Audio Process Tap / Core Audio device capture
- Windows helper: Microsoft Core Audio APIs / WASAPI / MMDevice / Audio Session APIs
- Linux helper: PipeWire first, PulseAudio compatibility or ALSA as fallback

This is the closest route to "mostly unchanged builds": the app code sees the same helper contract, while the helper implementation changes per OS.

### What can be built with almost no OS-specific code?

These features can be largely shared:

- File source streaming
- Ogg Opus encoding
- Icecast output
- stream channel template UI
- settings persistence
- logs/About windows
- README/manual/build docs

These features cannot be made common without platform backends:

- App Audio process capture
- App Audio preserve-surround stream selection
- Audio Input PCM capture with stable pacing
- monitor output device enumeration
- per-platform audio permissions and diagnostics

### Practical build structure

Recommended target structure:

```text
native/audio-backends/
  macos/
    .build/SurroundAudioBackend
  windows/
    .build/SurroundAudioBackend.exe
  linux/
    .build/surround-audio-backend

src/main/audio-backends/index.js
  selects packaged helper by process.platform
```

Electron Builder resources:

```yaml
mac:
  extraResources:
    - from: native/audio-backends/macos/.build/SurroundAudioBackend
      to: audio-backend

win:
  extraResources:
    - from: native/audio-backends/windows/.build/SurroundAudioBackend.exe
      to: audio-backend.exe

linux:
  extraResources:
    - from: native/audio-backends/linux/.build/surround-audio-backend
      to: audio-backend
```

This keeps packaging similar while accepting that the native helper differs by platform.

### Final answer on common standard

Common build pipeline: yes, mostly possible.

Common UI and stream pipeline: yes, mostly possible.

Common audio capture implementation: no, not for full feature parity.

Common internal PCM/JSON helper protocol: yes, strongly recommended.

The right approach is not "find one universal audio API." The right approach is "make SurroundStreamer define its own platform-neutral audio backend contract, then implement macOS/Windows/Linux helpers behind it."

## Official API Notes Checked

Windows:

- Microsoft documents Windows Core Audio APIs as a set of user-mode audio APIs including MMDevice API, WASAPI, DeviceTopology API, and EndpointVolume API.
- Microsoft documents WASAPI as the API used to manage audio data flow between an application and audio endpoint devices.
- Microsoft documents process loopback activation through `AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK`, with inclusion/exclusion of audio rendered by a target process tree.
- The process loopback API is Windows-specific and is not the same as Apple Core Audio Process Tap.

Linux:

- PipeWire streams are used to exchange audio data with the PipeWire server.
- PipeWire streams can consume or produce streams and can be connected to specific server ports or nodes.
- PipeWire provides a plausible backend basis, but it is not the same abstraction as Apple Core Audio Process Tap or Microsoft WASAPI process loopback.

Reference URLs:

- https://learn.microsoft.com/en-us/windows/win32/coreaudio/about-the-windows-core-audio-apis
- https://learn.microsoft.com/en-us/windows/win32/coreaudio/wasapi
- https://learn.microsoft.com/en-us/windows/win32/api/audioclientactivationparams/ne-audioclientactivationparams-audioclient_activation_type
- https://learn.microsoft.com/en-us/windows/win32/api/audioclientactivationparams/ns-audioclientactivationparams-audioclient_process_loopback_params
- https://docs.pipewire.org/1.2/page_streams.html

## Practical Recommendation

Do not attempt Windows/Linux full parity immediately.

Recommended staged approach:

1. Add platform capability gating first.
2. Make Windows/Linux builds open without presenting broken source controls. Windows now has a
   WASAPI backend with DirectShow fallback; Linux should keep Audio Input disabled until a Linux
   backend exists.
3. Support File source first on Windows/Linux.
4. Add Windows output-device loopback as a research build.
5. Add Linux PipeWire/PulseAudio monitor-source capture as a research build.
6. Only after loopback works, revisit true per-app capture and surround preservation.

## Current Assessment

Windows/Linux support is not impossible, but the current implementation makes it a significant backend rewrite.

The app should continue to be described as macOS-primary. Windows/Linux should remain "Preparing" in public docs until platform backend boundaries and at least one real capture backend are implemented and tested.
