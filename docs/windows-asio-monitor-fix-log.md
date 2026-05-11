# Windows ASIO Monitor Fix Log

Date: 2026-05-11

Branch context: beta Windows ASIO Audio Input monitor work.

## Scope

This log records the Windows-side fixes made while investigating ASIO Audio Input monitor noise,
missing monitor output, HRTF/downmix behavior, output device routing, and stream-start regressions.
It also records the final Windows beta stream-live fixes made after monitor routing was working.

Mac-specific backend code was intentionally not modified. The macOS implementation was used only as
a behavioral reference for monitor/HRTF behavior.

## User-visible Symptoms

- Windows ASIO Audio Input monitor could be silent even when the stream path had audio.
- Monitor output became full noise on some devices or when using Stereo Downmix / HRTF modes.
- The monitor meter could show 6 channels even though HRTF/downmix monitor output should be stereo.
- HRTF mode on Windows sounded much quieter than the existing Mac/WebAudio monitor path.
- Selecting a monitor output device in the UI did not reliably route sound to that device.
- Pressing stream start could leave only preview helper/FFmpeg processes running, with no stream
  output process visible.

## Main Findings

- The early Windows monitor path used a separate browser audio input route, which could diverge from
  the backend PCM path.
- ASIO sample conversion for right-aligned `Int32LSB16/18/20/24` input formats was wrong and could
  produce noise.
- The ASIO callback path had blocking/stdout work and vector shifting risk. That was replaced with
  ring-buffered worker I/O for the duplex experiment path.
- Windows ASIO preview/stream monitor now needs to be backend-owned. Electron/WebAudio routing is
  not reliable enough for this specific ASIO monitor path.
- FFmpeg `headphone` uses its own gain behavior. Using `gain=-9.118639` to mimic WebAudio's
  `0.35` binaural master gain made the Windows HRTF monitor much quieter in practice.
- The 5.1 channel layout needed to be `5.1(side)` for the app's `FL FR FC LFE SL SR` template.
- Browser `audiooutput` device IDs are not WASAPI endpoint IDs. Passing browser device identity to
  the backend renderer cannot reliably select the requested Windows output device.
- `System Default` was previously passed as a device name, which made the native renderer attempt
  name matching instead of always using the true Windows default endpoint.
- Stream start could appear to work while only the preview monitor FFmpeg/helper remained running;
  the actual streaming FFmpeg had exited.
- The local environment had `HTTP_PROXY`, `HTTPS_PROXY`, and `ALL_PROXY` set to
  `http://127.0.0.1:9`, which FFmpeg inherited and used for Icecast output.
- Opus rejected `5.1(side)` with mapping family `1`; the stream output must use an
  Opus-compatible `5.1` layout while the UI/monitor path can retain `5.1(side)` for side-channel
  semantics.

## Native Windows Backend Changes

File: `native/audio-backends/windows/src/main.cpp`

- Added robust right-aligned ASIO integer sample conversion:
  - `rightAlignedInt32SampleToFloat`
  - fixed `ASIOSTInt32LSB16/18/20/24` decoding.
- Added float-to-output conversion helpers:
  - `floatToSignedInt`
  - `floatToInt32Sample`
  - `sanitizeFloatSample`
  - `asioFloatToSample`
- Added a WASAPI shared-mode render path:
  - `--play-wasapi-output`
  - accepts `--device-id`, `--device-name`, `--sample-rate`, `--channels`.
- Added render endpoint listing through:
  - `--list-output-devices`
- Added render device resolution:
  - prefer exact WASAPI endpoint ID.
  - use name matching only when an explicit non-default name is provided.
  - treat empty name or `System Default` as true Windows default endpoint.
- Added ASIO output/duplex support utilities for diagnostic/backend experiments:
  - `--play-asio-output`
  - `--stream-asio-input-monitor-output`
  - ring buffers and worker threads for duplex stdout/stdin.
- Zeroed ASIO output buffers before start and call `outputReady()` when supported.

Build command:

```powershell
npm run build:audio-helper:win
```

Expected output:

```text
native/audio-backends/windows/.build/SurroundAudioBackend.exe
```

## Main Process / FFmpeg Changes

File: `src/main/ffmpeg-manager.js`

- Added backend-owned Windows ASIO monitor path:
  - ASIO input helper streams PCM to FFmpeg.
  - FFmpeg generates monitor PCM on `pipe:3`.
  - native WASAPI renderer plays that PCM.
- Added `monitorPlaybackProcess` lifecycle management.
- Added `writeMonitorPlayback` with `EPIPE` / `EOF` handling to avoid JavaScript main-process
  crashes when monitor mode changes or pipes close.
- Added `emitMonitorPeaks` so backend-owned monitor output can still drive the UI meter.
- Fixed meter channel count to use actual monitor PCM format (`2ch`) instead of source/input
  channel count.
- Added `setMonitorOutput` so changing output device while streaming can recreate only the WASAPI
  monitor renderer.
- HRTF monitor filter now uses `5.1(side)` for 6-channel layouts.
- FFmpeg child processes now clear inherited proxy environment variables so Icecast output does not
  accidentally connect through a dead local proxy.
