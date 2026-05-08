# Build On Windows

This document is currently being revised.

Windows downloads are marked as `Preparing` because the current SurroundStreamer audio capture implementation is macOS-specific. A Windows package created only by Electron Builder would not provide feature parity with the macOS release.

Do not treat `npm run build:win` as a supported public release path yet.

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

## Packaging Note

Electron Builder configuration may still be useful later, but packaging is not the blocker. The blocker is the missing Windows audio capture backend.
