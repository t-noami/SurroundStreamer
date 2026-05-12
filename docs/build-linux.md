# Build On Linux

This document is currently being revised.

Linux downloads are marked as `Preparing` because Linux Audio Input capture now has only an
experimental backend implementation. A Linux package created by Electron Builder still does not
provide validated feature parity with the macOS or Windows release paths.

Do not treat `npm run build:linux` or `npm run build:beta:linux` as a supported public release path yet.

## Current Status

- Official Linux release: not available.
- Linux release numbering: use the `0.1.1` line for release-preparation artifacts; the current beta metadata is `0.1.1-beta.10`.
- App Audio capture: removed from the supported input-source UI.
- Audio Input capture: initial experimental backend implemented through PipeWire/PulseAudio
  compatibility or ALSA fallback; real Linux desktop validation is still required.
- File source support: enabled by the shared app/backend capability model, but Linux packaging and release validation are not complete.

## What The Current Linux Build Does

On Linux, the app now selects `src/main/audio-backends/linux-pipewire.js`. The backend is intended
for development validation first and should not be treated as public release support until the
validation checklist below passes on target distributions.

Current Linux backend capabilities:

- Backend name: `linux-pipewire-pulse` when FFmpeg and `pactl` are available, `linux-alsa` when
  only the ALSA fallback is available, or `linux-audio-pending` when runtime dependencies are
  missing.
- File source: enabled by the shared FFmpeg file-input path.
- Audio Input capture: enabled when the backend detects FFmpeg plus `pactl` or `arecord`.
- App Audio capture: removed from the current beta line and not a Linux implementation target.
- Monitor playback: limited to shared WebAudio paths where available.
- Linux package artifacts are development experiments only, not public release artifacts.

A Linux package built today can be useful for checking launch, UI gating, File source behavior,
FFmpeg packaging, logs, About window, Icecast settings, and experimental Audio Input behavior. It
must not be described as validated public Linux Audio Input support.

## Implemented Backend Shape

The initial Linux backend is PipeWire/PulseAudio-first because modern desktop distributions commonly
expose PipeWire through the PulseAudio compatibility server and `pactl`. ALSA remains a narrow
hardware-device fallback, not the primary desktop-audio strategy.

Current implementation:

- `src/main/audio-backends/linux-pipewire.js`
- `src/main/audio-backends/index.js` selects it when `process.platform === 'linux'`
- `pactl -f json list sources` or `pactl list sources` enumerates PipeWire/PulseAudio sources
- `arecord -l` enumerates ALSA hardware input devices when `pactl` is unavailable
- FFmpeg captures selected `pulse` or `alsa` input and emits raw Float32 little-endian PCM on stdout
- newline-delimited JSON `format` events are emitted on stderr for the existing main-process contract

For the current platform assessment, see:

- [Windows / Linux Portability Assessment](windows-linux-portability-assessment.md)

## Remaining Implementation Work

- Validate device enumeration and capture on PipeWire desktops.
- Confirm whether the packaged Linux FFmpeg binary includes the `pulse` and `alsa` input devices.
- Confirm channel count and sample-rate reporting for real multichannel input devices.
- Decide whether the JS/FFmpeg bridge is good enough for beta or whether a native PipeWire helper
  is needed for lower latency and stronger device metadata.
- Keep App Audio methods unsupported. They may exist only to satisfy the shared backend shape.
- Validate File source separately from Audio Input. File source working does not prove the Linux audio backend is ready.

## Backend PCM Contract

Linux Audio Input must match the existing FFmpeg manager contract. The current experimental backend
uses FFmpeg as the Linux capture adapter for `pulse` and `alsa`, but the shared application boundary
still receives only backend-owned Float32 PCM plus format metadata. A future native PipeWire helper
can replace that adapter without changing the shared stream graph.

Required stream contract:

- stdout: raw Float32 little-endian PCM.
- stderr: newline-delimited JSON events.
- first usable startup event:
  `{"event":"format","sampleRate":48000,"channels":2,"bitsPerChannel":32}`
- error event:
  `{"event":"error","message":"..."}`
- status/log event:
  `{"event":"status","message":"..."}`

The main process passes backend PCM to FFmpeg as:

```text
-f f32le -ar <sampleRate> -ac <channels> -i pipe:0
```

Linux Audio Input must not be treated as complete just because packaging succeeds. The current
implementation is a backend module that bridges Linux audio input into the existing PCM contract,
but it still needs real-device validation before release support is claimed.

## Suggested Linux Backend Order

Recommended implementation order:

1. Smoke-test File source streaming and File preview monitor on a Linux desktop.
2. Smoke-test `pactl` source enumeration under PipeWire.
3. Stream a selected PulseAudio/PipeWire source through FFmpeg and confirm Icecast receives audio.
4. Validate preview monitor for the same selected input.
5. Test the ALSA fallback only as a hardware-device compatibility path.
6. Add runtime dependency notes for AppImage, deb, and snap separately.
7. Promote Linux from `Preparing` only after Audio Input and File workflows pass real Linux smoke tests.

