# Windows Backend Development Guide

Last updated: 2026-05-08

Branch: `beta/cross-platform-backend`

This document is for Windows-side development. The goal is to let a Windows developer work on Windows support without breaking the current macOS beta app.

## Current Baseline

The macOS beta backend is the current working reference.

Verified on macOS:

- `npm run build`
- `npm run build:beta:mac`
- `codesign --verify --deep --strict --verbose=2 dist/beta/mac-arm64/SurroundStreamer-beta-0.1.1.app`
- The packaged macOS app contains `Contents/Resources/audio-backend`

Current Windows status:

- Official Windows release: not available.
- Windows beta packaging script exists: `npm run build:beta:win`
- `process.platform === 'win32'` now selects `src/main/audio-backends/windows-wasapi.js`.
- File source is the first Windows validation target.
- App Audio capture uses a native WASAPI Process Loopback helper when built.
- Windows App Audio support intentionally requires Windows 10 Build 20348 or later.
- Input Device capture now prefers native MMDevice/WASAPI through the Windows helper, with the earlier DirectShow/FFmpeg backend retained as fallback.
- The earlier DirectShow loopback-device bridge remains a development reference, but the selected backend targets true per-process capture through WASAPI.
- Preserve-surround App Audio capture is not implemented on Windows.

## Do Not Break macOS

These files are macOS-owned. Do not rewrite them while implementing Windows support unless the change is explicitly platform-neutral and macOS is retested afterward.

```text
native/audio-tap-helper/Sources/AudioTapHelper/main.m
native/audio-backends/macos/.build/SurroundAudioBackend
scripts/build-audio-tap-helper.sh
src/main/audio-backends/macos-core-audio.js
src/main/audio-backends/macos/core-audio-helper.js
src/main/audio-backends/macos/device-scanner.js
electron-builder.yml
```

These shared files may be edited, but must remain compatible with macOS:

```text
src/main/audio-backends/index.js
src/main/audio-backends/unsupported.js
src/main/ffmpeg-manager.js
src/main/ipc-handlers.js
src/preload/index.js
src/renderer/src/renderer.js
electron-builder.beta.yml
package.json
```

When editing shared files, keep the existing macOS backend behavior intact:

- `process.platform === 'darwin'` must continue to select `macos-core-audio`.
- macOS App Audio must continue to use the packaged `audio-backend`.
- macOS Input Device capture must continue to use backend Float32 PCM into FFmpeg.
- Unsupported platforms must continue to return safe capability flags instead of throwing during app startup.

## Required Windows Backend Shape

Add Windows support behind the existing backend selector.

Suggested files:

```text
src/main/audio-backends/windows-dshow.js
src/main/audio-backends/windows-wasapi.js
src/main/audio-backends/windows/
  windows-backend-helper.js

native/audio-backends/windows/
  .build/SurroundAudioBackend.exe
```

Initial `src/main/audio-backends/index.js` direction:

```js
if (process.platform === 'win32') {
  return windowsWasapiBackend
}
```

The Windows backend must implement the same JavaScript-facing methods as the macOS and unsupported backends:

```js
getCapabilities()
listInputDevices()
listAppProcesses()
listAppOutputStreams()
listInputStreams()
spawnAppAudioPCMStream(pid, options)
spawnInputDevicePCMStream(options)
```

It is acceptable for early Windows work to return unsupported App Audio capabilities when the native helper executable has not been built yet.

## Capability Rules

Start conservative. Do not expose controls for features that do not work.

File-only Windows beta capabilities looked like this:

```js
{
  platform: 'win32',
  backendName: 'windows-file-only',
  appAudioCapture: false,
  appAudioPerProcess: false,
  appAudioSurroundPreserve: false,
  inputDeviceCapture: false,
  inputDeviceMonitor: false,
  fileSource: true,
  monitorPlayback: true,
  webAudioMonitorPlayback: true,
  nativeMonitorPlayback: false,
  nativeMonitorOutputSelection: false,
  lowLatencyAppAudioMonitor: false,
  monitorDeviceEnumeration: false,
  outputLoopbackCapture: false
}
```

Only change a flag to `true` after the feature is implemented and tested on Windows.

The selected Windows WASAPI backend reports App Audio support only when the native helper exists:

