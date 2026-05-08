# SurroundStreamer Cross-Platform Backend Plan

Last updated: 2026-05-09

Branch: `beta/cross-platform-backend`

## Purpose

This branch is the beta development line for making SurroundStreamer easier to build and extend on macOS, Windows, and Linux.

The current stable line is `v0.1.0` on `main`. That line should remain macOS-first and release-oriented. This beta branch may temporarily contain incomplete or disabled Windows/Linux behavior while the platform backend architecture is separated.

## Version Policy

Stable release:

- Current stable version: `0.1.0`
- Current stable macOS artifact: `SurroundStreamer-0.1.0.dmg`

Beta builds from this branch must use the next version number:

- Next beta version: `0.1.1-beta.1`
- Beta app name target: `SurroundStreamer-beta-0.1.1`
- macOS beta app target: `dist/beta/mac-arm64/SurroundStreamer-beta-0.1.1.app`
- Windows beta installer target, once buildable: `SurroundStreamer-beta-0.1.1-setup.exe`

Rule: when generating a beta app or Windows beta executable, do not reuse the stable `0.1.0` version number. Increment the beta line first.

## Architecture Summary

SurroundStreamer currently looks like a cross-platform Electron app, but the important audio capture layer is macOS-specific.

Portable parts:

- Renderer UI structure.
- Settings persistence.
- Icecast configuration.
- FFmpeg/Ogg Opus output pipeline.
- File source streaming path.
- Stream channel template UI up to 7.1.
- Logs/About windows.
- KU100 near-field HRTF monitor rendering data and channel mapping logic.

macOS-specific parts:

- App Audio capture.
- Input Device PCM capture.
- Output stream selection for preserve-surround capture.
- Core Audio device and stream metadata.
- Monitor output device enumeration.
- macOS microphone permission flow.

The current native helper is:

```text
native/audio-tap-helper/Sources/AudioTapHelper/main.m
```

It is Objective-C, built with `xcrun clang`, and depends on Apple Core Audio Process Tap APIs. It cannot be reused directly on Windows or Linux.

## Development Goal

The goal is not to find one universal OS audio API. The goal is to define a SurroundStreamer-owned backend contract, then implement OS-specific helpers behind that contract.

Target structure:

```text
src/main/audio-backends/
  index.js
  macos-core-audio.js
  macos/
    core-audio-helper.js
    device-scanner.js
  windows-dshow.js
  windows-wasapi.js
  linux-pipewire.js
  unsupported.js

native/audio-backends/
  macos/
    .build/SurroundAudioBackend
  windows/
    .build/SurroundAudioBackend.exe
  linux/
    .build/surround-audio-backend
```

Electron should select a backend by `process.platform`, read backend capabilities, and expose only supported UI options.

## Backend Contract

Each platform backend should eventually provide the same conceptual commands.

Required commands:

```text
--capabilities
--list-input-devices
--list-output-devices
--list-apps
--list-app-output-streams
--capture-input --device-id <id> [--stream-index <n>]
--capture-app --app-id <id> [--output-id <id>] [--stream-index <n>]
--capture-loopback --output-id <id>
```

PCM contract:

```text
stdout:
  raw PCM, preferably 32-bit float little-endian

stderr:
  JSON events
```

Example JSON events:

```json
{"event":"format","sampleRate":48000,"channels":6,"layout":"5.1","bitsPerChannel":32}
{"event":"status","message":"capture started"}
{"event":"error","message":"capture failed"}
```

FFmpeg should continue to receive backend PCM using the existing common path:

```text
-f f32le -ar <sampleRate> -ac <channels> -i pipe:0
```

## Platform Capability Model

Renderer UI must be driven by backend capabilities instead of assuming macOS behavior.

Proposed capability object:

