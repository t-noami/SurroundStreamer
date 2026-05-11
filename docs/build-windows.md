# Build On Windows

This document describes the Windows beta build path. Windows is still beta-only, but the
`0.1.1-beta.10` line now has a local Windows package validated for ASIO Audio Input,
MMDevice/WASAPI Audio Input, monitor output routing, and Icecast Opus streaming. File source is
implemented in the Windows beta app but still needs final packaged-app smoke testing.

Do not treat `npm run build:win` as the supported Windows path. Use the beta config and build the
native helper first.

## Current Status

- Official Windows release: not available.
- Windows release numbering: use the `0.1.1` line for release-preparation artifacts; the current beta metadata is `0.1.1-beta.10`.
- Windows beta package: available locally from the beta branch after helper build and beta packaging.
- Windows beta branch backend: `windows-wasapi` when the native helper is built. The helper supports MMDevice/WASAPI and ASIO Audio Input capture; ASIO is the primary validation target for surround/multichannel input, while MMDevice/WASAPI is useful for generic mono/stereo inputs. DirectShow is retained as a fallback.
- App Audio capture: removed from the supported input-source UI. WASAPI Process Loopback source remains research/reference code only.
- Audio Input capture: native ASIO and MMDevice/WASAPI paths are available. For 5.1 or higher channel counts, validate ASIO first. The older FFmpeg DirectShow path remains as fallback when the native helper is missing.
- Surround Audio Input requirement: for 5.1 or larger Windows streaming, use an ASIO-capable audio interface or ASIO virtual audio device with 6 or more input/output channels. Do not rely on WASAPI/MMDevice endpoints for surround capture unless that specific device exposes a verified multichannel input format.
- Audio Input Monitor Output: Windows ASIO input can use the backend-owned FFmpeg/WASAPI monitor renderer with backend WASAPI output-device selection. Generic device/file paths still use the shared WebAudio monitor where appropriate.
- Output loopback capture: the earlier DirectShow loopback/virtual-device bridge is kept as a development reference.
- File source support: available in the Windows beta app.
- Local beta packaging: `npx electron-builder --win --config electron-builder.beta.yml --config.directories.output=dist/beta-stream-live-fix` produced `dist/beta-stream-live-fix/SurroundStreamer-beta-0.1.1-setup.exe` on Windows.
- Local app launch smoke test: `dist/beta-stream-live-fix/win-unpacked/SurroundStreamer-beta-0.1.1.exe` starts on Windows when `ELECTRON_RUN_AS_NODE` is not set.
- Local stream smoke test: FFmpeg Opus streaming to Icecast succeeded after clearing inherited proxy variables from FFmpeg child processes and converting the Opus output layout from `5.1(side)` to `5.1`.

## Required Work

Windows support now has a native helper entry point plus the experimental DirectShow audio-input bridge.

Build the native Windows helper before building a Windows beta that should expose native Audio Input capture:

```powershell
npm run build:audio-helper:win
npm run build:beta:win
```

The helper build produces:

```text
native/audio-backends/windows/.build/SurroundAudioBackend.exe
```

For the current platform assessment, see:

- [Windows / Linux Portability Assessment](windows-linux-portability-assessment.md)
- [Windows Backend Development Guide](windows-backend-development.md)

## Packaging Note

`npm run build:beta:win` builds the native helper first through `build:audio-helper:win`, then
builds the app and packages with `electron-builder.beta.yml`.

## Packaged App UI Behavior

The Windows packaged Electron app uses the native application menu as the main secondary-action
surface. Do not duplicate menu actions as header buttons unless there is a clear workflow reason.

Current Windows/Linux menu actions:

- `Window > Show Logs` opens the runtime log window.
- `Help > GitHub Repository` opens `https://github.com/t-noami/SurroundStreamer` in the default browser.
- `Help > About SurroundStreamer` opens the About window.

The main renderer header should only show the product mark and status badge. The earlier in-header
`Logs`, `Help`, and `About` buttons were removed after the Windows menu became visible.

Stream-start UX:

- Pressing `START STREAM` shows a semi-transparent blocking overlay while monitor startup and stream connection are in progress.
- The loading overlay is cleared on success, connection failure, monitor startup failure, or thrown exceptions.
- The start button is disabled while the start operation is pending to avoid duplicate starts.
- If required settings are blank, the start operation does not show the loading overlay. Instead, the invalid fields are highlighted.
- Highlighted validation fields include input source, stream channel selection, Opus host/port/password, and MP3 host/port/password.
- When the user edits or reselects a highlighted field, the highlight is cleared.
- If the stream backend returns a connection failure, the app shows a separate `Connection failed` overlay with the error message and an `OK` button.

Packaged test artifacts are intentionally generated into fresh `dist/current-win-*` directories during
manual validation when `dist/win-unpacked` is locked by a running app instance.

The blocker for a public stable Windows release is no longer "missing backend code." The current
remaining release blockers are signing/SmartScreen, broader ASIO device compatibility, channel-order
documentation, long-run capture stability, and installer/update policy. WASAPI/MMDevice and
DirectShow fallback remain secondary validation paths for non-surround input.

The beta config currently disables Windows executable signing/resource editing with `win.signAndEditExecutable: false` so local unsigned development packaging does not require the `winCodeSign` symlink extraction path. Re-enable and retest signing/resource metadata before publishing any Windows build.

The beta packaging target is reserved for development experiments. If a Windows beta executable is generated from `beta/cross-platform-backend`, it should use the `0.1.1` release line with beta metadata, currently `0.1.1-beta.10`. Do not generate new Windows artifacts with the old `0.1.0` release number.

Before changing shared backend files for Windows work, read [Windows Backend Development Guide](windows-backend-development.md). The current macOS beta backend must continue to build after Windows changes.

## Latest Local Beta Artifact

```text
dist/beta-stream-live-fix/SurroundStreamer-beta-0.1.1-setup.exe
dist/beta-stream-live-fix/win-unpacked/SurroundStreamer-beta-0.1.1.exe
```

The unpacked app writes persistent runtime logs to:

```text
%APPDATA%/surround-streamer/surround-streamer.log
```