```js
{
  platform: 'win32',
  backendName: 'windows-wasapi-process-loopback',
  appAudioCapture: true,
  appAudioPerProcess: true,
  appAudioSurroundPreserve: false,
  inputDeviceCapture: true,
  inputDeviceMonitor: true,
  fileSource: true,
  monitorPlayback: true,
  monitorDeviceEnumeration: false,
  outputLoopbackCapture: false,
  minimumWindowsBuild: 20348
}
```

## Monitor Output Rules

The current monitor output path is renderer/WebAudio based. It is the shared fallback path for macOS, Windows, and Linux.

Do not copy macOS Core Audio monitor implementation details into Windows code. Windows does not have Apple Core Audio, Core Audio process taps, private aggregate devices, Core Audio device UIDs, or Core Audio stream indexes.

If a future native low-latency monitor is added, treat it as an optional backend feature.

Shared capability flags:

```js
{
  webAudioMonitorPlayback: true,
  nativeMonitorPlayback: false,
  nativeMonitorOutputSelection: false,
  lowLatencyAppAudioMonitor: false
}
```

Expected contract:

```js
startNativeMonitor(config)
stopNativeMonitor()
setNativeMonitorVolume(volume)
setNativeMonitorOutputDevice(deviceId)
```

Windows-specific rule:

- A native Windows monitor must be implemented with a Windows playback API such as WASAPI render-client behavior.
- It must be separate from Windows capture implementation.
- It must not be required for Stage 1 File-only Windows beta.
- It must not be required for Stage 2 Input Device capture.
- It should be considered only after basic Windows capture and output loopback behavior are stable.

Recommended monitor priority for Windows:

1. Keep WebAudio monitor working for File source.
2. Implement input capture and stream stability first.
3. Implement output-device loopback capture.
4. Research per-process capture.
5. Add native low-latency monitor only if WebAudio latency is unacceptable on Windows.

Keep Binaural HRTF on the WebAudio path unless there is a separate plan to port DSP into a native Windows helper. The first native monitor target, if any, should be simple Stereo Pair playback.

## Backend PCM Contract

When Windows capture is implemented, it must feed FFmpeg the same kind of PCM stream as macOS:

```text
stdout:
  raw 32-bit float little-endian PCM

stderr:
  line-delimited JSON events
```

Required format event before or at capture startup:

```json
{ "event": "format", "sampleRate": 48000, "channels": 2, "layout": "stereo", "bitsPerChannel": 32 }
```

Error event:

```json
{ "event": "error", "message": "capture failed" }
```

The existing `ffmpeg-manager.js` expects backend PCM as:

```text
-f f32le -ar <sampleRate> -ac <channels> -i pipe:0
```

## Windows Implementation Stages

### Stage 1: File-Only Windows Beta

Goal: prove that the Electron app can run on Windows without macOS backend calls.

Tasks:

- Ensure `process.platform === 'win32'` uses a Windows or file-only backend, not macOS. Done in `src/main/audio-backends/windows-dshow.js`.
- Keep App Audio and Input Device disabled through capabilities. Superseded for Input Device by the experimental DirectShow backend.
- Build with `npm run build:beta:win`.
- Launch the generated installer/app on Windows.
- Verify File source UI, file selection, Icecast settings, logs window, About window, and START/STOP behavior.
- Verify File source streaming to Icecast if FFmpeg packaging works.

Exit criteria:

- App launches on Windows.
- App Audio is visibly unavailable.
- File source can be tested without macOS helper errors.
- macOS beta still builds after the Windows changes.

### Stage 2: Windows Input Device Backend

Goal: capture a selected Windows input device and stream it as PCM to FFmpeg.

Current bootstrap:

- `native/audio-backends/windows/src/main.cpp` enumerates active capture endpoints through MMDevice and captures them through WASAPI.
- `src/main/audio-backends/windows-wasapi.js` uses the native helper for Input Device when the helper is available.
- `src/main/audio-backends/windows-dshow.js` enumerates DirectShow audio devices through bundled FFmpeg.
- The backend captures selected input devices through FFmpeg `dshow`, converts to Float32 PCM, and emits the expected JSON `format` event.
- The DirectShow path is now a fallback bridge, not the preferred Windows Input Device path.

Likely APIs:

- Windows Core Audio APIs
- WASAPI
- MMDevice API

Tasks:

