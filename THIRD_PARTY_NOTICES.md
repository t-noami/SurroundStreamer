# Third-Party Notices

This file summarizes third-party materials distributed with SurroundStreamer.

## Application Runtime Dependencies

The packaged Electron application includes JavaScript runtime dependencies from npm. The current
runtime dependencies are:

- `@electron-toolkit/preload` - MIT
- `@electron-toolkit/utils` - MIT
- `fluent-ffmpeg` - MIT
- `async` - MIT
- `which` - ISC
- `isexe` - ISC

Electron, Chromium, Node.js, and related components are included as part of the Electron runtime.
Their license notices are provided by the Electron distribution used by Electron Builder.

## FFmpeg, libopus, and LAME

Packaged builds use a platform-specific FFmpeg binary from `resources/ffmpeg/`.

See:

- `resources/ffmpeg/THIRD_PARTY_NOTICES.md`
- `resources/ffmpeg/licenses/`

Current packaged FFmpeg binaries include:

- macOS Apple Silicon: FFmpeg 8.0 LGPL-compatible build with libopus and libmp3lame enabled.
- Windows x64: FFmpeg 8.1 LGPL-compatible custom build with libopus and libmp3lame enabled.

`--enable-nonfree` builds must not be distributed with SurroundStreamer.

## Neumann KU100 Near-Field HRIR

The KU100 near-field HRIR assets are derived from:

Spherical Near-Field (NF) HRIR Compilation of the Neumann KU100

Authors:

- Johannes M. Arend
- Annika Neidhardt
- Christoph Pörschmann

License:

Creative Commons Attribution 4.0 International

Source:

https://zenodo.org/records/4297951

DOI:

10.5281/zenodo.4297951

See `resources/ku100-hrir/NOTICE.md` for the resource-level notice and change statement.

## SurroundStreamer Brand Assets

SurroundStreamer logos, icons, and banner images in `resources/` and
`src/renderer/public/brand/` are Copyright (c) 2026 Non-REM Studio unless otherwise stated. They are
distributed as part of the SurroundStreamer application and documentation.

These brand assets are not licensed under the MIT License. See `TRADEMARKS.md` for project name,
logo, and brand asset guidelines.