```js
{
  platform: 'darwin',
  backendName: 'macos-core-audio',
  appAudioCapture: true,
  appAudioPerProcess: true,
  appAudioSurroundPreserve: true,
  inputDeviceCapture: true,
  inputDeviceMonitor: false,
  fileSource: true,
  monitorPlayback: true,
  webAudioMonitorPlayback: true,
  nativeMonitorPlayback: false,
  lowLatencyAppAudioMonitor: false,
  monitorDeviceEnumeration: true,
  outputLoopbackCapture: false
}
```

Unsupported controls should be disabled before the user clicks them. They should not fail only after streaming starts.

## Monitor Output Architecture

The current monitor path is portable but not the lowest possible latency:

```text
backend PCM -> Electron main process -> renderer IPC -> WebAudio Worklet -> selected output device
```

This path should remain the default cross-platform monitor implementation because it works with the existing renderer-side Stereo Pair, Binaural HRTF, volume, meter, and output-device UI.

If App Audio monitoring still feels too delayed on macOS, the next step is a native monitor path:

```text
macOS Core Audio process tap -> native Core Audio output render path
```

That must be treated as an optional backend capability, not as shared renderer behavior.

Do not wire a macOS-only native monitor directly into shared renderer or FFmpeg code. Add a backend-level contract first, then implement it per OS only when needed.

Suggested future backend capabilities:

```js
{
  monitorPlayback: true,
  webAudioMonitorPlayback: true,
  nativeMonitorPlayback: false,
  nativeMonitorOutputSelection: false,
  lowLatencyAppAudioMonitor: false
}
```

Suggested future backend methods:

```js
startNativeMonitor(config)
stopNativeMonitor()
setNativeMonitorVolume(volume)
setNativeMonitorOutputDevice(deviceId)
```

Rules:

- WebAudio monitor stays as the fallback for all platforms.
- Native monitor is opt-in per backend.
- macOS native monitor, if implemented, may use Core Audio directly.
- Windows native monitor, if implemented, must be a separate WASAPI render path, not Core Audio.
- Linux native monitor, if implemented, must be a separate PipeWire/PulseAudio playback path.
- Keep streaming output and monitor output independent. Monitor changes must not alter Icecast/FFmpeg stream pacing or channel mapping.
- Keep Binaural HRTF in the WebAudio path until there is a clear reason to port that DSP into native helpers.

## Phased Development Plan

### Phase 1: Backend Boundary

Goal: keep macOS behavior working while moving platform-specific assumptions behind a backend interface.

Tasks:

- Add `src/main/audio-backends/`.
- Add backend selection in one place.
- Wrap existing macOS helper calls behind `macos-core-audio.js`.
- Add `unsupported.js` for Windows/Linux until real backends exist.
- Make IPC handlers call the selected backend instead of directly calling macOS helper modules.
- Keep current App Audio, Input Device, File source behavior unchanged on macOS.
- Add a backend capability IPC endpoint for the renderer.

Exit criteria:

- macOS App Audio still streams.
- macOS Input Device still streams.
- File source still streams.
- Windows/Linux builds, if run, show unsupported capture controls clearly instead of broken controls.

### Phase 2: Packaging Layout

Goal: make app packaging expect one platform backend resource per OS.

Tasks:

- Move or wrap the current macOS helper into the future `native/audio-backends/macos/` layout.
- Update Electron Builder resources to use platform-specific backend paths.
- Keep existing macOS helper build command functional during the transition.
- Add placeholder packaging paths for Windows/Linux only after placeholders do not break packaging.
- Keep Windows/Linux public docs marked as "Preparing" until real validation.

Exit criteria:

- `npm run build:beta:mac` produces `SurroundStreamer-beta-0.1.1.app`.
- Regular `npm run build:mac` can still produce the stable app naming when run from the release line.
- Packaging does not include private files such as `test_streamconfig.txt`.

### Phase 3: File-Only Windows/Linux Beta

Goal: make Windows/Linux app shells useful without pretending full capture support exists.

Tasks:

