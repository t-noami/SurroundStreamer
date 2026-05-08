# Build On macOS

This is the primary supported build path for SurroundStreamer.

## Requirements

- macOS on Apple Silicon
- Node.js 20 or later
- npm
- Full Xcode with a macOS SDK that includes Core Audio process tap headers
- Network access for the first `npm install`

Install Xcode from the Mac App Store or Apple Developer, then make sure the command line tools are available:

```bash
xcode-select --install
```

If `xcode-select` points at Command Line Tools and the helper build cannot find `AudioHardwareTapping.h`, switch to full Xcode:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
```

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

## Build Native Core Audio Helper

```bash
npm run build:audio-helper
```

The helper output is:

```text
native/audio-tap-helper/.build/AudioTapHelper
```

## Build Regular App

```bash
npm run build:mac
```

Outputs:

```text
dist/mac-arm64/SurroundStreamer.app
dist/SurroundStreamer-0.1.0.dmg
dist/SurroundStreamer-0.1.0-arm64-mac.zip
```

For public release downloads, use the DMG artifact:

```text
dist/SurroundStreamer-0.1.0.dmg
```

## Build Beta App

Use this only for isolated beta test builds.

```bash
npm run build:beta:mac
```

Output:

```text
dist/beta/mac-arm64/SurroundStreamer-beta-0.1.1.app
```

## Optional Packaged macOS Artifact

For a directory-only app build without creating a DMG:

```bash
npm run build:mac:dir
```

This writes the unpacked app under:

```text
dist/mac-arm64/SurroundStreamer.app
```

## Verify App Signature

For a local unsigned/development build:

```bash
codesign --verify --deep --strict --verbose=2 dist/mac-arm64/SurroundStreamer.app
```

Verify the DMG before attaching it to a GitHub Release:

```bash
hdiutil verify dist/SurroundStreamer-0.1.0.dmg
```

Generate a checksum for release notes or support:

```bash
shasum -a 256 dist/SurroundStreamer-0.1.0.dmg
```

For beta builds:

```bash
codesign --verify --deep --strict --verbose=2 dist/beta/mac-arm64/SurroundStreamer-beta-0.1.1.app
```

## Notes

- The macOS build includes the Core Audio helper used for App Audio capture and Input Device capture.
- `test_streamconfig.txt` is intentionally excluded from packaged apps.
- The release DMG name is generated from Electron Builder's `productName`, so it should remain `SurroundStreamer-<version>.dmg`.
- The current Electron Builder config has notarization disabled.
