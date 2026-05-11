# Build On Windows

This document describes the current Windows release-preparation build path. Windows remains
pre-release because signing, SmartScreen reputation, broader device compatibility, and long-run
validation are still open, but the main config can now produce a local unsigned Windows installer.
The Windows helper is built first and packaged as a resource next to the Electron app.

## Current Status

- Official Windows release: not available.
- Windows release numbering: use the `0.1.1` line for release-preparation artifacts.
- Windows local package: available from `npm run build:win` on Windows after Visual Studio C++ build tools are installed.
- Windows beta branch backend: `windows-wasapi` when the native helper is built. The helper supports MMDevice/WASAPI and ASIO Audio Input capture; ASIO is the primary validation target for surround/multichannel input, while MMDevice/WASAPI is useful for generic mono/stereo inputs. DirectShow is retained as a fallback.
- App Audio capture: removed from the supported input-source UI. WASAPI Process Loopback source remains research/reference code only.
- Audio Input capture: native ASIO and MMDevice/WASAPI paths are available. For 5.1 or higher channel counts, validate ASIO first. The older FFmpeg DirectShow path remains as fallback when the native helper is missing.
- Surround Audio Input requirement: for 5.1 or larger Windows streaming, use an ASIO-capable audio interface or ASIO virtual audio device with 6 or more input/output channels. Do not rely on WASAPI/MMDevice endpoints for surround capture unless that specific device exposes a verified multichannel input format.
- Monitor Output: Windows ASIO Audio Input and Windows File-source monitoring use the backend-owned FFmpeg/WASAPI monitor renderer with backend WASAPI output-device selection. Other generic paths still use the shared WebAudio monitor where appropriate.
- Output loopback capture: the earlier DirectShow loopback/virtual-device bridge is kept as a development reference.
- File source support: available in the Windows app. Packaged Windows File monitor output should be tested through the WASAPI backend monitor path.
- Local packaging: `npm run build:win` produces `dist/surround-streamer-0.1.1-setup.exe` and `dist/win-unpacked/SurroundStreamer.exe`.
- Local app launch smoke test: `dist/win-unpacked/SurroundStreamer.exe` starts on Windows when `ELECTRON_RUN_AS_NODE` is not set.
- Local stream smoke test: FFmpeg Opus streaming to Icecast succeeded after clearing inherited proxy variables from FFmpeg child processes and converting the Opus output layout from `5.1(side)` to `5.1`.

## Required Work

Windows support now has a native helper entry point plus the experimental DirectShow audio-input bridge.

Build the native Windows helper before building a Windows package that should expose native Audio
Input capture:

```powershell
npm run build:audio-helper:win
npm run build:win
```

The helper build produces:

```text
native/audio-backends/windows/.build/SurroundAudioBackend.exe
```

For the current platform assessment, see:

- [Windows / Linux Portability Assessment](windows-linux-portability-assessment.md)
- [Windows Backend Development Guide](windows-backend-development.md)

## Packaging Note

`npm run build:win` builds the native helper first through `build:audio-helper:win`, then builds the
app and packages with `electron-builder.yml`.

The main Windows package currently uses:

- `win.extraResources` to copy `native/audio-backends/windows/.build/SurroundAudioBackend.exe` to
  `resources/audio-backend.exe`.
- `files` exclusions for `scripts/**`, `docs/**`, `native/**`, `icecast/**`, `dist/**`, and
  `electron-builder*.yml` so development files and native build intermediates are not bundled into
  `app.asar`.
- `asarUnpack: resources/**` for runtime assets such as FFmpeg-adjacent resources and KU100 HRIR
  files.
- `win.signAndEditExecutable: false` to keep local builds unsigned and avoid the `winCodeSign`
  symlink extraction path.
- `afterPack: scripts/after-pack-win-icon.cjs` to embed `build/icon.ico` into the packaged Windows
  executable with `rcedit` while keeping the artifact unsigned.
- NSIS `oneClick: false` and `allowToChangeInstallationDirectory: true` so the installer presents a
  normal wizard and shows the target install directory.
- NSIS desktop/start-menu shortcuts enabled. The shortcut icon is taken from the installed
  `SurroundStreamer.exe`.

The packaged helper must not contain local developer paths. The helper Release build disables debug
information/PDB generation for that reason.

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

Packaged test artifacts may be generated into fresh `dist/current-win-*` directories during manual
validation when `dist/win-unpacked` is locked by a running app instance, but the default local
release-preparation artifact is `dist/surround-streamer-0.1.1-setup.exe`.

The blocker for a public stable Windows release is no longer "missing backend code." The current
remaining release blockers are signing/SmartScreen, broader ASIO device compatibility, channel-order
documentation, long-run capture stability, and installer/update policy. WASAPI/MMDevice and
DirectShow fallback remain secondary validation paths for non-surround input.

The main config currently disables Windows executable signing/resource editing with
`win.signAndEditExecutable: false` so local unsigned packaging does not require the `winCodeSign`
symlink extraction path. Do not re-enable it until signing is ready and the winCodeSign cache can be
expanded reliably on the build machine. Icon embedding is handled separately by
`scripts/after-pack-win-icon.cjs`.

The beta packaging target is reserved for development experiments. If a Windows beta executable is generated from `beta/cross-platform-backend`, it should use the `0.1.1` release line with beta metadata, currently `0.1.1-beta.10`. Do not generate new Windows artifacts with the old `0.1.0` release number.

Before changing shared backend files for Windows work, read [Windows Backend Development Guide](windows-backend-development.md). The current macOS beta backend must continue to build after Windows changes.

## Latest Local Artifact

```text
dist/surround-streamer-0.1.1-setup.exe
dist/win-unpacked/SurroundStreamer.exe
```

The unpacked app writes persistent runtime logs to:

```text
%APPDATA%/surround-streamer/surround-streamer.log
```