- Ensure File source does not depend on macOS helper modules.
- Select `windows-dshow-input` from `src/main/audio-backends/index.js` when `process.platform === 'win32'`.
- Disable App Audio and Input Device on Windows/Linux through backend capabilities.
- Verify FFmpeg binary availability and path resolution for Windows/Linux.
- Verify settings persistence, Icecast connection UI, channel templates, logs, and About window.
- Add Windows/Linux smoke-test checklists.

Exit criteria:

- Windows/Linux beta app opens.
- File source can be tested without macOS helper calls.
- Unsupported capture features are visibly disabled.

### Phase 4: Windows Backend Research Build

Goal: add a first real Windows capture backend.

Development guardrail:

- Follow `docs/windows-backend-development.md`.
- Do not edit macOS-owned backend files unless the change is explicitly platform-neutral.
- After shared backend changes, re-run the macOS beta build before committing.

Candidate APIs:

- Microsoft Core Audio APIs.
- WASAPI.
- MMDevice API.
- Audio Session APIs.
- Process loopback APIs on supported Windows versions.

Initial target:

- File-only Windows beta validation first.
- Input-device capture second. The current native helper can capture MMDevice/WASAPI inputs and ASIO inputs, with DirectShow retained as a fallback.
- Per-app/process capture third. The current bootstrap uses WASAPI Process Loopback and intentionally requires Windows 10 Build 20348 or later.
- Native low-latency monitor playback is not part of the first Windows backend target.

Windows validation snapshot, 2026-05-09:

- WASAPI/MMDevice endpoints on the current Windows test machine expose only mono/stereo formats, including Voicemeeter WDM endpoints.
- Voicemeeter ASIO exposes multichannel virtual devices. `Voicemeeter Virtual ASIO` has been validated as 8 in / 8 out, and the native helper can read 6ch Float32 PCM from it.
- REAPER multichannel output has been validated through `REAPER -> Voicemeeter Virtual ASIO -> SurroundStreamer ASIO input`. The practical Windows 5.1 route for REAPER is therefore ASIO input, not WASAPI App Audio.
- REAPER must route Master hardware outputs explicitly: source 1/2 to output 1/2, source 3/4 to output 3/4, and source 5/6 to output 5/6. Setting the Master track to 6ch alone is insufficient.
- The FFmpeg pre-encode path now explicitly maps selected backend channels when input and output channel counts differ, so an 8ch ASIO input can feed a 5.1 stream without relying on FFmpeg's implicit `-ac` behavior.
- Voicemeeter itself does not publish to Icecast. The intended chain is `REAPER -> Voicemeeter ASIO -> SurroundStreamer -> Icecast`.
- WASAPI Process Loopback remains a separate App Audio research path. It is suitable for normal Windows app audio only when the app is actually rendering through WASAPI, and it should not be expected to capture ASIO output from REAPER.
- On the current test machine, the REAPER WASAPI process-loopback smoke test failed during `IAudioClient::Initialize` with `0x88890021`; this needs separate investigation before Windows App Audio can be treated as usable.

Risks:

- Per-process loopback support depends on Windows version and API behavior.
- Multichannel preservation depends on endpoint format and driver behavior. On Windows, ASIO may be the only visible multichannel path even when the matching WASAPI endpoints are stereo.
- Windows channel layout names will not map exactly to Core Audio stream concepts.
- Signing and SmartScreen are release issues separate from backend correctness.

Exit criteria:

- Windows backend emits Float32 PCM and format JSON.
- FFmpeg receives correctly paced PCM.
- A Windows beta executable can be generated with the incremented beta version.

### Phase 4.5: Optional Native Monitor Backend

Goal: reduce monitor latency without damaging Windows/Linux backend work.

This phase should start only after the platform capture backend boundary is stable.

Implementation order:

