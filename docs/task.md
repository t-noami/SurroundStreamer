# SurroundStreamer — Task Status

## Current Release Status

- [x] Beta changes stabilized enough to promote to the regular `SurroundStreamer.app` build
- [x] App Audio source set as primary first source
- [x] Input Device source moved to Core Audio helper PCM capture instead of direct FFmpeg `avfoundation`
- [x] Input Device source disables Monitor Output controls
- [x] File source preview monitor sample-rate/channel initialization fixed
- [x] App quit shuts down FFmpeg, App Audio helper, Input Device helper, and preview monitor processes
- [x] Monitor meters updated to a faster cadence
- [x] KU100 near-field HRIR monitor mode added with third-party attribution
- [x] Standard stream templates limited to Mono, Stereo, Stereo + C, 5.1, and 7.1
- [x] Icecast connection settings are persisted between app launches
- [x] Closing the main window quits the app and runs streaming shutdown
- [x] Package config excludes `dist/`, `legacy/`, `src/`, and cache directories recursively
- [x] First-run Icecast defaults use blank host/password, port `8000`, and mount `/stream`
- [x] Integrate screenshot-based user manual into `README.md`
- [x] Remove development-oriented app category/default menu from packaged builds
- [x] Replace placeholder developer metadata with Non-REM Studio / t-noami
- [x] Add Non-REM Studio contact address `info@non-rem.com`
- [x] 7.1.2 / 7.1.4 experimental build retained separately as research history

## Release Verification

- [x] Build regular app at `dist/mac-arm64/SurroundStreamer.app`
- [x] Build beta app at `dist/beta/mac-arm64/SurroundStreamer-beta-0.1.0.app`
- [x] Verify code signature
- [ ] Launch regular app
- [ ] App Audio streaming test to Icecast
- [ ] File source streaming test to Icecast
- [ ] Input Device streaming test to Icecast
- [ ] Confirm app quit stops all child processes
- [ ] Confirm Monitor Output for App Audio and File
- [ ] Confirm Input Device monitor controls are disabled

## Known Follow-Up Work

- [x] Add persistent Icecast connection settings storage
- [ ] Add user-visible license/about screen for third-party notices
- [ ] Add deeper KU100 far-field mode for speaker-layout monitoring
- [ ] Add full-sphere HRIR extraction if height-channel monitor support returns
- [ ] Investigate optional MP3 stereo streaming
- [ ] Investigate optional Ogg Vorbis multichannel streaming up to 7.1
- [ ] Revisit 7.1.4 only as a research-mode feature after player compatibility is proven

## Notes

- `test_streamconfig.txt` is for local test convenience and should remain private.
- Current production target is Ogg Opus up to 7.1.
- 48 kHz is the practical stream-output default for Opus.
