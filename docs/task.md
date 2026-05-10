# SurroundStreamer Task Status

Last updated: 2026-05-09

## Current Release State

- [x] Repository is ready to be treated as `v0.1.0`.
- [x] Application source is licensed under the MIT License.
- [x] Third-party KU100 near-field HRIR attribution is documented in `README.md`.
- [x] `README.md` is written in English.
- [x] OS-specific build documents exist for macOS, Windows, and Linux.
- [x] `legacy/` has been removed from Git tracking.
- [x] `SurroundWebPlayer/` has been removed from Git tracking and is excluded by `.gitignore`.
- [x] `test_streamconfig.txt` is ignored and must remain private.
- [x] Release notes are prepared for `v0.1.0`.
- [x] The current beta implementation is promoted to the regular `0.1.0` build line.

## Current Product Scope

- macOS is the only practical target for the current build.
- Windows and Linux build documents are kept for future platform work, but those builds are not release-ready.
- Standard streaming format is Ogg Opus over Icecast.
- Standard stream channel templates are Mono, Stereo, Stereo + C, 5.1, and 7.1.
- 7.1.2 and 7.1.4 are excluded from the standard build and remain research-only topics.
- Audio Input capture uses the native Core Audio helper and pipes PCM into FFmpeg.
- File source supports playback/streaming and monitor preview.
- App Audio capture has been removed from the current beta line.
- Monitor Output is supported for Audio Input and File sources on macOS.

## Verified Locally

- [x] `npm run build`
- [x] `npm run build:audio-helper`
- [x] `npm run build:beta:mac`
- [x] `codesign --verify --deep --strict --verbose=2 dist/beta/mac-arm64/SurroundStreamer-beta-0.1.0.app`
- [x] `npm run build:mac`
- [x] `codesign --verify --deep --strict --verbose=2 dist/mac-arm64/SurroundStreamer.app`
- [x] Verify `dist/SurroundStreamer-0.1.0.dmg` exists.
- [x] `hdiutil verify dist/SurroundStreamer-0.1.0.dmg`
- [x] Draft beta Release created on GitHub as prerelease.
- [x] Release notes stored in `docs/releases/v0.1.0-beta.1.md`.
- [x] Release notes stored in `docs/releases/v0.1.0.md`.

## Release Checklist Before Publishing

- [ ] Launch the packaged app from the DMG.
- [ ] Confirm macOS microphone permission prompt/behavior for Audio Input source.
- [ ] Confirm File source streaming to Icecast.
- [ ] Confirm Audio Input streaming to Icecast.
- [ ] Confirm Stream Playback Check with `https://non-rem.com/SurroundWebPlayer/`.
- [ ] Confirm Monitor Output for File source.
- [ ] Confirm Monitor Output for Audio Input source.
- [ ] Confirm app quit stops FFmpeg and helper processes.
- [ ] Decide whether to publish the `v0.1.0` Release as-is or rebuild with notarization.

## Known Limitations

- The `0.1.0` app is ad-hoc signed and not notarized.
- App Audio capture is no longer a supported source.
- Windows/Linux packages are not release-ready because platform-specific audio capture backends are not implemented.
- AppImage, snap, and deb packaging notes are documentation-only until a Linux backend exists.
- Windows NSIS packaging notes are documentation-only until a Windows backend exists.

## Follow-Up Work

- [x] Add a user-visible About/License screen for MIT and third-party notices.
- [ ] Decide whether to notarize macOS public releases.
- [ ] Add a platform support matrix to the app UI if Windows/Linux builds are attempted.
- [x] Investigate and start a Windows WASAPI Process Loopback research path.
- [x] Retire App Audio as a supported input source in the current beta line.
- [ ] Investigate a Linux audio backend, likely PipeWire or PulseAudio monitor sources.
- [x] Add optional stereo MP3 simulcast for Icecast and Shoutcast 1 compatibility.
- [ ] Investigate optional Ogg Vorbis multichannel streaming up to 7.1.
- [ ] Revisit 7.1.4 only as a research-mode feature after player compatibility is proven.
- [ ] Consider KU100 far-field HRIR mode if speaker-layout monitoring needs deeper tuning.

