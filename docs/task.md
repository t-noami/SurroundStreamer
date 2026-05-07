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
