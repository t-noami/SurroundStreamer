# Build On Windows

This document is currently being revised.

Windows downloads are marked as `Preparing` because the Windows audio backend is still beta-only and not yet release validated.

Do not treat `npm run build:win` or `npm run build:beta:win` as a supported public release path yet.

## Current Status

- Official Windows release: not available.
- Windows beta branch backend: `windows-wasapi-process-loopback` when the native helper is built, with DirectShow still used for Input Device capture.
- Supported Windows baseline: Windows 10 Build 20348 or later. Older Windows builds are intentionally unsupported for App Audio capture.
- App Audio capture: native WASAPI Process Loopback helper source has been added; local builds require Visual Studio 2022 Desktop development with C++.
- Input Device capture: experimental FFmpeg DirectShow path is available for validation.
- Input Device Monitor Output: experimental FFmpeg DirectShow preview path is available for validation.
- Output loopback capture: the earlier DirectShow loopback/virtual-device bridge is kept as a development reference, but the selected Windows backend now targets WASAPI per-process capture.
- Preserve-surround app capture: not implemented on Windows.
- File source support: first practical Windows target, but not yet validated as a release build.
- Local beta packaging: `npm run build:beta:win` has produced `dist/beta/SurroundStreamer-beta-0.1.1-setup.exe` on Windows.
- Local app launch smoke test: `dist/beta/win-unpacked/SurroundStreamer-beta-0.1.1.exe` starts on Windows when `ELECTRON_RUN_AS_NODE` is not set.

## Required Work

Windows support now has a WASAPI Process Loopback helper entry point plus the experimental DirectShow input-device bridge.

Build the native Windows helper before building a Windows beta that should expose App Audio:

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

Electron Builder configuration may still be useful later, but packaging is not the blocker. The blocker is the missing Windows audio capture backend.

The beta config currently disables Windows executable signing/resource editing with `win.signAndEditExecutable: false` so local unsigned development packaging does not require the `winCodeSign` symlink extraction path. Re-enable and retest signing/resource metadata before publishing any Windows build.

The beta packaging target is reserved for development experiments. If a Windows beta executable is generated from `beta/cross-platform-backend`, it should use the incremented beta version line, currently `0.1.1-beta.1`, rather than the stable `0.1.0` version.

Before changing shared backend files for Windows work, read [Windows Backend Development Guide](windows-backend-development.md). The current macOS beta backend must continue to build after Windows changes.
