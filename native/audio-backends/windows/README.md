# SurroundStreamer Windows Audio Backend

This helper is the native Windows backend for WASAPI process loopback capture and
MMDevice/WASAPI input-device capture.

Supported Windows baseline:

- Windows 10 Build 20348 or later

Older Windows builds are intentionally unsupported because the backend depends on
`AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK`.

## Build

Install Visual Studio 2022 with the C++ desktop workload, then run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-windows-audio-helper.ps1
```

Expected output:

```text
native/audio-backends/windows/.build/SurroundAudioBackend.exe
```

## Runtime Contract

Process loopback capture:

```powershell
SurroundAudioBackend.exe --stream-process-loopback --pid 1234 --sample-rate 48000 --channels 2
```

Input device listing:

```powershell
SurroundAudioBackend.exe --list-input-devices
```

Output device listing:

```powershell
SurroundAudioBackend.exe --list-output-devices
```

Input device capture:

```powershell
SurroundAudioBackend.exe --stream-input-device --device-id "{0.0.1.00000000}.{...}"
```

stdout:

```text
raw 32-bit float little-endian PCM
```

stderr:

```json
{ "event": "format", "sampleRate": 48000, "channels": 2, "layout": "stereo", "bitsPerChannel": 32 }
```
