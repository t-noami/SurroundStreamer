# Build On Windows

Windows packaging is available through Electron Builder, but SurroundStreamer is currently a macOS-first audio app. The Core Audio capture helper is macOS-specific, so App Audio capture and Input Device capture need a Windows audio backend before this build can be treated as a fully functional Windows release.

## Requirements

- Windows 10 or later
- Node.js 20 or later
- npm
- Git
- Network access for the first `npm install`

## Install Dependencies

From the repository root:

```powershell
npm install
```

## Development Run

```powershell
npm run dev
```

## Build Renderer And Main Bundles

```powershell
npm run build
```

## Build Windows Installer

```powershell
npm run build:win
```

Output is written under:

```text
dist/
```

The configured Windows target is NSIS.

## Notes

- Build Windows artifacts on Windows or in a Windows CI runner.
- The macOS `AudioTapHelper` is not built or packaged for Windows.
- `ffmpeg-static` provides the FFmpeg binary for the current platform during install.
- `test_streamconfig.txt` is intentionally excluded from packaged apps.
