# SurroundStreamer Implementation Plan

Last updated: 2026-05-08

## Project Summary

SurroundStreamer is a macOS Electron application for streaming Ogg Opus audio to Icecast.
The current practical target is macOS Apple Silicon because the audio capture implementation depends on Core Audio process taps and a native Core Audio helper.

The current public-facing release line is `v0.1.0`.

## Repository State

- Application license: MIT License.
- Third-party HRIR data: KU100 near-field HRIR extraction, CC BY 4.0.
- Main documentation: `README.md`.
- Build documents:
  - `docs/build-macos.md`
  - `docs/build-windows.md`
  - `docs/build-linux.md`
- Release notes:
  - `docs/releases/v0.1.0.md`
  - `docs/releases/v0.1.0-beta.1.md`
- Release status:
  - The current beta implementation is promoted to the regular `0.1.0` build line.
  - Regular macOS release artifact target: `dist/SurroundStreamer-0.1.0.dmg`.
  - Previous beta GitHub Release exists as a draft prerelease for `v0.1.0-beta.1`.
- Removed from Git tracking:
  - `legacy/`
  - `SurroundWebPlayer/`
- Private local-only file:
  - `test_streamconfig.txt`

## Current Architecture

```text
Renderer UI
  -> preload IPC bridge
  -> Electron main process
  -> FFmpeg manager
  -> FFmpeg process
  -> Icecast Ogg Opus stream
```

### Main Process

Key modules:

- `src/main/index.js`
  - Electron app lifecycle.
  - Main window creation.
  - Quit handling and process cleanup.
- `src/main/ipc-handlers.js`
  - Renderer/Main IPC registration.
- `src/main/ffmpeg-manager.js`
  - Builds FFmpeg arguments.
  - Starts/stops streaming processes.
  - Handles App Audio, Input Device, and File sources.
  - Parses FFmpeg logs and meter data.
- `src/main/app-audio-helper.js`
  - Launches the native Core Audio helper for App Audio process taps.
- `src/main/device-scanner.js`
  - Lists input devices.
- `src/main/monitor-scanner.js`
  - Lists monitor output devices.
- `src/main/media-prober.js`
  - Reads media metadata for File source.
- `src/main/ffmpeg-path.js`
  - Resolves bundled/system FFmpeg path.

### Native Helper

Path:

```text
native/audio-tap-helper/Sources/AudioTapHelper/main.m
```

Responsibilities:

- List Core Audio process/app capture candidates.
- List Core Audio output streams.
- Create process taps for App Audio capture.
- Capture Input Device PCM.
- Stream Float32 PCM to the Electron main process.

Build command:

```bash
npm run build:audio-helper
```

The helper requires a full Xcode macOS SDK that contains Core Audio process tap headers.

### Renderer

Key files:

- `src/renderer/index.html`
- `src/renderer/src/renderer.js`
- `src/renderer/src/monitor-audio.js`
- `src/renderer/src/monitor-worklet.js`
- `src/renderer/public/monitor-worklet.js`
- `src/renderer/src/ku100-near-hrir.js`
- `src/renderer/assets/main.css`

Responsibilities:

- Source selection UI.
- Encoding settings UI.
- Icecast settings persistence.
- Peak meter rendering.
- Monitor Output Web Audio graph.
- KU100 near-field HRTF monitor rendering.

## Input Sources

### App Audio

Current behavior:

- Primary source tab.
- Captures audio from a selected macOS app using Core Audio process taps.
- Uses `App Output Capture Source` to select the Core Audio output stream.
- Preserves multichannel capture when the selected stream and source app provide it.
- Stops stale preview/monitor processes when switching source tabs.

Open verification:

- Real-device channel order should be checked per output device and app.
- App Audio capture is macOS-specific.

### Input Device

Current behavior:

- Captures from a selected Core Audio input device through the native helper.
- Streams Float32 PCM into FFmpeg.
- Monitor Output controls are disabled while Input Device source is active.
- Requires macOS microphone permission.

Open verification:

- Real-device streaming stability should be checked with physical and virtual devices.
- Monitor Output for Input Device remains out of scope for the current standard build.

### File

Current behavior:

- Uses selected audio file as source.
- Supports loop playback.
- Supports preview/monitor output once a playable file is selected.
- Maximum standard channel template is 7.1.

Open verification:

- File source should be retested with mono, stereo, 5.1, and 7.1 samples before publishing a release.

## Encoding Model

Current defaults:

