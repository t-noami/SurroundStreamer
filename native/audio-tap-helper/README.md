# Audio Tap Helper

Native macOS helper for Core Audio Process Tap experiments.

## Requirements

- macOS 14.2 or later for `AudioHardwareCreateProcessTap`
- Xcode command line tools

## Commands

```bash
bash scripts/build-audio-tap-helper.sh
native/audio-tap-helper/.build/AudioTapHelper --list-processes
native/audio-tap-helper/.build/AudioTapHelper --create-tap --pid <pid> --duration 2
```

The current helper can enumerate Core Audio process objects and create a short-lived stereo process tap for validation. PCM streaming into FFmpeg is the next implementation step.

## PCM streaming mode

`AudioTapHelper` also supports a long-running PCM mode used by the Electron main process:

```bash
native/audio-tap-helper/.build/AudioTapHelper --stream-pcm --pid <pid>
```

This creates a private Core Audio process tap for the target PID, attaches it to a private aggregate device, starts an IOProc, and writes raw 32-bit float PCM to stdout. Status and format lines are emitted to stderr as JSON.

Current capture mode is stereo mixdown. Multichannel app-audio capture is a separate phase and requires validating device/stream-specific taps.

## Preserve Surround mode

Output devices and streams can be listed with:

```bash
native/audio-tap-helper/.build/AudioTapHelper --list-output-streams
```

To capture the tapped app using a specific output device stream instead of stereo mixdown:

```bash
native/audio-tap-helper/.build/AudioTapHelper \
  --stream-pcm \
  --pid <pid> \
  --device-uid <core-audio-device-uid> \
  --stream-index <stream-index>
```

This uses `CATapDescription initWithProcesses:andDeviceUID:withStream:`. The resulting tap format should follow the selected output stream. This only preserves surround when the target application is actually sending multichannel PCM to that output stream.
