# Build On macOS

This is the primary supported build path for SurroundStreamer. The v0.1.2 release updates only the macOS artifact; Windows and Linux artifacts remain on v0.1.1 and must not be rebuilt or attached as v0.1.2 assets.

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
native/audio-backends/macos/.build/SurroundAudioBackend
```

A legacy copy is also written to `native/audio-tap-helper/.build/AudioTapHelper` during the transition.

## Prepare Packaged FFmpeg

Release packaging no longer uses the `ffmpeg-static` npm package. Before running any Electron
Builder packaging command, place a vetted macOS Apple Silicon FFmpeg binary at:

```text
resources/ffmpeg/darwin-arm64/ffmpeg
```

The binary must provide the audio features used by SurroundStreamer, including libopus,
libmp3lame, the `headphone` filter, Ogg/MP3/f32le muxing, file/pipe/icecast protocols, and the
macOS `avfoundation` input device for device listing.

For the current release-preparation macOS binary, use an audited LGPL-compatible FFmpeg build. The
local build used for the current package was made from the official FFmpeg 8.0 source release:

```bash
curl -LO https://ffmpeg.org/releases/ffmpeg-8.0.tar.xz
tar -xf ffmpeg-8.0.tar.xz
cd ffmpeg-8.0
```

The current macOS Apple Silicon build links libopus and LAME statically and disables FFplay,
FFprobe, documentation, debug symbols, and shared FFmpeg libraries:

```bash
./configure \
  --prefix=/private/tmp/ffmpeg-dist \
  --cc=clang \
  --arch=arm64 \
  --target-os=darwin \
  --enable-static \
  --disable-shared \
  --disable-doc \
  --disable-debug \
  --disable-ffplay \
  --disable-ffprobe \
  --disable-sdl2 \
  --enable-libopus \
  --enable-libmp3lame \
  --extra-cflags='-I/opt/homebrew/opt/opus/include/opus -I/opt/homebrew/opt/lame/include' \
  --extra-ldflags=-L/private/tmp/ffmpeg-static-libs
make -j"$(sysctl -n hw.ncpu)"
cp ffmpeg /path/to/SurroundStreamer/resources/ffmpeg/darwin-arm64/ffmpeg
```

Do not add `--enable-gpl` or `--enable-nonfree` for the standard macOS distribution. Configure
should report `License: LGPL version 2.1 or later`.

Record the exact source version, configure line, and external library versions in
`resources/ffmpeg/THIRD_PARTY_NOTICES.md`, and keep the matching license texts under
`resources/ffmpeg/licenses/`.

Validate the binary before packaging:

```bash
npm run check:ffmpeg-license:mac
```

The check rejects `--enable-nonfree` builds. It also rejects `--enable-gpl` by default; set
`SURROUNDSTREAMER_ALLOW_GPL_FFMPEG=1` only for an intentional GPL distribution with matching
release notices and source obligations.

## Build Regular App

```bash
npm run build:mac
```

This command builds the helper, runs the FFmpeg distribution check, builds the Electron bundles, and
then creates the macOS package. If `resources/ffmpeg/darwin-arm64/ffmpeg` is missing, the packaging
step fails before a DMG is produced.

Outputs:

```text
dist/mac-arm64/SurroundStreamer.app
dist/SurroundStreamer-0.1.2.dmg
dist/SurroundStreamer-0.1.2-arm64-mac.zip
```

For public release downloads, use the DMG artifact:

```text
dist/SurroundStreamer-0.1.2.dmg
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
hdiutil verify dist/SurroundStreamer-0.1.2.dmg
```

Generate a checksum for release notes or support:

```bash
shasum -a 256 dist/SurroundStreamer-0.1.2.dmg
```

Confirm the packaged app did not accidentally include `ffmpeg-static` and that the FFmpeg binary
inside the artifact still passes the distribution check:

```bash
npm run check:package-licenses -- dist/mac-arm64/SurroundStreamer.app
```

For beta builds:

```bash
codesign --verify --deep --strict --verbose=2 dist/beta/mac-arm64/SurroundStreamer-beta-0.1.1.app
```

## Notes

- The macOS build includes the Core Audio helper used for Audio Input capture.
- Packaged builds include the vetted target-platform FFmpeg binary from `resources/ffmpeg/**`; do
  not rely on Homebrew FFmpeg or `ffmpeg-static` for release artifacts.
- For surround Audio Input streaming on macOS, use a Core Audio audio interface or virtual audio device with 6 or more channels for 5.1 or larger layouts.
- `test_streamconfig.txt` is intentionally excluded from packaged apps.
- The release DMG name is generated from Electron Builder's `productName`, so it should remain `SurroundStreamer-<version>.dmg`.
- The current Electron Builder config has notarization disabled.