## Cross-Platform Beta Branch

Branch: `beta/cross-platform-backend`

- [x] Define the cross-platform backend plan in `docs/implementation_plan.md`.
- [x] Increment beta build naming from `0.1.0` to the current `0.1.1-beta.10` line.
- [x] Add beta packaging scripts for macOS, Windows, and Linux.
- [x] Add a main-process audio backend selection boundary.
- [x] Wrap current macOS Core Audio helper access behind a macOS backend.
- [x] Add an unsupported backend for non-macOS platforms.
- [x] Expose audio backend capabilities to the renderer.
- [x] Disable unsupported source controls based on backend capabilities.
- [x] Add a file-only Windows backend selector as the first Windows development entry point.
- [x] Add an experimental Windows DirectShow Audio Input backend.
- [x] Add native Windows MMDevice/WASAPI Audio Input listing and capture.
- [x] Move macOS helper build output to `native/audio-backends/macos/.build/SurroundAudioBackend`.
- [x] Package the macOS helper as `audio-backend` while retaining legacy path fallback.
- [x] Move macOS helper launcher into `src/main/audio-backends/macos/core-audio-helper.js`.
- [x] Move macOS FFmpeg/Core Audio audio input scanner into `src/main/audio-backends/macos/device-scanner.js`.
- [x] Remove main-level `app-audio-helper.js` and `device-scanner.js`.
- [x] Remove unused macOS-only `monitor-scanner.js`.
- [x] Share backend PCM pipe and FFmpeg input argument setup in `ffmpeg-manager.js`.
- [x] Verify `npm run build`.
- [x] Verify `npm run build:beta:mac`.
- [x] Verify `codesign --verify --deep --strict --verbose=2 dist/beta/mac-arm64/SurroundStreamer-beta-0.1.1.app`.
- [x] Verify `npm run build:mac:dir` packages `Contents/Resources/audio-backend`.
- [x] Verify `codesign --verify --deep --strict --verbose=2 dist/mac-arm64/SurroundStreamer.app`.
- [x] Verify `npm run build:beta:win` creates `dist/beta/SurroundStreamer-beta-0.1.1-setup.exe` on Windows.
- [x] Smoke-launch `dist/beta/win-unpacked/SurroundStreamer-beta-0.1.1.exe` on Windows.
- [ ] Smoke-test Audio Input streaming on the new beta app.
- [ ] Smoke-test File source streaming on the new beta app.
- [ ] Start File-only Windows/Linux packaging validation after macOS behavior is confirmed.
- [ ] Validate `windows-dshow-input` capabilities in the Windows beta app.
- [x] Smoke-test Windows Audio Input streaming to Icecast.
- [x] Smoke-test Windows Audio Input Monitor Output.
- [x] Add Windows WASAPI Process Loopback helper source and JS backend wiring as research/reference code.
- [x] Build Windows WASAPI helper with Visual Studio C++ tools.
- [x] Verify Windows MMDevice/WASAPI Audio Input listing sees Voicemeeter endpoints.
- [x] Smoke-test Windows MMDevice/WASAPI Audio Input capture startup.
- [x] Probe Windows ASIO drivers and identify 6ch+ virtual devices.
- [x] Smoke-test 6ch ASIO input capture from Voicemeeter Virtual ASIO.
- [x] Validate REAPER 5.1 route through Voicemeeter Virtual ASIO into SurroundStreamer ASIO input.
- [x] Explicitly map selected backend channels before FFmpeg encoding when backend input channels differ from stream output channels.
- [ ] Keep Windows WASAPI Process Loopback `IAudioClient::Initialize` failure `0x88890021` as research follow-up only.
- [x] Add Windows backend development guide for Windows-side contributors.
- [x] Document macOS-safe files, Windows-owned files, and required cross-platform checks.
- [x] Document native low-latency monitor as an optional backend capability.
- [ ] Validate File-only Windows beta on a real Windows environment.
