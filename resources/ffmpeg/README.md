Vetted FFmpeg binaries for release packaging belong in platform-specific
subdirectories:

- `darwin-arm64/ffmpeg`
- `win32-x64/ffmpeg.exe`
- `linux-x64/ffmpeg`

Do not place an `--enable-nonfree` FFmpeg build here. Release scripts run
`npm run check:ffmpeg-license` and reject nonfree builds. GPL builds are also
rejected by default; set `SURROUNDSTREAMER_ALLOW_GPL_FFMPEG=1` only for an
intentional GPL distribution.

The packaged binary must provide the audio features used by SurroundStreamer:

- libopus and libmp3lame encoders
- f32le, Ogg, MP3, WAV, and FLAC demuxing/muxing as applicable
- `headphone`, `pan`, `volume`, `aresample`, `asetnsamples`, `astats`,
  `ametadata`, `asplit`, `anull`, and `anullsink` filters
- file, pipe, and icecast protocols
- avfoundation on macOS and dshow on Windows if those backend paths are built

Each distributed binary must have matching notice and license information in this directory.
For the current macOS Apple Silicon binary, see:

- `THIRD_PARTY_NOTICES.md`
- `licenses/FFmpeg-LICENSE.md`
- `licenses/FFmpeg-COPYING.LGPLv2.1`
- `licenses/libopus-COPYING`
- `licenses/LAME-COPYING`
