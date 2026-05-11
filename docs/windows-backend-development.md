# Windows Backend Development Guide

Last updated: 2026-05-10

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
- File source is implemented but still needs final packaged-app smoke testing.
- Audio Input capture supports native MMDevice/WASAPI and ASIO through the Windows helper, with the earlier DirectShow/FFmpeg backend retained as fallback.
- Native ASIO and MMDevice/WASAPI Audio Input, ASIO monitor routing, and Icecast Opus streaming have local beta validation.
- ASIO is the primary validation path for Windows surround/multichannel input. MMDevice/WASAPI remains useful for generic mono/stereo input, but should not be assumed to expose 5.1 or 7.1 capture endpoints.
- ASIO driver probing and ASIO input capture have an initial native helper path for multichannel virtual devices such as Voicemeeter.
- WASAPI Process Loopback and the earlier DirectShow loopback-device bridge remain research/reference paths, not supported App Audio sources.

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
- macOS Audio Input capture must continue to use backend Float32 PCM into FFmpeg.
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

App Audio methods may exist only to satisfy the shared shape; App Audio remains unsupported in the current UI. The Windows backend may also implement capability-gated monitor methods used by the ASIO monitor path:

```js
listMonitorOutputDevices()
spawnOutputPCMPlayback(options)
```

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
  nativeInputDeviceMonitor: false,
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

The selected Windows WASAPI backend reports App Audio as unsupported. Process-loopback code is research/reference only:

```js
{
  platform: 'win32',
  backendName: 'windows-wasapi', // helper present
  appAudioCapture: false,
  appAudioPerProcess: false,
  appAudioSurroundPreserve: false,
  inputDeviceCapture: true,
  inputDeviceMonitor: true,
  nativeInputDeviceMonitor: false,
  fileSource: true,
  monitorPlayback: true,
  monitorDeviceEnumeration: true,
  outputLoopbackCapture: false,
  minimumWindowsBuild: 20348
}
```

If the native helper is missing, the backend reports `backendName: 'windows-wasapi-pending'` and
falls back to the DirectShow bridge for Audio Input discovery/capture where possible. That mode is
acceptable for development, but release validation should use the native helper path.

## Monitor Output Rules

The shared renderer/WebAudio monitor path remains the fallback path for macOS, Windows, and Linux.
Windows ASIO Audio Input also has a beta backend-owned monitor route through FFmpeg/WASAPI output
playback with backend output-device enumeration. Treat that ASIO route as validated beta behavior,
while other native per-backend monitor paths remain capability-gated.

Do not copy macOS Core Audio monitor implementation details into Windows code. Windows does not have Apple Core Audio, Core Audio process taps, private aggregate devices, Core Audio device UIDs, or Core Audio stream indexes.

If another native low-latency monitor path is added later, treat it as an optional backend feature.

Shared capability flags:

```js
{
  webAudioMonitorPlayback: true,
  nativeInputDeviceMonitor: false,
  nativeMonitorPlayback: false,
  nativeMonitorOutputSelection: false,
  lowLatencyAppAudioMonitor: false
}
```

Current optional native input monitor hook:

```js
spawnNativeInputDeviceMonitor(options)
```

Future persistent native monitor control may add explicit start/stop/volume/output-device methods,
but that should be a new capability-gated API.

Windows-specific rule:

- A native Windows monitor must be implemented with a Windows playback API such as WASAPI render-client behavior.
- It must be separate from Windows capture implementation.
- It must not be required for Stage 1 File-only Windows beta.
- It must not be required for Stage 2 Audio Input capture.
- It should be considered only after basic Windows capture and output loopback behavior are stable.

Recommended monitor priority for Windows:

1. Keep WebAudio monitor working for File source.
2. Implement input capture and stream stability first.
3. Implement output-device loopback capture.
4. Research per-process capture.
5. Add native low-latency monitor only if WebAudio latency is unacceptable on Windows.

Keep Binaural HRIR on the WebAudio path unless there is a separate plan to port DSP into a native Windows helper. The first native monitor target, if any, should be simple Stereo Pair playback.

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

- Ensure `process.platform === 'win32'` uses a Windows backend, not macOS. Current selector uses `src/main/audio-backends/windows-wasapi.js`.
- Keep App Audio disabled through capabilities. Audio Input is now enabled through the native helper path when available, with DirectShow fallback when the helper is missing.
- Build with `npm run build:beta:win`.
- Launch the generated installer/app on Windows.
- Verify File source UI, file selection, Icecast settings, logs window, About window, and START/STOP behavior.
- Verify File source streaming to Icecast if FFmpeg packaging works.

Exit criteria:

- App launches on Windows.
- App Audio is visibly unavailable.
- File source can be tested without macOS helper errors.
- macOS beta still builds after the Windows changes.

