#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_FILE="$ROOT_DIR/native/audio-tap-helper/Sources/AudioTapHelper/main.m"
OUTPUT_DIR="$ROOT_DIR/native/audio-backends/macos/.build"
OUTPUT_FILE="$OUTPUT_DIR/SurroundAudioBackend"
LEGACY_OUTPUT_DIR="$ROOT_DIR/native/audio-tap-helper/.build"
LEGACY_OUTPUT_FILE="$LEGACY_OUTPUT_DIR/AudioTapHelper"
XCODE_SDK="/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk"
XCRUN_SDK="$(xcrun --sdk macosx --show-sdk-path)"
TAP_HEADER="System/Library/Frameworks/CoreAudio.framework/Headers/AudioHardwareTapping.h"

if [[ -f "$XCODE_SDK/$TAP_HEADER" ]]; then
  SDKROOT="$XCODE_SDK"
elif [[ -f "$XCRUN_SDK/$TAP_HEADER" ]]; then
  SDKROOT="$XCRUN_SDK"
else
  echo "AudioHardwareTapping.h was not found in the active macOS SDK." >&2
  echo "Install full Xcode with a macOS SDK that includes Core Audio process tap headers." >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR" "$LEGACY_OUTPUT_DIR"

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
cp "$OUTPUT_FILE" "$LEGACY_OUTPUT_FILE"
chmod +x "$LEGACY_OUTPUT_FILE"
echo "$OUTPUT_FILE"
