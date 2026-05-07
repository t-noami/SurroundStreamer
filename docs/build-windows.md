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

For a clean clone or CI build, `npm ci` is also appropriate because this repository includes `package-lock.json`.

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

## Current Functional Limitations

- The current app audio capture implementation depends on macOS Core Audio process taps. Windows needs a separate capture backend, such as WASAPI loopback, before App Audio capture can be considered functional.
- The current input-device streaming path also uses the macOS Core Audio helper. Windows needs a separate input-device capture path before Input Device source can be considered functional.
- File source and renderer-only UI paths are the safest initial smoke-test targets on Windows.
- Monitor Output behavior must be revalidated on Windows because output-device enumeration and routing are platform-specific.

## Packaging Notes

- Electron Builder supports Windows targets such as NSIS, NSIS Web, portable, AppX, MSI, and Squirrel.Windows. This repository currently configures NSIS.
- NSIS is Electron Builder's default Windows installer target. The current config creates a desktop shortcut and names the executable `SurroundStreamer`.
- Windows code signing is optional for local testing, but it is important for public distribution. Without a trusted code-signing certificate, users should expect SmartScreen or installer trust warnings.
- Electron Builder can sign Windows builds when certificate settings are provided through `CSC_LINK` / `CSC_KEY_PASSWORD` or Windows-specific `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`.
- Cross-building Windows packages from macOS or Linux can work for simple Electron apps, but native or platform-specific dependencies should be built and tested on Windows or a Windows CI runner.
- `ffmpeg-static` downloads an OS-specific FFmpeg binary during install. If `node_modules` was created on another OS, delete `node_modules` and reinstall dependencies on Windows before packaging.
- Keep `test_streamconfig.txt` out of the package and out of Git. It can contain sensitive server details.

## Suggested Verification

- Run `npm run build` and confirm the Electron renderer/main bundles are created under `out/`.
- Run `npm run build:win` and confirm an NSIS installer is written under `dist/`.
- Install the generated package on a clean Windows machine or VM.
- Launch the app and confirm it opens without missing-binary errors.
- Smoke-test File source playback/streaming first.
- Confirm that App Audio and Input Device are either disabled, clearly marked unsupported, or implemented with a Windows backend before any Windows release.
- Check whether Windows Defender SmartScreen or unsigned-installer warnings appear.

## Notes

- Build Windows artifacts on Windows or in a Windows CI runner.
- The macOS `AudioTapHelper` is not built or packaged for Windows.
- `ffmpeg-static` provides the FFmpeg binary for the current platform during install.
- `test_streamconfig.txt` is intentionally excluded from packaged apps.

## References

- Electron Builder multi-platform build notes: https://www.electron.build/multi-platform-build.html
- Electron Builder NSIS target: https://www.electron.build/nsis.html
- Electron Builder Windows code signing: https://www.electron.build/code-signing-win.html
- `ffmpeg-static` platform binary notes: https://www.npmjs.com/package/ffmpeg-static
