# Audio Tap Helper

Legacy/fallback macOS Core Audio helper source.

Current app scope:

- Supported app sources are Audio Input and File.
- File source bypasses this helper and uses FFmpeg file input.
- App Audio has been removed from the beta line.
- Process Tap commands remain research/reference only.

## Requirements

- macOS 14.2 or later for Core Audio process tap research commands
- Full Xcode with the macOS SDK required by `scripts/build-audio-tap-helper.sh`

## Build

```bash
bash scripts/build-audio-tap-helper.sh
```

Current packaging uses:

```text
native/audio-backends/macos/.build/SurroundAudioBackend
```

A legacy copy is also written to:

```text
native/audio-tap-helper/.build/AudioTapHelper
```

## Supported Audio Input Contract

Input stream listing:

```bash
native/audio-tap-helper/.build/AudioTapHelper --list-input-streams
```

Input device capture:

```bash
native/audio-tap-helper/.build/AudioTapHelper \
  --stream-audio-input \
  --device-uid <uid> \
  [--stream-index <index>]
```

stdout:

```text
raw 32-bit float little-endian PCM
```

stderr:

```json
{
  "event": "format",
  "mode": "input-device",
  "sampleRate": 48000,
  "channels": 2,
  "bitsPerChannel": 32
}
```

## Experimental Native Monitor

Native monitor paths are capability-gated and are not treated as release-ready.

```bash
native/audio-tap-helper/.build/AudioTapHelper \
  --monitor-input-device \
  --device-uid <uid> \
  [--stream-index <index>]
```

## Process Tap Research

These commands are retained for Core Audio Process Tap research. They are not current supported App
Audio or Preserve Surround features.

```bash
native/audio-tap-helper/.build/AudioTapHelper --list-processes
native/audio-tap-helper/.build/AudioTapHelper --create-tap --pid <pid> [--duration <seconds>]
native/audio-tap-helper/.build/AudioTapHelper --stream-pcm --pid <pid>
native/audio-tap-helper/.build/AudioTapHelper --list-output-streams
```
