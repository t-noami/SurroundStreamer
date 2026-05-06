#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_FILE="$ROOT_DIR/native/audio-tap-helper/Sources/AudioTapHelper/main.m"
OUTPUT_DIR="$ROOT_DIR/native/audio-tap-helper/.build"
OUTPUT_FILE="$OUTPUT_DIR/AudioTapHelper"
SDKROOT="/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk"

mkdir -p "$OUTPUT_DIR"

xcrun clang \
  -isysroot "$SDKROOT" \
  -fobjc-arc \
  -mmacosx-version-min=14.2 \
  "$SOURCE_FILE" \
  -framework Foundation \
  -framework AppKit \
  -framework CoreAudio \
  -o "$OUTPUT_FILE"

chmod +x "$OUTPUT_FILE"
echo "$OUTPUT_FILE"
