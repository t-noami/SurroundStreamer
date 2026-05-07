# Build On Linux

Linux packaging is available through Electron Builder, but SurroundStreamer is currently a macOS-first audio app. The Core Audio capture helper is macOS-specific, so App Audio capture and Input Device capture need a Linux audio backend before this build can be treated as a fully functional Linux release.

Linux downloads are currently marked as preparing in `README.md`. Do not publish Linux artifacts as official release downloads until the Linux audio backend and package behavior have been validated.

## Requirements

- A recent Linux distribution
- Node.js 20 or later
- npm
- Git
- Network access for the first `npm install`

## Install Dependencies

From the repository root:

```bash
npm install
```

For a clean clone or CI build, `npm ci` is also appropriate because this repository includes `package-lock.json`.

## Development Run

```bash
npm run dev
```

## Build Renderer And Main Bundles

```bash
npm run build
```

## Build Linux Packages

```bash
npm run build:linux
```

Configured Linux targets:

- AppImage
- snap
- deb

Output is written under:

```text
dist/
```

## Current Functional Limitations

- The current app audio capture implementation depends on macOS Core Audio process taps. Linux needs a separate capture backend, likely based on PipeWire or PulseAudio monitor sources, before App Audio capture can be considered functional.
- The current input-device streaming path also uses the macOS Core Audio helper. Linux needs a separate input-device capture path before Input Device source can be considered functional.
- File source and renderer-only UI paths are the safest initial smoke-test targets on Linux.
- Monitor Output behavior must be revalidated on Linux because device enumeration, default output routing, and sandbox rules differ by distribution and package type.

## Packaging Notes

- Electron Builder supports many Linux targets. This repository currently configures AppImage, snap, and deb.
- AppImage is the most portable initial artifact, but the target system needs FUSE support. On Ubuntu 22.04, `libfuse2` may be required; on Ubuntu 24.04, the package is commonly `libfuse2t64`.
- Do not wrap an AppImage inside another archive such as `.zip` or `.tar.gz`; distribute the AppImage directly.
- Snap builds use strict confinement by default. Audio capture, file access, and device access may require explicit snap plugs or a different confinement strategy before a functional Linux release.
- deb packages are distribution-family specific. Test on the oldest supported Debian/Ubuntu target to avoid accidentally depending on newer system libraries.
- Electron Builder's Linux Docker images can be used to avoid installing every system dependency directly on the host.
- `ffmpeg-static` downloads an OS-specific FFmpeg binary during install. If `node_modules` was created on another OS, delete `node_modules` and reinstall dependencies on Linux before packaging.
- Keep `test_streamconfig.txt` out of the package and out of Git. It can contain sensitive server details.

## Suggested Verification

- Run `npm run build` and confirm the Electron renderer/main bundles are created under `out/`.
- Run `npm run build:linux` and confirm AppImage, snap, and deb artifacts are written under `dist/`.
- Test the AppImage on a clean Linux VM with the target distribution.
- Confirm FUSE is available before testing AppImage launch.
- Install and test the deb package on a clean Debian/Ubuntu system.
- Test snap separately because confinement can change behavior compared with AppImage/deb.
- Smoke-test File source playback/streaming first.
- Confirm that App Audio and Input Device are either disabled, clearly marked unsupported, or implemented with a Linux backend before any Linux release.

## Notes

- Build Linux artifacts on Linux or in a Linux CI runner.
- Some Linux targets may require additional system packaging tools depending on the distribution.
- Running AppImage files may require FUSE support on the target system.
- The macOS `AudioTapHelper` is not built or packaged for Linux.
- `ffmpeg-static` provides the FFmpeg binary for the current platform during install.
- `test_streamconfig.txt` is intentionally excluded from packaged apps.

## References

- Electron Builder multi-platform build notes: https://www.electron.build/multi-platform-build.html
- Electron Builder Linux target configuration: https://www.electron.build/linux
- Electron Builder Snap target: https://www.electron.build/snap.html
- AppImage FUSE troubleshooting: https://docs.appimage.org/user-guide/troubleshooting/fuse.html
- `ffmpeg-static` platform binary notes: https://www.npmjs.com/package/ffmpeg-static
