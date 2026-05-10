# Build On Windows

This document is currently being revised.

Windows downloads are marked as `Preparing` because the Windows audio backend is still beta-only and not yet release validated.

Do not treat `npm run build:win` or `npm run build:beta:win` as a supported public release path yet.

## Current Status

- Official Windows release: not available.
- Windows beta branch backend: `windows-wasapi` when the native helper is built. The helper supports MMDevice/WASAPI and ASIO Audio Input capture; ASIO is the primary validation target for surround/multichannel input, while MMDevice/WASAPI is useful for generic mono/stereo inputs. DirectShow is retained as a fallback.
- App Audio capture: removed from the supported input-source UI. WASAPI Process Loopback source remains research/reference code only.
- Audio Input capture: native ASIO and MMDevice/WASAPI paths are available for validation. For 5.1 or higher channel counts, validate ASIO first. The older FFmpeg DirectShow path remains as fallback when the native helper is missing.
- Audio Input Monitor Output: uses the shared WebAudio direct monitor path when browser audio-device access is available. Native Windows monitor paths are not exposed as release-ready.
- Output loopback capture: the earlier DirectShow loopback/virtual-device bridge is kept as a development reference.
- File source support: first practical Windows target, but not yet validated as a release build.
- Local beta packaging: `npm run build:beta:win` has produced `dist/beta/SurroundStreamer-beta-0.1.1-setup.exe` on Windows.
- Local app launch smoke test: `dist/beta/win-unpacked/SurroundStreamer-beta-0.1.1.exe` starts on Windows when `ELECTRON_RUN_AS_NODE` is not set.

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

The blocker for a public Windows release is no longer just "missing backend code." The current
blockers are release validation, helper build/package reliability, ASIO device compatibility,
channel ordering, and long-run capture stability. WASAPI/MMDevice and DirectShow fallback remain
secondary validation paths for non-surround input.

The beta config currently disables Windows executable signing/resource editing with `win.signAndEditExecutable: false` so local unsigned development packaging does not require the `winCodeSign` symlink extraction path. Re-enable and retest signing/resource metadata before publishing any Windows build.

The beta packaging target is reserved for development experiments. If a Windows beta executable is generated from `beta/cross-platform-backend`, it should use the incremented beta version line, currently `0.1.1-beta.10`, rather than the stable `0.1.0` version.

Before changing shared backend files for Windows work, read [Windows Backend Development Guide](windows-backend-development.md). The current macOS beta backend must continue to build after Windows changes.
