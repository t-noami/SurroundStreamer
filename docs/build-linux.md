# Build On Linux

This document is currently being revised.

Linux downloads are marked as `Preparing` because the current SurroundStreamer audio capture implementation is macOS-specific. A Linux package created only by Electron Builder would not provide feature parity with the macOS release.

Do not treat `npm run build:linux` as a supported public release path yet.

## Current Status

- Official Linux release: not available.
- App Audio capture: not implemented on Linux.
- Input Device capture: not implemented on Linux.
- Preserve-surround app capture: not implemented on Linux.
- File source support: likely the first practical Linux target, but not yet validated as a release build.

## Required Work

Linux support needs a Linux audio backend, likely based on PipeWire first, with PulseAudio or ALSA considered only as fallback/scope-limited paths.

For the current platform assessment, see:

- [Windows / Linux Portability Assessment](windows-linux-portability-assessment.md)

## Packaging Note

Electron Builder configuration may still be useful later, but packaging is not the blocker. The blocker is the missing Linux audio capture backend.