- Format: Ogg Opus.
- Sample rate: 48 kHz.
- Bitrate display: stereo-equivalent bitrate.
- Default bitrate: 128 kbps stereo-equivalent.
- Standard channel templates:
  - Mono
  - Stereo
  - Stereo + C
  - 5.1
  - 7.1

Implementation notes:

- 44.1 kHz and 96 kHz sources are normalized to Opus-compatible output behavior.
- Actual bitrate is adjusted by selected channel count.
- 7.1.2 and 7.1.4 are intentionally excluded from the standard build because common Ogg Opus player compatibility is not proven.

## Monitor Output

Current modes:

- Stereo Pair
- Stereo Downmix
- KU100 Near-field HRTF

Current behavior:

- Monitor Output is available for App Audio and File sources.
- Monitor Output is disabled for Input Device source.
- Monitor Volume is applied after monitor mode processing and does not affect streamed audio.
- Monitor meters display two-channel monitor output.
- Meter color thresholds:
  - above `-6 dB`: yellow
  - above `-1 dB`: red

KU100 HRIR notes:

- Uses a reduced JavaScript extraction from the KU100 near-field 1.0 m circular SOFA dataset.
- Third-party license: CC BY 4.0.
- Attribution is listed in `README.md`.
- LFE is not treated as a normal localized speaker in binaural rendering.

## Packaging

### macOS

Primary supported build.

Commands:

```bash
npm install
npm run build:mac
```

Important outputs:

```text
dist/mac-arm64/SurroundStreamer.app
dist/SurroundStreamer-0.1.0.dmg
```

Current release build status:

- Ad-hoc signed.
- Not notarized.
- Suitable for local distribution/testing, not yet notarized for public macOS distribution.

### Windows

Documentation exists, but release support is not ready.

Blocked by:

- No Windows audio capture backend.
- App Audio likely needs WASAPI loopback or equivalent.
- Input Device needs a Windows-specific capture path.
- Monitor Output/device routing needs platform validation.

### Linux

Documentation exists, but release support is not ready.

Blocked by:

- No Linux audio capture backend.
- App Audio likely needs PipeWire or PulseAudio monitor-source support.
- Input Device needs a Linux-specific capture path.
- AppImage/snap/deb need separate runtime validation.

## Release Process

For regular macOS releases:

1. Ensure working tree is clean.
2. Run:

   ```bash
   npm run build:mac
   ```

3. Verify signing:

   ```bash
   codesign --verify --deep --strict --verbose=2 \
     dist/mac-arm64/SurroundStreamer.app
   ```

4. Verify the DMG exists:

   ```bash
   ls -lh dist/SurroundStreamer-0.1.0.dmg
   ```

5. Update release notes under `docs/releases/`.
6. Commit and push.
7. Tag the release, for example:

   ```bash
   git tag -a v0.1.0 -m "SurroundStreamer v0.1.0"
   git push origin v0.1.0
   ```

8. Create or update the GitHub Release.

Current release target:

- Tag: `v0.1.0`
- Title: `SurroundStreamer v0.1.0`
- Artifact: `dist/SurroundStreamer-0.1.0.dmg`

## Roadmap

### Near Term

- Launch and smoke-test the DMG app on a clean macOS environment.
- Verify App Audio streaming to Icecast.
- Verify File source streaming to Icecast.
- Verify Stream Playback Check with `https://non-rem.com/SurroundWebPlayer/`.
- Verify quit cleanup for FFmpeg and helper processes.
- Verify the macOS About panel includes MIT and KU100 CC BY 4.0 attribution.
- Decide whether the first public release should remain ad-hoc signed or wait for notarization.

### Product Improvements

- Add clearer unsupported-platform messaging if Windows/Linux builds are produced.
- Improve real-device diagnostics for App Audio channel order.
- Add optional MP3 stereo streaming if compatibility pressure justifies it.
- Investigate Ogg Vorbis multichannel up to 7.1 as an optional path.

### Research Only

- 7.1.2 / 7.1.4 streaming compatibility.
- KU100 far-field HRIR mode.
- Full-sphere HRIR extraction for height-channel monitoring.
- Platform-specific audio capture backends for Windows and Linux.

## Historical Notes

Older plans referenced:

- AVFoundation input-device capture through FFmpeg.
- A `Tap Test` UI path.
- `Stereo Mixdown` as an App Audio primary mode.
- 7.1.2 / 7.1.4 as standard UI templates.
- Keeping `legacy/SurroundStreamer-old-version/` in the repository.
- Keeping `SurroundWebPlayer/` in the repository.

Those items are no longer the current plan. The current standard path is the macOS `0.1.0` release line described above.
