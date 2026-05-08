# SurroundStreamer Task Status

Last updated: 2026-05-08

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
- App Audio capture uses macOS Core Audio process taps.
- Input Device capture uses the native Core Audio helper and pipes PCM into FFmpeg.
- File source supports playback/streaming and monitor preview.
- Monitor Output is supported for App Audio and File sources.
- Monitor Output is disabled for Input Device source.

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
- [ ] Confirm macOS microphone permission prompt/behavior for Input Device source.
- [ ] Confirm App Audio streaming to Icecast with a real app source.
- [ ] Confirm File source streaming to Icecast.
- [ ] Confirm Stream Playback Check with `https://non-rem.com/SurroundWebPlayer/`.
- [ ] Confirm Monitor Output for App Audio.
- [ ] Confirm Monitor Output for File source.
- [ ] Confirm Input Device monitor controls remain disabled.
- [ ] Confirm app quit stops FFmpeg and helper processes.
- [ ] Decide whether to publish the `v0.1.0` Release as-is or rebuild with notarization.

## Known Limitations

- The `0.1.0` app is ad-hoc signed and not notarized.
- Input Device source currently cannot use Monitor Output.
- App Audio channel order depends on the selected Core Audio output stream and the source app's output configuration.
- Windows/Linux packages are not release-ready because platform-specific audio capture backends are not implemented.
- AppImage, snap, and deb packaging notes are documentation-only until a Linux backend exists.
- Windows NSIS packaging notes are documentation-only until a Windows backend exists.

## Follow-Up Work

- [x] Add a user-visible About/License screen for MIT and third-party notices.
- [ ] Decide whether to notarize macOS public releases.
- [ ] Add a platform support matrix to the app UI if Windows/Linux builds are attempted.
- [ ] Investigate a Windows audio backend, likely WASAPI loopback for App Audio.
- [ ] Investigate a Linux audio backend, likely PipeWire or PulseAudio monitor sources.
- [ ] Investigate optional MP3 stereo streaming for transitional compatibility.
- [ ] Investigate optional Ogg Vorbis multichannel streaming up to 7.1.
- [ ] Revisit 7.1.4 only as a research-mode feature after player compatibility is proven.
- [ ] Consider KU100 far-field HRIR mode if speaker-layout monitoring needs deeper tuning.

## Cross-Platform Beta Branch

Branch: `beta/cross-platform-backend`

- [x] Define the cross-platform backend plan in `docs/implementation_plan.md`.
- [x] Increment beta build naming from `0.1.0` to `0.1.1-beta.1`.
- [x] Add beta packaging scripts for macOS, Windows, and Linux.
- [x] Add a main-process audio backend selection boundary.
- [x] Wrap current macOS Core Audio helper access behind a macOS backend.
- [x] Add an unsupported backend for non-macOS platforms.
- [x] Expose audio backend capabilities to the renderer.
- [x] Disable unsupported source controls based on backend capabilities.
- [x] Move macOS helper build output to `native/audio-backends/macos/.build/SurroundAudioBackend`.
- [x] Package the macOS helper as `audio-backend` while retaining legacy path fallback.
- [x] Move macOS helper launcher into `src/main/audio-backends/macos/core-audio-helper.js`.
- [x] Move macOS FFmpeg/Core Audio input device scanner into `src/main/audio-backends/macos/device-scanner.js`.
- [x] Remove main-level `app-audio-helper.js` and `device-scanner.js`.
- [x] Remove unused macOS-only `monitor-scanner.js`.
- [x] Share backend PCM pipe and FFmpeg input argument setup in `ffmpeg-manager.js`.
- [x] Verify `npm run build`.
- [x] Verify `npm run build:beta:mac`.
- [x] Verify `codesign --verify --deep --strict --verbose=2 dist/beta/mac-arm64/SurroundStreamer-beta-0.1.1.app`.
- [x] Verify `npm run build:mac:dir` packages `Contents/Resources/audio-backend`.
- [x] Verify `codesign --verify --deep --strict --verbose=2 dist/mac-arm64/SurroundStreamer.app`.
- [ ] Smoke-test App Audio streaming on the new beta app.
- [ ] Smoke-test Input Device streaming on the new beta app.
- [ ] Smoke-test File source streaming on the new beta app.
- [ ] Start File-only Windows/Linux packaging validation after macOS behavior is confirmed.
