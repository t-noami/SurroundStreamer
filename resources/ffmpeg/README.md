Vetted FFmpeg binaries for release packaging belong in platform-specific
subdirectories:

- `darwin-arm64/ffmpeg`
- `win32-x64/ffmpeg.exe`
- `linux-x64/ffmpeg`

Do not place an `--enable-nonfree` FFmpeg build here. Release scripts run the target-platform
FFmpeg license check and reject nonfree builds:

```bash
npm run check:ffmpeg-license:mac
npm run check:ffmpeg-license:win
npm run check:ffmpeg-license:linux
```

GPL builds are also rejected by default; set `SURROUNDSTREAMER_ALLOW_GPL_FFMPEG=1` only for an
intentional GPL distribution.

The packaged binary must provide the audio features used by SurroundStreamer:

- libopus and libmp3lame encoders
- f32le, Ogg, MP3, WAV, FLAC, AIFF/AIF, and CAF demuxing/muxing as applicable
- AAC, ALAC, FLAC, MP3, Opus, Vorbis, and PCM audio decoding
- `headphone`, `pan`, `volume`, `aresample`, `asetnsamples`, `astats`,
  `ametadata`, `asplit`, `anull`, and `anullsink` filters
- file, pipe, and icecast protocols
- avfoundation on macOS, dshow on Windows, and pulse/alsa on Linux if those backend paths are built

Each distributed binary must have matching notice and license information in this directory.
AIFF/AIF and CAF support is provided by FFmpeg's own LGPL demuxers and does not add an external
library license. For the current binaries, see:

- `THIRD_PARTY_NOTICES.md`
- `licenses/FFmpeg-LICENSE.md`
- `licenses/FFmpeg-COPYING.LGPLv2.1`
- `licenses/libopus-COPYING`
- `licenses/LAME-COPYING`
