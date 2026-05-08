# Build On Windows

This document is currently being revised.

Windows downloads are marked as `Preparing` because the current SurroundStreamer audio capture implementation is macOS-specific. A Windows package created only by Electron Builder would not provide feature parity with the macOS release.

Do not treat `npm run build:win` or `npm run build:beta:win` as a supported public release path yet.

## Current Status

- Official Windows release: not available.
- App Audio capture: not implemented on Windows.
- Input Device capture: not implemented on Windows.
- Preserve-surround app capture: not implemented on Windows.
- File source support: likely the first practical Windows target, but not yet validated as a release build.

## Required Work

Windows support needs a Windows audio backend, likely based on Microsoft Core Audio APIs such as WASAPI, MMDevice API, and Audio Session APIs.

For the current platform assessment, see:

- [Windows / Linux Portability Assessment](windows-linux-portability-assessment.md)
- [Windows Backend Development Guide](windows-backend-development.md)

## Packaging Note

Electron Builder configuration may still be useful later, but packaging is not the blocker. The blocker is the missing Windows audio capture backend.

The beta packaging target is reserved for development experiments. If a Windows beta executable is generated from `beta/cross-platform-backend`, it should use the incremented beta version line, currently `0.1.1-beta.1`, rather than the stable `0.1.0` version.

Before changing shared backend files for Windows work, read [Windows Backend Development Guide](windows-backend-development.md). The current macOS beta backend must continue to build after Windows changes.
