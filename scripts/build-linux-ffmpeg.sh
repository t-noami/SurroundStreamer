#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FFMPEG_VERSION="${FFMPEG_VERSION:-8.1}"
FFMPEG_SHA256="${FFMPEG_SHA256:-B072AED6871998CCE9B36E7774033105CA29E33632BE5B6347F3206898E0756A}"
BUILD_ROOT="${FFMPEG_BUILD_ROOT:-/tmp/surroundstreamer-ffmpeg-linux}"
OUTPUT_DIR="${1:-$ROOT_DIR/resources/ffmpeg/linux-x64}"
JOBS="${JOBS:-$(nproc)}"

if [[ "$(uname -s)" != "Linux" || "$(uname -m)" != "x86_64" ]]; then
  echo "Linux FFmpeg release binaries must be built on Linux x86_64." >&2
  echo "Use the GitHub Actions workflow or a Linux x64 machine/VM." >&2
  exit 1
fi

command -v curl >/dev/null
command -v sha256sum >/dev/null
command -v tar >/dev/null
command -v make >/dev/null
command -v pkg-config >/dev/null

rm -rf "$BUILD_ROOT"
mkdir -p "$BUILD_ROOT" "$OUTPUT_DIR"
cd "$BUILD_ROOT"

curl -L -o "ffmpeg-${FFMPEG_VERSION}.tar.xz" "https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz"
printf '%s  %s\n' "$FFMPEG_SHA256" "ffmpeg-${FFMPEG_VERSION}.tar.xz" | sha256sum -c -
tar -xf "ffmpeg-${FFMPEG_VERSION}.tar.xz"
cd "ffmpeg-${FFMPEG_VERSION}"

./configure \
  --prefix="$BUILD_ROOT/dist" \
  --arch=x86_64 \
  --target-os=linux \
  --enable-static \
  --disable-shared \
  --disable-doc \
  --disable-debug \
  --disable-ffplay \
  --disable-ffprobe \
  --disable-autodetect \
  --disable-everything \
  --enable-ffmpeg \
  --enable-network \
  --enable-protocol=file,pipe,icecast,tcp,http \
  --enable-indev=alsa,pulse \
  --enable-demuxer=pcm_f32le,wav,aiff,caf,flac,ogg,mp3,mov,matroska,aac \
  --enable-muxer=pcm_f32le,ogg,mp3 \
  --enable-parser=aac,flac,mpegaudio,opus,vorbis \
  --enable-decoder=pcm_f32le,pcm_f32be,pcm_s16le,pcm_s16be,pcm_s24le,pcm_s24be,pcm_s32le,pcm_s32be,flac,vorbis,opus,mp3,aac,alac \
  --enable-encoder=pcm_f32le,libopus,libmp3lame \
  --enable-filter=ametadata,anull,anullsink,aresample,asetnsamples,asplit,astats,headphone,pan,volume,aformat \
  --enable-libopus \
  --enable-libmp3lame \
  --enable-libpulse \
  --enable-alsa

make -j"$JOBS"
cp ffmpeg "$OUTPUT_DIR/ffmpeg"
chmod 755 "$OUTPUT_DIR/ffmpeg"

node "$ROOT_DIR/scripts/check-ffmpeg-license.mjs" "$OUTPUT_DIR/ffmpeg"
sha256sum "$OUTPUT_DIR/ffmpeg" > "$OUTPUT_DIR/SHA256SUMS"

echo "Linux FFmpeg binary written to $OUTPUT_DIR/ffmpeg"
