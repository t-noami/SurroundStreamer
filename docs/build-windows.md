# Build On Windows

This document describes the Windows beta build path. Windows is still beta-only, but the
`0.1.1-beta.10` line now has a validated local Windows package for ASIO Audio Input, MMDevice/WASAPI
Audio Input, File source, monitor output routing, and Icecast Opus streaming.

Do not treat `npm run build:win` as the supported Windows path. Use the beta config and build the
native helper first.

## Current Status

- Official Windows release: not available.
- Windows release numbering: use the `0.1.1` line for release-preparation artifacts; the current beta metadata is `0.1.1-beta.10`.
- Windows beta package: available locally from the beta branch after helper build and beta packaging.
- Windows beta branch backend: `windows-wasapi` when the native helper is built. The helper supports MMDevice/WASAPI and ASIO Audio Input capture; ASIO is the primary validation target for surround/multichannel input, while MMDevice/WASAPI is useful for generic mono/stereo inputs. DirectShow is retained as a fallback.
- App Audio capture: removed from the supported input-source UI. WASAPI Process Loopback source remains research/reference code only.
- Audio Input capture: native ASIO and MMDevice/WASAPI paths are available. For 5.1 or higher channel counts, validate ASIO first. The older FFmpeg DirectShow path remains as fallback when the native helper is missing.
- Audio Input Monitor Output: Windows ASIO input can use the backend-owned FFmpeg/WASAPI monitor renderer with backend WASAPI output-device selection. Generic device/file paths still use the shared WebAudio monitor where appropriate.
- Output loopback capture: the earlier DirectShow loopback/virtual-device bridge is kept as a development reference.
- File source support: available in the Windows beta app.
- Local beta packaging: `npx electron-builder --win --config electron-builder.beta.yml --config.directories.output=dist/beta-stream-live-fix` produced `dist/beta-stream-live-fix/SurroundStreamer-beta-0.1.1-setup.exe` on Windows.
- Local app launch smoke test: `dist/beta-stream-live-fix/win-unpacked/SurroundStreamer-beta-0.1.1.exe` starts on Windows when `ELECTRON_RUN_AS_NODE` is not set.
- Local stream smoke test: FFmpeg Opus streaming to Icecast succeeded after clearing inherited proxy variables from FFmpeg child processes and converting the Opus output layout from `5.1(side)` to `5.1`.

## Required Work

Windows support now has a native helper entry point plus the experimental DirectShow audio-input bridge.

Build the native Windows helper before building a Windows beta that should expose native Audio Input capture:

```powershell
npm run build:audio-helper:win
npm run build:beta:win
```

The helper build produces:

```text
native/audio-backends/windows/.build/SurroundAudioBackend.exe
```

For the current platform assessment, see:

- [Windows / Linux Portability Assessment](windows-linux-portability-assessment.md)
- [Windows Backend Development Guide](windows-backend-development.md)

## Packaging Note

`npm run build:beta:win` does not build the native helper by itself. It packages whatever
`native/audio-backends/windows/.build/SurroundAudioBackend.exe` is already present, if any.

The blocker for a public stable Windows release is no longer "missing backend code." The current
remaining release blockers are signing/SmartScreen, broader ASIO device compatibility, channel-order
documentation, long-run capture stability, and installer/update policy. WASAPI/MMDevice and
DirectShow fallback remain secondary validation paths for non-surround input.

The beta config currently disables Windows executable signing/resource editing with `win.signAndEditExecutable: false` so local unsigned development packaging does not require the `winCodeSign` symlink extraction path. Re-enable and retest signing/resource metadata before publishing any Windows build.

The beta packaging target is reserved for development experiments. If a Windows beta executable is generated from `beta/cross-platform-backend`, it should use the `0.1.1` release line with beta metadata, currently `0.1.1-beta.10`. Do not generate new Windows artifacts with the old `0.1.0` release number.

Before changing shared backend files for Windows work, read [Windows Backend Development Guide](windows-backend-development.md). The current macOS beta backend must continue to build after Windows changes.

## Latest Local Beta Artifact

```text
dist/beta-stream-live-fix/SurroundStreamer-beta-0.1.1-setup.exe
dist/beta-stream-live-fix/win-unpacked/SurroundStreamer-beta-0.1.1.exe
```

The unpacked app writes persistent runtime logs to:

```text
%APPDATA%/surround-streamer/surround-streamer.log
```