- Stream startup waits long enough to catch FFmpeg/Icecast failures and writes persistent logs to
  `%APPDATA%/surround-streamer/surround-streamer.log`.
- Opus output maps `5.1(side)` to `5.1` at the encoder output boundary to satisfy libopus mapping
  family validation.
- Windows ASIO monitor HRTF gain was changed to:

```text
ASIO_MONITOR_HRTF_GAIN_DB = 8.881361
```

Reason: test convolution with the same KU100 HRIR data showed FFmpeg `headphone` output was about
18 dB quieter than the WebAudio convolution reference when using `gain=-9.118639`. The new value is
for the Windows ASIO monitor HRTF path only.

The existing MP3 simulcast HRTF path still uses its existing gain value and was not changed by this
specific monitor loudness adjustment.

## Windows Backend JS Changes

File: `src/main/audio-backends/windows-wasapi.js`

- Exposes native monitor output enumeration:
  - `listMonitorOutputDevices()`
- Marks `monitorDeviceEnumeration: true` for the Windows helper path.
- `spawnOutputPCMPlayback()` now passes the selected WASAPI endpoint ID when provided.
- It no longer passes `--device-name "System Default"`; default selection is represented by no
  explicit device selector.

## IPC / Preload Changes

Files:

- `src/main/ipc-handlers.js`
- `src/preload/index.js`

Added IPC:

- `devices:list-monitor-outputs`
- `monitor:set-output`
- `monitor:peaks`

These allow renderer UI selection to reach the backend WASAPI renderer and allow backend-generated
monitor meters to update the UI.

## Renderer Changes

File: `src/renderer/src/renderer.js`

- For Windows ASIO input, monitor output device list now comes from backend WASAPI endpoints instead
  of browser `audiooutput` devices.
- Added `selectedMonitorOutputDeviceId()` for backend endpoint IDs.
- Added `selectedBrowserMonitorOutputDeviceId()` so normal WebAudio monitor paths still use browser
  sink IDs.
- Added `startBackendAsioPreviewMonitor()` for backend-owned preview monitor.
- Output device changes are included in the ASIO preview key, so changing device restarts the
  preview monitor.
- During streaming, output device changes call `monitor:set-output`, which rebuilds the backend
  WASAPI renderer process.
- ASIO backend stream-start monitor format now preserves the selected monitor mode instead of
  forcing `stereo-pair`.
- 5.1 template layout changed from `5.1` to `5.1(side)`.

## Verification Performed

Commands successfully run:

```powershell
npm run build:audio-helper:win
npm run build
npm run lint
npx electron-builder --win --config electron-builder.beta.yml --config.directories.output=dist/beta-monitor-output-routing-fix
npx electron-builder --win --config electron-builder.beta.yml --config.directories.output=dist/beta-stream-live-fix
```

Notes:

- `npm run build` needed normal permissions because sandboxed `esbuild` child-process spawn returned
  `EPERM`.
- `npm run lint` exits successfully; current output is existing CRLF prettier warnings.
- `SurroundAudioBackend.exe --list-output-devices` returned active WASAPI render endpoints,
  including the Logicool headset and Voicemeeter endpoints.
- Packaged `app.asar` was checked for:
  - `devices:list-monitor-outputs`
  - `monitor:set-output`
  - `monitorOutputDeviceId`
- A direct FFmpeg 5-second Opus Icecast smoke test using the saved server settings failed before
  the fix with proxy inheritance, then passed after clearing the proxy variables and using the
  Opus-compatible `5.1` layout.

## Historical Beta Builds Produced During Investigation

These paths are historical local artifacts from the ASIO monitor investigation. The current main
Windows release-preparation artifact is documented in [Build On Windows](build-windows.md).

Earlier intermediate builds:

```text
dist/beta-monitor-fix/SurroundStreamer-beta-0.1.1-setup.exe
dist/beta-monitor-2ch-layout-fix/SurroundStreamer-beta-0.1.1-setup.exe
dist/beta-monitor-hrtf-gain-fix/SurroundStreamer-beta-0.1.1-setup.exe
```

Latest build for output routing fix:

```text
dist/beta-monitor-output-routing-fix/win-unpacked/SurroundStreamer-beta-0.1.1.exe
dist/beta-monitor-output-routing-fix/SurroundStreamer-beta-0.1.1-setup.exe
```

Latest stream-live beta build:

```text
dist/beta-stream-live-fix/win-unpacked/SurroundStreamer-beta-0.1.1.exe
dist/beta-stream-live-fix/SurroundStreamer-beta-0.1.1-setup.exe
```

## Remaining Risk / Follow-up

- Live Opus stream-start was reproduced and fixed with a real Icecast target through a direct FFmpeg
  smoke test. The packaged app should still be retested end-to-end after install.
- If stream start fails again, inspect the visible app log and
  `%APPDATA%/surround-streamer/surround-streamer.log` for `Starting FFmpeg:` and the returned
  startup error.
- Stereo MP3-only and Opus+MP3 live targets should still be smoke-tested separately after the Opus
  live path fix.
- For 7.1 templates, confirm FFmpeg layout order versus the app's label order if users report rear
  or side channel localization issues.
