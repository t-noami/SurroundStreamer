# Build On Linux

Linux packaging is available through Electron Builder, but SurroundStreamer is currently a macOS-first audio app. The Core Audio capture helper is macOS-specific, so App Audio capture and Input Device capture need a Linux audio backend before this build can be treated as a fully functional Linux release.

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

## Notes

- Build Linux artifacts on Linux or in a Linux CI runner.
- Some Linux targets may require additional system packaging tools depending on the distribution.
- Running AppImage files may require FUSE support on the target system.
- The macOS `AudioTapHelper` is not built or packaged for Linux.
- `ffmpeg-static` provides the FFmpeg binary for the current platform during install.
- `test_streamconfig.txt` is intentionally excluded from packaged apps.
