# Build On Linux

This document is currently being revised.

Linux downloads are marked as `Preparing` because Linux Audio Input capture is not implemented yet. A Linux package created only by Electron Builder would not provide feature parity with the macOS release.

Do not treat `npm run build:linux` or `npm run build:beta:linux` as a supported public release path yet.

## Current Status

- Official Linux release: not available.
- Linux release numbering: use the `0.1.1` line for release-preparation artifacts; the current beta metadata is `0.1.1-beta.10`.
- App Audio capture: removed from the supported input-source UI.
- Audio Input capture: not implemented on Linux.
- File source support: enabled by the shared app/backend capability model, but Linux packaging and release validation are not complete.

## What The Current Linux Build Does

On Linux, the app currently falls through to the shared unsupported backend. This is intentional until
a real Linux audio backend exists.

Current Linux backend capabilities:

- Backend name: `unsupported`.
- File source: enabled by the shared FFmpeg file-input path.
- Audio Input capture: disabled.
- App Audio capture: removed from the current beta line and not a Linux implementation target.
- Monitor playback: limited to shared WebAudio paths where available.
- Linux package artifacts are development experiments only, not public release artifacts.

A Linux package built today can be useful for checking launch, UI gating, File source behavior,
FFmpeg packaging, logs, About window, and Icecast settings. It must not be described as Linux Audio
Input support.

## Required Work

Linux support needs a Linux Audio Input backend. The first backend should be PipeWire-first because
modern desktop distributions expose device graph and stream metadata through PipeWire more cleanly
than through ALSA, and because PipeWire is a better match for a helper that owns capture and pacing.
PulseAudio can be added later as a compatibility fallback. ALSA should be treated as a narrow
hardware-device fallback, not the primary desktop-audio strategy.

For the current platform assessment, see:

- [Windows / Linux Portability Assessment](windows-linux-portability-assessment.md)

## Implementation Procedure For Linux Audio Input

1. Add a Linux backend module under `src/main/audio-backends/`, for example `linux-pipewire.js`.
2. Update `src/main/audio-backends/index.js` so `process.platform === 'linux'` selects the Linux backend instead of `UnsupportedAudioBackend`.
3. Start with conservative capabilities:
   - `platform: 'linux'`
   - `backendName: 'linux-pipewire'` when the helper/runtime are available, or `linux-pipewire-pending` when they are missing
   - `appAudioCapture: false`
   - `appAudioPerProcess: false`
   - `appAudioSurroundPreserve: false`
   - `inputDeviceCapture: false` until capture is proven
   - `inputDeviceMonitor: false` until preview monitor is proven
   - `nativeInputDeviceMonitor: false` for the first implementation
   - `fileSource: true`
   - `monitorPlayback: true`
   - `monitorDeviceEnumeration: false` until output-device routing is implemented
   - `outputLoopbackCapture: false`
4. Implement Linux device enumeration before enabling capture:
   - `listInputDevices()`
   - `listInputStreams()`
   - stable device IDs suitable for `config.inputDeviceUID`
   - channel count and sample-rate reporting
5. Add a native helper under `native/audio-backends/linux/`, with an initial output path such as:

```text
native/audio-backends/linux/.build/surround-audio-backend
```

6. Keep the helper command surface narrow:

```text
--probe
--list-input-devices
--stream-input-device --device-id <pipewire-node-or-port-id> [--sample-rate <n>] [--channels <n>]
```

7. Implement `spawnInputDevicePCMStream(options)` so it returns a child process compatible with the existing main-process pipe path:
   - raw 32-bit float little-endian PCM on stdout
   - newline-delimited JSON status/format/error events on stderr
   - a startup `format` event before streaming is treated as ready
8. Only after streaming and preview are tested, set:
   - `inputDeviceCapture: true`
   - `inputDeviceMonitor: true` if preview monitor works through the shared backend PCM/WebAudio path
9. Keep App Audio methods unsupported. They may exist only to satisfy the shared backend shape.
10. Validate File source separately from Audio Input. File source working does not prove the Linux audio backend is ready.

## Backend PCM Contract

Linux Audio Input must match the existing FFmpeg manager contract. The backend is responsible for
stable capture and pacing; FFmpeg is not expected to directly open `alsa`, `pulse`, or `pipewire`
devices for the main Audio Input path.

Required stream contract:

- stdout: raw Float32 little-endian PCM.
- stderr: newline-delimited JSON events.
- first usable startup event:
  `{"event":"format","sampleRate":48000,"channels":2,"bitsPerChannel":32}`