- Keep the WebAudio monitor as default.
- Add the `nativeMonitorPlayback` capability flag.
- Add backend methods for native monitor start/stop/volume/output-device selection.
- Implement macOS native monitor first only for App Audio + Stereo Pair.
- Keep Binaural HRTF and complex downmix modes on WebAudio unless native DSP is explicitly planned.
- Do not require Windows/Linux to implement native monitor before their capture backends work.

Windows expectation:

- Windows native monitor would be a WASAPI render-client feature.
- It should be planned separately from WASAPI capture.
- It must not reuse macOS Core Audio naming, Core Audio stream IDs, or aggregate-device assumptions.

Exit criteria:

- macOS App Audio + Stereo Pair monitor latency improves in real listening tests.
- WebAudio monitor still works as fallback.
- Windows file-only and future WASAPI backend work is not blocked by native macOS monitor code.

### Phase 5: Linux Backend Research Build

Goal: add a first real Linux capture backend.

Candidate APIs:

- PipeWire first.
- PulseAudio monitor sources as compatibility path.
- ALSA only for limited input-device work.

Initial target:

- PipeWire or PulseAudio output monitor capture.
- Input-device capture after output monitor capture is stable.

Risks:

- Distribution differences are significant.
- PipeWire/PulseAudio availability and default configuration vary.
- AppImage/snap/deb have different runtime and permission constraints.
- True app-level capture is not the same as output monitor capture.

Exit criteria:

- Linux backend emits Float32 PCM and format JSON.
- FFmpeg receives correctly paced PCM.
- Linux beta package opens and clearly reports backend capability state.

### Phase 6: Feature Parity Review

Goal: decide whether Windows/Linux should match the macOS App Audio behavior or remain limited.

Questions:

- Is per-app capture required, or is output-device loopback acceptable?
- Is surround preservation required on Windows/Linux v1, or can stereo/5.1 be staged?
- Should Input Device monitor output remain disabled across all OSes?
- Should File source become the first cross-platform public feature?

Exit criteria:

- Updated support matrix in README.
- Updated release notes for the next beta.
- Clear decision on whether Windows/Linux remain beta-only.

## Current Known Limitations

- The stable `0.1.0` build is macOS-first.
- Windows/Linux builds are not release-ready.
- Windows currently has native MMDevice/WASAPI input capture, ASIO probing/capture, the older DirectShow input-device bridge as fallback, and a WASAPI Process Loopback helper source for App Audio research.
- Windows App Audio requires Windows 10 Build 20348 or later and a built native helper executable.
- Windows REAPER 5.1 validation currently uses ASIO input through Voicemeeter; WASAPI App Audio is not the validated path for ASIO applications.
- Windows DirectShow loopback support is only a development bridge for loopback-like input devices exposed by the host, not the selected App Audio path.
- Linux App Audio capture is not implemented.
- Linux Input Device capture is not implemented.
- Windows/Linux monitor device enumeration is not implemented.
- 7.1.2 and 7.1.4 remain research-only.
- Input Device monitor output remains disabled in the current macOS product behavior, but is experimentally enabled for the Windows DirectShow backend.
- macOS release is ad-hoc signed and not notarized.

## Documentation Tasks

- Keep `README.md` focused on the stable macOS release until Windows/Linux beta behavior is verified.
- Keep `docs/build-windows.md` and `docs/build-linux.md` in "Preparing" state until File-only builds actually work.
- Use `docs/windows-linux-portability-assessment.md` as the architecture reference for cross-platform decisions.
- Add beta release notes when `0.1.1-beta.1` is built.

## Immediate Next Tasks

1. Build `native/audio-backends/windows/.build/SurroundAudioBackend.exe`.
2. Smoke-test Windows WASAPI Process Loopback App Audio streaming to Icecast.
3. Smoke-test Windows App Audio Monitor Output.
4. Smoke-test macOS behavior after shared backend changes.
5. Decide whether Windows needs native WASAPI input-device capture after DirectShow validation.