### Stage 2: Windows Audio Input Backend

Goal: capture a selected Windows audio input and stream it as PCM to FFmpeg.

Current bootstrap:

- `native/audio-backends/windows/src/main.cpp` enumerates active capture endpoints through MMDevice and captures them through WASAPI.
- The same helper can probe registered ASIO drivers and capture ASIO input channels as Float32 PCM.
- `src/main/audio-backends/windows-wasapi.js` uses the native helper for Audio Input when the helper is available.
- `src/main/audio-backends/windows-dshow.js` enumerates DirectShow audio devices through bundled FFmpeg.
- The DirectShow fallback captures selected audio inputs through FFmpeg `dshow`, converts to Float32 PCM, and emits the expected JSON `format` event.
- The DirectShow path is now a fallback bridge, not the preferred Windows Audio Input path.

Likely APIs:

- Windows Core Audio APIs
- WASAPI
- MMDevice API

Tasks:

- Enumerate audio inputs. Initial MMDevice path added.
- Return stable endpoint IDs and display names. Initial MMDevice endpoint IDs added.
- Capture PCM with stable pacing. Initial WASAPI shared-mode capture and ASIO capture paths are added; long-run pacing still needs testing.
- Emit JSON `format` events. Initial native helper path added.
- Feed Float32 PCM to stdout, converting PCM integer mix formats to Float32 when necessary.
- Expose ASIO devices when they can be probed, because Voicemeeter exposes multichannel virtual I/O through ASIO even when its WASAPI endpoints are stereo.
- For surround/multichannel Windows validation, test ASIO first. Treat WASAPI/MMDevice as a mono/stereo input path unless a specific device proves multichannel capture.
- Update capabilities:
  - `inputDeviceCapture: true` for the experimental DirectShow path
  - `inputDeviceMonitor: true` for the experimental DirectShow preview path
  - `nativeInputDeviceMonitor: false` until a native Windows monitor playback path is implemented and validated

Exit criteria:

- Audio Input stream reaches Icecast.
- Audio Input monitor preview starts and stops without leaving FFmpeg running.
- Audio does not speed up, slow down, or repeatedly buffer.
- macOS Audio Input still builds and smoke-tests.

### Stage 3: Windows Output Loopback Research

Goal: keep output-device loopback research separate from the supported Audio Input/File UI.

Current bootstrap:

- `src/main/audio-backends/windows-dshow.js` can expose likely DirectShow loopback/virtual audio inputs as research candidates.
- This path is only available when the host system exposes a loopback-like DirectShow input such as Stereo Mix, VB-CABLE, or another virtual routing device.
- This is not true per-app capture and is not the final WASAPI loopback helper.

Likely APIs:

- WASAPI loopback
- MMDevice API

Important limitation:

Output-device loopback is not the same as true per-app capture. Do not expose it as App Audio in the supported UI.

Candidate capability flags:

```js
{
  appAudioCapture: false,
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

Do not present Windows as a stable public release until signing, compatibility, and long-run checks
are complete. The beta branch now has a locally validated Windows package path.

Build the helper first when validating native Audio Input:

```powershell
npm run build:audio-helper:win
```

Beta build command:

```bash
npm run build:beta:win
```

Expected beta artifact name:

```text
dist/beta/SurroundStreamer-beta-0.1.1-setup.exe
```

The latest local validation build used during the Windows ASIO stream-live fix was:

```text
dist/beta-stream-live-fix/SurroundStreamer-beta-0.1.1-setup.exe
```

Current beta packaging uses `asarUnpack` for:

```text
native/audio-backends/windows/.build/**
```

`src/main/audio-backends/windows-wasapi.js` first looks for an explicitly packaged helper resource:

```text
process.resourcesPath/audio-backend.exe
```

It then falls back to the unpacked app path:

```text
app.asar.unpacked/native/audio-backends/windows/.build/SurroundAudioBackend.exe
```

`npm run build:beta:win` builds the Windows helper first, then builds the app and packages with
`electron-builder.beta.yml`.

For a future stable Windows release, an explicit `win.extraResources` block may be preferable:

```yaml
win:
  extraResources:
    - from: native/audio-backends/windows/.build/SurroundAudioBackend.exe
      to: audio-backend.exe
```

Do not switch stable packaging to that block until the helper is built in CI or documented local
steps exist. A missing `from` path can break packaging.

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
- Audio Input devices list through the native helper when present.
- DirectShow fallback is clear when the native helper is absent.
- File source can select a file.
- Logs window opens.
- Icecast settings persist after relaunch.
- Opus, Opus+MP3, and MP3-only encoding modes start with valid test server settings.
- MP3 Shoutcast 1 relay authenticates against a real compatible server.
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

Keep README conservative for the stable macOS release, but it may now describe Windows as a validated
beta branch target rather than generic `Preparing`.
