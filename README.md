<p align="center">
  <img src="resources/SurroundStreamer_logo_horizon.png" alt="SurroundStreamer" width="560">
</p>

# SurroundStreamer

SurroundStreamer is a macOS Electron app for sending Ogg Opus audio streams to an Icecast server.
It supports App Audio capture, input-device capture, file playback, stream channel templates up to 7.1, and monitor output for previewing supported sources.
The current practical target is macOS because the audio capture path depends on Core Audio.

<h2 align="center">DOWNLOAD</h2>

<p align="center">
  <a href="https://github.com/t-noami/SurroundStreamer/releases/download/v0.1.0/SurroundStreamer-0.1.0.dmg">
    <strong>Download SurroundStreamer 0.1.0 for macOS</strong>
  </a>
</p>

| Platform | Download |
| --- | --- |
| macOS Apple Silicon | [SurroundStreamer-0.1.0.dmg](https://github.com/t-noami/SurroundStreamer/releases/download/v0.1.0/SurroundStreamer-0.1.0.dmg) |
| Windows | Preparing |
| Linux | Preparing |

## System Requirements

> [!IMPORTANT]
> SurroundStreamer 0.1.0 requires **macOS 14.2 or later** for App Audio capture and App Audio Monitor Output.
> macOS 12.x and 13.x do not provide the Core Audio Process Tap API used by this app, so App Audio capture will not work on those systems.

- Supported release target: macOS 14.2 or later on Apple Silicon
- App Audio capture: requires macOS 14.2 or later
- App Audio Monitor Output: requires macOS 14.2 or later because it uses the same capture backend
- Windows/Linux: Preparing

## Developer

- Studio: Non-REM Studio
- Contact: info@non-rem.com
- GitHub: [t-noami](https://github.com/t-noami)
- Repository: https://github.com/t-noami/SurroundStreamer

## Current Scope

- Primary streaming format: Ogg Opus over Icecast
- Standard channel templates: Mono, Stereo, Stereo + C, 5.1, 7.1
- Default encoding: 48 kHz, 128 kbps stereo-equivalent bitrate
- Main source order: App Audio, Input Device, File
- App Audio capture: Core Audio process tap with preserve-surround output stream selection
- Input Device capture: Core Audio helper PCM capture piped into FFmpeg
- File source: file playback and preview monitor support
- Monitor Output: Stereo Pair, Stereo Downmix, KU100 Near-field HRTF

## Important Notes

- App Audio capture depends on Apple's Core Audio Process Tap API. If the app is launched on macOS older than 14.2, App Audio and App Audio monitor preview are not expected to work.
- Input Device source currently disables Monitor Output controls. This keeps the streaming path stable while input-device monitoring remains separate from the production path.
- Opus output is constrained to supported sample rates. 44.1 kHz and 96 kHz sources are converted to 48 kHz for stream output.
- 7.1.2 and 7.1.4 are not part of the standard build. The current production target is up to 7.1 because that maps cleanly to common Opus channel mapping support.
- KU100 near-field HRIR data is included under CC BY 4.0. Attribution is listed below.
- Windows and Linux build notes are kept for future platform work, but the current capture implementation is macOS-specific.
- Windows beta development has started with a conservative file-only backend entry point; Windows downloads remain `Preparing` until a real beta is validated.

## User Manual

SurroundStreamer sends audio from macOS app audio, input devices, or audio files to Icecast as Ogg Opus streams.

### Basic Screen

![Main screen](docs/manual-assets/overview.png)

The main screen is organized into these areas:

- `Input Source`: Selects the streaming source.
- `Monitor Output`: Configures monitor playback before or during streaming.
- `Encoding Settings`: Configures bitrate, sample rate, and channel templates.
- `Icecast Settings`: Configures the Icecast connection.
- `START STREAM` / `STOP STREAM`: Starts or stops the stream.
- `Window > Show Logs`: Opens connection status and error messages in a separate window.

### First-Run Settings

The first-run Icecast defaults are:

- Host: empty
- Port: `8000`
- Mount Point: `/stream`
- Password: empty

Icecast settings are saved after editing and restored on the next launch. If settings are already saved, the saved values are used instead of the first-run defaults.

### Input Sources

#### App Audio

Use App Audio when streaming audio from another application.

1. Select `App Audio` in `Input Source`.
2. Select the target application in `App`.
3. Select the output device or stream used by that app in `App Output Capture Source`.
4. Use `Refresh` if the app or output capture source list needs to be updated.

For multichannel sources such as 5.1 audio, select the output stream where the target app is actually sending multichannel audio.

#### File

Use File when streaming audio from a selected audio file.

![File source](docs/manual-assets/file-source.png)

1. Select `File` in `Input Source`.
2. Select an audio file with `Browse`.
3. Enable `Loop` if repeated playback is needed.
4. Select a `Stream Channel Template` that matches the file channel layout.

For File source, Monitor Output is useful only after a playable file has been selected.

#### Input Device

Use Input Device when streaming from an audio interface, virtual input, or microphone input.

![Input device source](docs/manual-assets/device-source.png)

1. Select `Input Device` in `Input Source`.
2. Select the input device in `Input Device`.
3. Use `Refresh` if the device list needs to be updated.

Monitor Output is currently disabled for Input Device source. Input-device monitoring still needs to be stabilized separately from the streaming path.

On macOS, input-device streaming requires microphone permission. If streaming does not capture input audio, confirm that macOS Privacy settings allow microphone access for SurroundStreamer.

### Encoding Settings

`Encoding Settings` controls the stream format.

- `Bitrate (Stereo Equivalent)`: Bitrate expressed as a stereo-equivalent value. The actual bitrate increases with the selected channel count.
- `Sample Rate`: Opus stream sample rate. The default is 48 kHz.
- `Stream Channel Template`: Selects the stream channel layout.
- `Stream Channels`: Selects the channels included in the stream.

Standard templates are `Mono`, `Stereo`, `Stereo + C`, `5.1`, and `7.1`. For multichannel sources, `5.1` is the default practical starting point.

### Monitor Output

Monitor Output is used to check audio before or during streaming.

- `Enable monitor output`: Enables monitor playback.
- `Output Device`: Selects the monitor output device.
- `Monitor Mode`: Selects the monitor processing mode.
- `Monitor Buffer`: Selects the monitor output buffer.
- `Monitor Source`: Selects the channel pair used in Stereo Pair mode.
- `Monitor Volume`: Controls only the monitor output level.

Monitor modes:

- `Stereo Pair`: Monitors the selected two-channel pair directly.
- `Stereo Downmix`: Downmixes multichannel audio to stereo.
- `KU100 Near-field HRTF`: Renders a binaural monitor signal using KU100 near-field HRIR data.

Monitor Volume is applied after the selected monitor mode processing. It does not affect the streamed audio.

### Icecast Settings

`Icecast Settings` configures the streaming destination.

- `Host`: Icecast server host name or IP address
- `Port`: Icecast port
- `Mount Point`: Stream mount point, for example `/stream`
- `Password`: Source password

Mount Point should start with `/`, such as `/stream`. If the leading `/` is missing, the app normalizes it when saving.

### Starting And Stopping

![Live locked state](docs/manual-assets/live-lock.png)

Click `START STREAM` to start streaming.

While streaming, the following controls are locked to prevent accidental changes:

- `Input Source`
- `Encoding Settings`
- `Icecast Settings`

Click `STOP STREAM` to stop streaming. Closing the window with the macOS close button also quits the app and stops any streaming processes running in the background.

### Stream Playback Check

Use the following web player to confirm that audio is reaching the streaming destination:

https://non-rem.com/SurroundWebPlayer/

Enter the Icecast Streaming URL and start playback. If the player remains buffering, check `Logs` in SurroundStreamer and confirm the mount state on the Icecast server. This web player is an external verification page and is not bundled with the app.

### Troubleshooting

If Icecast connection fails:

- Confirm Host, Port, Mount Point, and Password.
- If `403 Forbidden` appears, check the password, source user, mount point, and Icecast server permissions.
- Passwords containing `@` are URL-encoded by the app.

If the player remains buffering:

- Confirm that the Icecast server created the expected mount point.
- Check `Logs` to see whether FFmpeg exits immediately after startup.
- For Input Device source, confirm that macOS microphone permission is enabled.

If Input Device source has no audio:

- Confirm that the selected input device is receiving signal.
- If using a loopback or virtual device, confirm that the routing is not unintentionally mixing system output into the input.
- Confirm macOS microphone permission.

If Monitor Output is unavailable:

- Monitor Output is disabled for Input Device source.
- Use App Audio or File source for monitor output.
- If the output device list changes, use `Refresh Monitor Devices`.

## Development

Build instructions are split by operating system:

- [Build on macOS](docs/build-macos.md)
- [Build on Windows](docs/build-windows.md)
- [Build on Linux](docs/build-linux.md)
- [Windows Backend Development Guide](docs/windows-backend-development.md)
- [Windows / Linux Portability Assessment](docs/windows-linux-portability-assessment.md)

macOS is the primary supported build target. Windows and Linux packaging notes are included for future platform work, but the current audio capture path depends on macOS Core Audio.

## Test Stream Config

`test_streamconfig.txt` is a local convenience note for stream testing. Treat it as sensitive operational data and do not publish it.

## License

SurroundStreamer is released under the MIT License. See [LICENSE](LICENSE).

The MIT License is a permissive open-source license that allows commercial use, private use, modification, distribution, and sublicensing, while requiring preservation of copyright and license notices.

Third-party materials remain under their own licenses. In particular, the bundled KU100 near-field HRIR extraction is CC BY 4.0 and requires attribution.

## Repository Documents

- `docs/implementation_plan.md`: project history, architecture notes, current plan, and future work
- `docs/releases/`: release notes used for GitHub Releases
- `docs/task.md`: current task status and release checklist

## Third-Party Notices

### Neumann KU100 Near-Field HRIR

This application includes a reduced JavaScript extraction from:

Spherical Near-Field (NF) HRIR Compilation of the Neumann KU100

Authors:

- Johannes M. Arend
- Annika Neidhardt
- Christoph Poerschmann

Source:
https://zenodo.org/records/4297951

DOI:
10.5281/zenodo.4297951

License:
Creative Commons Attribution 4.0 International (CC BY 4.0)

The bundled extraction uses the 1.0 m circular 360-degree SOFA set
(`HRIR_CIRC360_NF100.sofa`) and contains only the HRIR directions needed for
the current monitor-output speaker labels.

## Verification Checklist

Before treating a build as usable:

- App launches successfully
- App Audio stream starts and stops cleanly
- Icecast connection succeeds with the intended mount point
- Peak meters respond quickly
- Monitor Output works for App Audio and File sources
- Quitting the app stops FFmpeg and helper processes
- `codesign --verify --deep --strict` passes for the app bundle
