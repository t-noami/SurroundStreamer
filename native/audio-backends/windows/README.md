# SurroundStreamer Windows Audio Backend

This helper is the native Windows backend for Audio Input capture through MMDevice/WASAPI
endpoints and ASIO input devices.

Current app scope:

- Supported app sources are Audio Input and File.
- ASIO is the primary validation path for surround/multichannel Audio Input on Windows.
- MMDevice/WASAPI is supported for generic mono/stereo Audio Input and may support more channels
  only when a specific driver exposes them that way.
- App Audio has been removed from the beta line.
- WASAPI Process Loopback is retained as research/reference code only.
- DirectShow fallback lives in the Electron/FFmpeg backend, not in this helper executable.

Supported Windows baseline:

- Windows 10 Build 20348 or later

Build 20348 remains the baseline because the binary still includes process-loopback research code
that depends on `AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK`.

## Build

Install Visual Studio 2022 with the C++ desktop workload, then run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-windows-audio-helper.ps1
```

Expected output:

```text
native/audio-backends/windows/.build/SurroundAudioBackend.exe
```

## Supported Runtime Contract

Input device listing:

```powershell
SurroundAudioBackend.exe --list-input-devices
```

ASIO device listing:

```powershell
SurroundAudioBackend.exe --list-asio-devices
SurroundAudioBackend.exe --probe-asio-device --clsid "{...}"
```

Input device capture:

```powershell
SurroundAudioBackend.exe --stream-input-device --device-id "{0.0.1.00000000}.{...}"
```

ASIO input capture:

```powershell
SurroundAudioBackend.exe --stream-asio-input --clsid "{...}" --channels 6
```

stdout:

```text
raw 32-bit float little-endian PCM
```

stderr:

```json
{ "event": "format", "sampleRate": 48000, "channels": 2, "layout": "stereo", "bitsPerChannel": 32 }
```

## Fallback Path

When `src/main/audio-backends/windows-wasapi.js` cannot find this native helper, it falls back to
`src/main/audio-backends/windows-dshow.js` for FFmpeg DirectShow Audio Input listing and capture.
That fallback is useful for development but should not be treated as the preferred release path.

## Research-Only Commands

Output device listing:

```powershell
SurroundAudioBackend.exe --list-output-devices
```

Process loopback capture:

```powershell
SurroundAudioBackend.exe --stream-process-loopback --pid 1234 --sample-rate 48000 --channels 2
```

Do not describe this path as supported App Audio or Preserve Surround. Multichannel preservation in
the current beta is through selected Audio Input devices, especially ASIO devices when the driver
exposes multichannel input.
