# Build On Linux

This document is currently being revised.

Linux downloads are marked as `Preparing` because Linux Audio Input capture is not implemented yet. A Linux package created only by Electron Builder would not provide feature parity with the macOS release.

Do not treat `npm run build:linux` or `npm run build:beta:linux` as a supported public release path yet.

## Current Status

- Official Linux release: not available.
- App Audio capture: removed from the supported input-source UI.
- Audio Input capture: not implemented on Linux.
- File source support: likely the first practical Linux target, but not yet validated as a release build.

## Required Work

Linux support needs a Linux Audio Input backend, likely based on PipeWire first, with PulseAudio or ALSA considered only as fallback/scope-limited paths.

For the current platform assessment, see:

- [Windows / Linux Portability Assessment](windows-linux-portability-assessment.md)

## Packaging Note

Electron Builder configuration may still be useful later, but packaging is not the blocker. The blocker is the missing Linux audio capture backend.

The beta packaging target is reserved for development experiments. If a Linux beta package is generated from `beta/cross-platform-backend`, it should use the incremented beta version line, currently `0.1.1-beta.1`, rather than the stable `0.1.0` version.
