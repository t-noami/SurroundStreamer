# FFmpeg Binary Notices

SurroundStreamer release packages may include platform-specific FFmpeg binaries under
`resources/ffmpeg/<platform>-<arch>/`.

## Current macOS Apple Silicon Binary

- Binary: `resources/ffmpeg/darwin-arm64/ffmpeg`
- FFmpeg version: 8.0
- FFmpeg source: https://ffmpeg.org/releases/ffmpeg-8.0.tar.xz
- FFmpeg project: https://ffmpeg.org/
- Effective FFmpeg license for this build: LGPL version 2.1 or later

Configure line:

```text
--prefix=/private/tmp/ffmpeg-dist --cc=clang --arch=arm64 --target-os=darwin --enable-static --disable-shared --disable-doc --disable-debug --disable-ffplay --disable-ffprobe --disable-sdl2 --enable-libopus --enable-libmp3lame --extra-cflags='-I/opt/homebrew/opt/opus/include/opus -I/opt/homebrew/opt/lame/include' --extra-ldflags=-L/private/tmp/ffmpeg-static-libs
```

This build must not include `--enable-gpl` or `--enable-nonfree`.

## Included External Libraries

### libopus

- Version used for the current macOS build: 1.5.2
- Project: https://opus-codec.org/
- License: 3-clause BSD license
- License text: `licenses/libopus-COPYING`

### LAME / libmp3lame

- Version used for the current macOS build: 3.100
- Project: https://lame.sourceforge.io/
- License: GNU Lesser General Public License
- License text: `licenses/LAME-COPYING`

## FFmpeg License Texts

- FFmpeg license overview: `licenses/FFmpeg-LICENSE.md`
- FFmpeg LGPL v2.1 text: `licenses/FFmpeg-COPYING.LGPLv2.1`

## Redistribution Notes

Before publishing a package:

1. Build FFmpeg from source or another auditable source package.
2. Confirm `ffmpeg -hide_banner -version` does not contain `--enable-nonfree`.
3. Prefer LGPL-compatible builds without `--enable-gpl`.
4. Run `npm run check:ffmpeg-license -- resources/ffmpeg`.
5. Run `npm run check:package-licenses -- <packaged-app-or-dist-dir>` after packaging.
6. Keep this notice and the license files with the distribution.