- Enumerate input devices. Initial MMDevice path added.
- Return stable endpoint IDs and display names. Initial MMDevice endpoint IDs added.
- Capture PCM with stable pacing. Initial WASAPI shared-mode capture added; long-run pacing still needs testing.
- Emit JSON `format` events. Initial native helper path added.
- Feed Float32 PCM to stdout, converting PCM integer mix formats to Float32 when necessary.
- Update capabilities:
  - `inputDeviceCapture: true` for the experimental DirectShow path
  - `inputDeviceMonitor: true` for the experimental DirectShow preview path

Exit criteria:

- Input Device stream reaches Icecast.
- Input Device monitor preview starts and stops without leaving FFmpeg running.
- Audio does not speed up, slow down, or repeatedly buffer.
- macOS App Audio and Input Device still build and smoke-test.

### Stage 3: Windows Output Loopback Backend

Goal: capture output-device loopback as the first practical Windows App Audio alternative.

Current bootstrap:

- `src/main/audio-backends/windows-dshow.js` exposes likely DirectShow loopback/virtual input devices as App Audio output-loopback candidates.
- This path is only available when the host system exposes a loopback-like DirectShow input such as Stereo Mix, VB-CABLE, or another virtual routing device.
- This is not true per-app capture and is not the final WASAPI loopback helper.

Likely APIs:

- WASAPI loopback
- MMDevice API

Important limitation:

Output-device loopback is not the same as true per-app capture. UI text must not imply per-app capture until per-process capture is implemented.

Candidate capability flags:

```js
{
  appAudioCapture: true,
  appAudioPerProcess: false,
  appAudioSurroundPreserve: false,
  outputLoopbackCapture: true
}
```

Exit criteria:

- Windows can stream selected output-device loopback. Initial DirectShow bridge added; needs real-device validation.
- UI wording clearly distinguishes loopback from app-specific capture.
- Multichannel behavior is documented per tested device.

### Stage 4: Windows Per-Process Capture Research

Goal: implement and validate newer Windows process loopback APIs.

Likely API area:

- `ActivateAudioInterfaceAsync`
- `VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK`
- `AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK`
- `AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS`
- Audio Session APIs

Current bootstrap:

- `native/audio-backends/windows/src/main.cpp` streams WASAPI Process Loopback as Float32 PCM.
- `src/main/audio-backends/windows-wasapi.js` lists windowed processes and spawns the helper for selected PIDs.
- `scripts/build-windows-audio-helper.ps1` builds `SurroundAudioBackend.exe` with Visual Studio C++ tools.

Do not promise macOS parity until real tests prove:

- target process selection works,
- process tree inclusion/exclusion behaves correctly,
- channels and sample rate are reported correctly,
- capture pacing is stable,
- endpoint and app channel layouts are understandable enough for Preserve Surround.

## Packaging Rules

Do not make Windows downloads public until at least Stage 1 is tested.

Beta build command:

```bash
npm run build:beta:win
```

Expected future artifact name:

```text
dist/beta/SurroundStreamer-beta-0.1.1-setup.exe
```

If a native Windows helper is added, package it through `electron-builder.beta.yml` only after the file exists and the macOS packaging path still works.

Suggested future resource block:

```yaml
win:
  extraResources:
    - from: native/audio-backends/windows/.build/SurroundAudioBackend.exe
      to: audio-backend.exe
```

Do not add this block until the helper is built in CI or documented local steps exist. A missing `from` path can break packaging.

## Required Checks Before Commit

On macOS after shared-file changes:

```bash
npm run build
npm run build:beta:mac
codesign --verify --deep --strict --verbose=2 dist/beta/mac-arm64/SurroundStreamer-beta-0.1.1.app
```

On Windows after Windows changes:

```powershell
npm install
npm run build:audio-helper:win
npm run build
npm run build:beta:win
```

Manual Windows checks:

- App launches.
- App Audio unavailable state is clear if not implemented.
- Input Device unavailable state is clear if not implemented.
- File source can select a file.
- Logs window opens.
- Icecast settings persist after relaunch.
- START/STOP does not leave FFmpeg running.

## Files To Update With Progress

When Windows work advances, update these files:

```text
docs/windows-backend-development.md
docs/windows-linux-portability-assessment.md
docs/implementation_plan.md
docs/task.md
docs/build-windows.md
README.md
```

Keep README conservative. Do not change Windows from `Preparing` until a real Windows beta has been tested.