## Packaging Note

Electron Builder configuration may still be useful for local experiments, but packaging alone is not enough for a public Linux release. The blockers are Linux audio backend validation, runtime dependency documentation, and Linux FFmpeg packaging.

Release packaging no longer uses the `ffmpeg-static` npm package. Before running Linux packaging,
place a vetted Linux x64 FFmpeg binary at:

```text
resources/ffmpeg/linux-x64/ffmpeg
```

The repository includes a Linux x64 FFmpeg build workflow for this:

```text
.github/workflows/build-linux-ffmpeg.yml
scripts/build-linux-ffmpeg.sh
```

Run the workflow manually from GitHub Actions:

1. Open the repository on GitHub.
2. Go to `Actions`.
3. Select `Build Linux FFmpeg`.
4. Run the workflow from the current branch.
5. Download the `surroundstreamer-ffmpeg-linux-x64` artifact.
6. Place the downloaded `ffmpeg` binary at `resources/ffmpeg/linux-x64/ffmpeg`.

The build recipe uses FFmpeg 8.1 and keeps the feature set aligned with the current Windows custom
build: libopus/libmp3lame encoding, f32le/Ogg/MP3 muxing, WAV/FLAC/Ogg/MP3/MOV/Matroska/AIFF/CAF
demuxing, required audio filters, file/pipe/icecast protocols, and Linux `pulse`/`alsa` input
devices. It must not use `--enable-gpl` or `--enable-nonfree`.

On a Linux x64 machine with the required development packages installed, the same build can be run
locally:

```bash
npm run build:ffmpeg:linux
```

Then validate the Linux FFmpeg binary:

```bash
npm run check:ffmpeg-license:linux
```

The check rejects `--enable-nonfree` builds and rejects `--enable-gpl` unless
`SURROUNDSTREAMER_ALLOW_GPL_FFMPEG=1` is set for an intentional GPL distribution. The Linux binary
must provide libopus, libmp3lame, Ogg/MP3/f32le muxing, file/pipe/icecast protocols, and the audio
filters used by File source and monitor processing. It also checks that Linux `pulse` and `alsa`
input devices are present for the experimental Linux Audio Input backend.

The current Linux recipe links FFmpeg's internal libraries into the `ffmpeg` executable, but may
depend on host Linux shared libraries such as PulseAudio, ALSA, libopus, and libmp3lame. The workflow
uploads `ldd.txt` with the artifact so runtime dependencies can be reviewed before publishing a
Linux package.

After packaging, run a packaged-artifact license check against the unpacked app or output
directory:

```bash
npm run check:package-licenses -- dist
```

This fails if `ffmpeg-static` is present or if the packaged `ffmpeg` binary fails the FFmpeg
distribution check. The Linux package should include only `resources/ffmpeg/linux-x64/ffmpeg` plus
the shared FFmpeg notices/licenses. Update `resources/ffmpeg/THIRD_PARTY_NOTICES.md` and
`resources/ffmpeg/licenses/` for the exact Linux FFmpeg binary before publishing any Linux artifact.

The beta packaging target is reserved for development experiments. If a Linux beta package is generated from `beta/cross-platform-backend`, it should use the `0.1.1` release line with beta metadata, currently `0.1.1-beta.10`. Do not generate new Linux artifacts with the old `0.1.0` release number.

For beta experiments, use:

```bash
npm run build:beta:linux
```

This uses `electron-builder.beta.yml`, whose current beta metadata is `0.1.1-beta.10` and product
name is `SurroundStreamer-beta-0.1.1`.

After a Linux helper exists, add a Linux helper build script, for example:

```json
"build:audio-helper:linux": "..."
```

Then update `build:linux` and `build:beta:linux` so they build the Linux helper before Electron
Builder. Package the helper as a platform resource named `audio-backend`, matching the macOS and
Windows resource naming pattern:

```yaml
linux:
  extraResources:
    - from: native/audio-backends/linux/.build/surround-audio-backend
      to: audio-backend
```

Add `native/audio-backends/linux/.build/**` to `asarUnpack` only if the implementation relies on an
unpacked fallback path instead of `extraResources`.

Do not publish Linux artifacts from this path as supported downloads until a Linux backend exists and
has been validated.

## Linux Validation Checklist

Before any Linux beta artifact is advertised beyond development testing:

- App launches on a target Linux desktop.
- Backend log reports the expected Linux backend name, not `unsupported`.
- File source can select, preview, stream, and stop cleanly.
- Audio Input device list is populated by the Linux backend.
- Audio Input stream starts, emits a format event, reaches FFmpeg, reaches Icecast, and stops without orphaned processes.
- Channel count and sample rate from the backend match what FFmpeg receives.
- Audio Input monitor behavior is tested or explicitly disabled by capabilities.
- App Audio remains absent/unsupported.
- AppImage, deb, and snap runtime dependency and permission behavior is documented separately.
