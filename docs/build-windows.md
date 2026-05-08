# Build On Windows

This document is currently being revised.

Windows downloads are marked as `Preparing` because the current SurroundStreamer audio capture implementation is macOS-specific. A Windows package created only by Electron Builder would not provide feature parity with the macOS release.

Do not treat `npm run build:win` or `npm run build:beta:win` as a supported public release path yet.

## Current Status

- Official Windows release: not available.
- Windows beta branch backend: experimental DirectShow input backend added as `windows-dshow-input`.
- App Audio capture: not implemented on Windows.
- Input Device capture: experimental FFmpeg DirectShow path is available for validation.
- Input Device Monitor Output: experimental FFmpeg DirectShow preview path is available for validation.
- Output loopback capture: experimental DirectShow loopback/virtual-device bridge is available when the host exposes a loopback-like input device.
- Preserve-surround app capture: not implemented on Windows.
- File source support: first practical Windows target, but not yet validated as a release build.
- Local beta packaging: `npm run build:beta:win` has produced `dist/beta/SurroundStreamer-beta-0.1.1-setup.exe` on Windows.
- Local app launch smoke test: `dist/beta/win-unpacked/SurroundStreamer-beta-0.1.1.exe` starts on Windows when `ELECTRON_RUN_AS_NODE` is not set.

## Required Work

Windows support now has a conservative backend entry point plus an experimental DirectShow input-device bridge. A production Windows capture backend still likely needs Microsoft Core Audio APIs such as WASAPI, MMDevice API, and Audio Session APIs.

For the current platform assessment, see:

- [Windows / Linux Portability Assessment](windows-linux-portability-assessment.md)
- [Windows Backend Development Guide](windows-backend-development.md)

## Packaging Note

Electron Builder configuration may still be useful later, but packaging is not the blocker. The blocker is the missing Windows audio capture backend.

The beta config currently disables Windows executable signing/resource editing with `win.signAndEditExecutable: false` so local unsigned development packaging does not require the `winCodeSign` symlink extraction path. Re-enable and retest signing/resource metadata before publishing any Windows build.

The beta packaging target is reserved for development experiments. If a Windows beta executable is generated from `beta/cross-platform-backend`, it should use the incremented beta version line, currently `0.1.1-beta.1`, rather than the stable `0.1.0` version.

Before changing shared backend files for Windows work, read [Windows Backend Development Guide](windows-backend-development.md). The current macOS beta backend must continue to build after Windows changes.
