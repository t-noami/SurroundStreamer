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

## Current Windows x64 Binary

- Binary: `resources/ffmpeg/win32-x64/ffmpeg.exe`
- FFmpeg version: 8.1
- FFmpeg source: https://ffmpeg.org/releases/ffmpeg-8.1.tar.xz
- FFmpeg source SHA-256: `B072AED6871998CCE9B36E7774033105CA29E33632BE5B6347F3206898E0756A`
- Binary SHA-256: `51722EF2828D4D5075DA84ED5CF0D4CFFEED2C11D20F761338AC06AF1063A8D1`
- FFmpeg project: https://ffmpeg.org/
- Build environment: MSYS2 UCRT64 with GCC 16.1.0
- Effective FFmpeg license for this build: LGPL version 2.1 or later

Configure line:

```text
--prefix=/usr/local --arch=x86_64 --target-os=mingw32 --enable-static --disable-shared --disable-doc --disable-debug --disable-ffplay --disable-ffprobe --disable-autodetect --disable-everything --enable-ffmpeg --enable-network --enable-protocol=file,pipe,icecast,tcp,http --enable-indev=dshow --enable-demuxer=pcm_f32le,wav,aiff,caf,flac,ogg,mp3,mov,matroska --enable-muxer=pcm_f32le,ogg,mp3 --enable-parser=aac,flac,mpegaudio,opus,vorbis --enable-decoder=pcm_f32le,pcm_f32be,pcm_s16le,pcm_s16be,pcm_s24le,pcm_s24be,pcm_s32le,pcm_s32be,flac,vorbis,opus,mp3,aac,alac --enable-encoder=pcm_f32le,libopus,libmp3lame --enable-filter=ametadata,anull,anullsink,aresample,asetnsamples,asplit,astats,headphone,pan,volume,aformat --enable-libopus --enable-libmp3lame --pkg-config-flags=--static --extra-ldflags=-static
```

This Windows build intentionally includes only the FFmpeg program and the audio demuxers, decoders,
encoders, protocols, filters, and DirectShow input needed by SurroundStreamer. AIFF/AIF and CAF are
handled by FFmpeg's built-in LGPL demuxers and do not add an external library license.

This build must not include `--enable-gpl` or `--enable-nonfree`.

## Included External Libraries

### libopus

- Version used for the current macOS build: 1.5.2
- Version used for the current Windows build: 1.6.1
- Project: https://opus-codec.org/
- License: 3-clause BSD license
- License text: `licenses/libopus-COPYING`

### LAME / libmp3lame

- Version used for the current macOS build: 3.100
- Version used for the current Windows build: 3.100
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
4. Run the target-platform FFmpeg check, for example `npm run check:ffmpeg-license:mac` or
   `npm run check:ffmpeg-license:win`.
5. Run `npm run check:package-licenses -- <packaged-app-or-dist-dir>` after packaging.
6. Keep this notice and the license files with the distribution.