- error event:
  `{"event":"error","message":"..."}`
- status/log event:
  `{"event":"status","message":"..."}`

The main process passes backend PCM to FFmpeg as:

```text
-f f32le -ar <sampleRate> -ac <channels> -i pipe:0
```

Do not implement Linux Audio Input as only an Electron Builder packaging change or as only an FFmpeg
input-device flag swap.

## Suggested Linux Backend Order

Recommended implementation order:

1. Keep current unsupported backend behavior and verify the Linux package opens with Audio Input disabled.
2. Smoke-test File source streaming and File preview monitor on a Linux desktop.
3. Build a PipeWire-first helper for Audio Input enumeration.
4. Add PipeWire capture that emits the shared Float32 PCM contract.
5. Add PulseAudio compatibility only if needed for target distributions.
6. Treat ALSA as a narrow fallback for hardware-device input, not as the primary desktop-audio strategy.
7. Add runtime dependency notes for AppImage, deb, and snap separately.
8. Promote Linux from `Preparing` only after Audio Input and File workflows pass real Linux smoke tests.

## Packaging Note

Electron Builder configuration may still be useful for local experiments, but packaging alone is not enough for a public Linux release. The blocker is the missing Linux audio capture backend and Linux release validation.

Release packaging no longer uses the `ffmpeg-static` npm package. Before running Linux packaging,
place a vetted Linux x64 FFmpeg binary at:

```text
resources/ffmpeg/linux-x64/ffmpeg
```

Then validate the Linux FFmpeg binary:

```bash
npm run check:ffmpeg-license:linux
```

The check rejects `--enable-nonfree` builds and rejects `--enable-gpl` unless
`SURROUNDSTREAMER_ALLOW_GPL_FFMPEG=1` is set for an intentional GPL distribution. The Linux binary
must provide libopus, libmp3lame, Ogg/MP3/f32le muxing, file/pipe/icecast protocols, and the audio
filters used by File source and monitor processing.

After packaging, run a packaged-artifact license check against the unpacked app or output
directory:

```bash
npm run check:package-licenses -- dist
```

This fails if `ffmpeg-static` is present or if the packaged `ffmpeg` binary fails the FFmpeg
distribution check. The Linux package should include only `resources/ffmpeg/linux-x64/ffmpeg` plus
the shared FFmpeg notices/licenses. Update `resources/ffmpeg/THIRD_PARTY_NOTICES.md` and
`resources/ffmpeg/licenses/` for the exact Linux FFmpeg binary before publishing any Linux artifact.

The beta packaging target is reserved for development experiments. If a Linux beta package is generated from `beta/cross-platform-backend`, it should use the `0.1.1` release line with beta metadata, currently `0.1.1-beta.10`. Do not generate new Linux artifacts with the old `0.1.0` release number.

For beta experiments, use:

```bash
npm run build:beta:linux
```

This uses `electron-builder.beta.yml`, whose current beta metadata is `0.1.1-beta.10` and product
name is `SurroundStreamer-beta-0.1.1`.

After a Linux helper exists, add a Linux helper build script, for example:

```json
"build:audio-helper:linux": "..."
```

Then update `build:linux` and `build:beta:linux` so they build the Linux helper before Electron
Builder. Package the helper as a platform resource named `audio-backend`, matching the macOS and
Windows resource naming pattern:

```yaml
linux:
  extraResources:
    - from: native/audio-backends/linux/.build/surround-audio-backend
      to: audio-backend
```

Add `native/audio-backends/linux/.build/**` to `asarUnpack` only if the implementation relies on an
unpacked fallback path instead of `extraResources`.

Do not publish Linux artifacts from this path as supported downloads until a Linux backend exists and
has been validated.

## Linux Validation Checklist

Before any Linux beta artifact is advertised beyond development testing:

- App launches on a target Linux desktop.
- Backend log reports the expected Linux backend name, not `unsupported`.
- File source can select, preview, stream, and stop cleanly.
- Audio Input device list is populated by the Linux backend.
- Audio Input stream starts, emits a format event, reaches FFmpeg, reaches Icecast, and stops without orphaned processes.
- Channel count and sample rate from the backend match what FFmpeg receives.
- Audio Input monitor behavior is tested or explicitly disabled by capabilities.
- App Audio remains absent/unsupported.
- AppImage, deb, and snap runtime dependency and permission behavior is documented separately.
