# Stream Silence EOF Investigation

Date: 2026-06-01

## Symptom

AYAstorm 3D Stream URL Source reported EOF/dropout after the stream source was set to
silence/volume 0.

Important receiver-side event:

- `2026-05-31T17:06:46Z`
- `Multi source returned 0 bytes`
- `rr=End of file unexpectedly reached while trying to read essential data`
- `buffered=2504 frames (0.0521667s)`
- `codec=Opus`

The seconds immediately before EOF were not a normal silent-PCM steady state. AYAstorm
was receiving roughly 45k-49k frames per second until `17:06:41Z`, then the next pump
window covered `5.20122s` but read only `27080` frames and the ring buffer drained to
`0.052s`.

## Confirmed Locally

SurroundStreamer's Opus encoder arguments are:

- `-c:a libopus`
- `-vbr constrained` at the time of the original failure
- `-application audio`
- `-mapping_family 1` for 5.1/7.1 layouts
- `-frame_duration 20`

The bundled FFmpeg `libopus` encoder exposes no `-dtx` option, and the app does not add
DTX, VAD, or silence-suppression options.

Local tests with the bundled FFmpeg:

- 60 seconds of 5.1 all-zero PCM produced a valid Ogg/Opus file.
- 60 seconds of 5.1 `volume=0` also produced a valid Ogg/Opus file.
- Both files contained 63 Ogg pages, 3003 Opus packets, monotonic granule positions, and
  decoded successfully with 0 decode errors.

Therefore silence by itself does not make FFmpeg/libopus stop packet output.

## Live URL Spot Check

A short `http://go-stream-live.com:8030/stream` capture on 2026-06-01 succeeded:

- 678018 bytes captured in 15 seconds before the client-side timeout.
- 17 complete Ogg pages parsed.
- 752 Opus packets parsed.
- Granule position increased monotonically.
- FFmpeg decoded it as 5.1 Opus.

This only proves the live stream was valid at the capture time; it does not prove the
stream was valid during the original `2026-05-31T17:06:46Z` failure.

## Most Likely Boundary

The failure is most consistent with the stream source no longer feeding continuous Ogg
pages to HTTP clients. On the SurroundStreamer side, that can happen if the CoreAudio
input-device helper stops producing PCM or exits; `ffmpeg-manager.js` ends FFmpeg stdin
when the input-device helper closes, which causes FFmpeg to finalize/close the Ogg stream.

The existing sender log on this machine ends at 2026-05-29, so there is no matching
SurroundStreamer stderr/source log for the 2026-05-31 receiver failure.

## Temporary Diagnostic Logging

Temporary input PCM diagnostics were used during the live investigation to distinguish valid silent
PCM from stopped PCM input. Those per-second diagnostics were removed after the investigation so
release builds do not emit noisy monitor/source logs.

## Live Follow-Up

During a live zero-volume test, SurroundStreamer kept feeding normal silent PCM into
FFmpeg:

- about 48000 fps every second
- `peak=0.0000000`
- `silent=yes`
- `nonFinite=0`

At the same time AYAstorm repeatedly opened the stream, identified it as 6ch Opus, and
then failed with socket/open failures after roughly 10 seconds.

A direct curl capture of the same zero-volume stream succeeded and parsed as valid Ogg:

- 77055 bytes received in 15 seconds
- 95 complete Ogg pages
- 4652 Opus packets
- monotonic granule positions
- FFmpeg decoded it as 5.1 Opus

The zero-volume stream was therefore not zero-byte or header-only, but the effective
bitrate dropped to only a few kbps. To avoid FMOD/Icecast/client behavior around extremely
low-bitrate Opus silence, SurroundStreamer now defaults to Opus CBR for the main Ogg stream:

- `-vbr off`

The Encoding Settings panel also exposes Opus Bitrate Mode:

- `CBR` maps to FFmpeg/libopus `-vbr off` and is the default for stream stability.
- `CVBR` maps to FFmpeg/libopus `-vbr constrained` for bandwidth savings, with the known risk that
  very low-bitrate silence can still expose receiver-side stream handling problems.
- `VBR` maps to FFmpeg/libopus `-vbr on` for unconstrained variable bitrate.

Do not document CVBR as equivalent to MP3/AAC CBR for this app's live streaming behavior. In the
observed Icecast + Ogg/Opus + FMOD receiver path, CVBR still allowed silent audio to fall to a very
low byte rate. The default remains hard CBR because it is the only tested Opus mode that kept silent
streams near the configured bitrate and avoided the low-byte-rate receiver failure mode.
