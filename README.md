# SurroundStreamer

SurroundStreamer is a macOS Electron app for sending Ogg Opus audio streams to an Icecast server.
It supports App Audio capture, input-device capture, file playback, stream channel templates up to 7.1, and monitor output for previewing supported sources.

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

- Input Device source currently disables Monitor Output controls. This keeps the streaming path stable while input-device monitoring remains separate from the production path.
- Opus output is constrained to supported sample rates. 44.1 kHz and 96 kHz sources are converted to 48 kHz for stream output.
- 7.1.2 and 7.1.4 are not part of the standard build. The current production target is up to 7.1 because that maps cleanly to common Opus channel mapping support.
- KU100 near-field HRIR data is included under CC BY 4.0. Attribution is listed below.

## User Manual

SurroundStreamerは、macOS上のアプリ音声、入力デバイス、または音声ファイルをIcecastへOgg Opusで配信するためのアプリです。

### Basic Screen

![Main screen](docs/manual-assets/overview.png)

画面は主に以下の領域で構成されています。

- `Input Source`: 配信元を選択します。
- `Monitor Output`: 配信前または配信中のモニター出力を設定します。
- `Encoding Settings`: ビットレート、サンプルレート、チャンネルテンプレートを設定します。
- `Icecast Settings`: Icecast接続先を設定します。
- `START STREAM` / `STOP STREAM`: 配信を開始・停止します。
- `Logs`: 接続状況やエラーを確認します。

### First-Run Settings

初回起動時のIcecast設定は以下です。

- Host: 空欄
- Port: `8000`
- Mount Point: `/stream`
- Password: 空欄

Icecast設定は編集すると保存され、次回起動時に復元されます。すでに保存済みの環境では、初期値ではなく保存値が優先されます。

### Input Sources

#### App Audio

他のアプリケーションから出ている音声を配信する場合に使います。

1. `Input Source` で `App Audio` を選択します。
2. `App` で対象アプリを選びます。
3. `App Output Capture Source` で、対象アプリが出力しているデバイス/ストリームを選びます。
4. 必要に応じて `Refresh` で一覧を更新します。

5.1などの多チャンネル音声を扱う場合は、対象アプリが多チャンネル出力している出力ストリームを選んでください。

#### File

音声ファイルを再生しながら配信する場合に使います。

![File source](docs/manual-assets/file-source.png)

1. `Input Source` で `File` を選択します。
2. `Browse` で音声ファイルを選びます。
3. 繰り返し再生したい場合は `Loop` を有効にします。
4. ファイルのチャンネル数に応じて `Stream Channel Template` を選びます。

Fileソースでは、ファイルを選択して再生できる状態にしないとMonitor Outputの意味がありません。

#### Input Device

オーディオインターフェイス、仮想入力、マイク入力などを配信する場合に使います。

![Input device source](docs/manual-assets/device-source.png)

1. `Input Source` で `Input Device` を選択します。
2. `Input Device` で使用する入力デバイスを選びます。
3. 必要に応じて `Refresh` でデバイス一覧を更新します。

Input Deviceソースでは、現状Monitor Outputは無効化されます。入力デバイスのモニター処理は配信経路と切り離して安定化する必要があるためです。

macOSで入力デバイスを使う場合は、アプリにマイク権限が必要です。配信できない場合は、macOSのプライバシー設定でSurroundStreamer betaにマイク権限があるか確認してください。

### Encoding Settings

`Encoding Settings` では、配信フォーマットを設定します。

- `Bitrate (Stereo Equivalent)`: ステレオ換算のビットレートです。実際のビットレートは選択チャンネル数に応じて増えます。
- `Sample Rate`: Opus配信用のサンプルレートです。標準は48 kHzです。
- `Stream Channel Template`: 配信チャンネル構成を選択します。
- `Stream Channels`: 実際に配信へ載せるチャンネルを選択します。

標準テンプレートは `Mono`, `Stereo`, `Stereo + C`, `5.1`, `7.1` です。多チャンネルソースでは、まず `5.1` を標準として使う想定です。

### Monitor Output

Monitor Outputは、配信前または配信中に音を確認するための機能です。

- `Enable monitor output`: モニター出力を有効化します。
- `Output Device`: モニター先の出力デバイスを選びます。
- `Monitor Mode`: モニター方式を選びます。
- `Monitor Buffer`: モニター出力のバッファを選びます。
- `Monitor Source`: Stereo Pair時にモニターするチャンネルペアを選びます。
- `Monitor Volume`: モニター出力だけにかかる音量です。

Monitor Modeは以下です。

- `Stereo Pair`: 指定した2chをそのままモニターします。
- `Stereo Downmix`: 多チャンネルをステレオへダウンミックスします。
- `KU100 Near-field HRTF`: KU100近距離HRTFでバイノーラル化します。

Monitor Volumeはモニターモードごとの処理の後にかかります。配信音声そのものには影響しません。

### Icecast Settings

`Icecast Settings` には接続先を入力します。

- `Host`: Icecastサーバーのホスト名またはIPアドレス
- `Port`: Icecastポート
- `Mount Point`: 配信マウント。例: `/stream`
- `Password`: source接続用パスワード

Mount Pointは `/stream` のように先頭に `/` を付けてください。入力時に `/` が無い場合は、保存時に補正されます。

### Starting And Stopping

![Live locked state](docs/manual-assets/live-lock.png)

配信を始めるには `START STREAM` を押します。

配信中は誤操作を避けるため、以下は編集できません。

- `Input Source`
- `Encoding Settings`
- `Icecast Settings`

配信を止めるには `STOP STREAM` を押します。アプリ左上の閉じるボタンでウィンドウを閉じた場合も、アプリ終了として扱い、裏で動いている配信プロセスを停止します。

### Troubleshooting

Icecastに接続できない場合:

- Host、Port、Mount Point、Passwordを確認してください。
- `403 Forbidden` が出る場合は、パスワード、接続ユーザー、マウント、またはIcecast側の権限設定を確認してください。
- Passwordに `@` が含まれていても、アプリ側でURLエンコードします。

プレーヤー側がバッファ中のままになる場合:

- Icecastサーバー側で該当マウントが作成されているか確認してください。
- LogsでFFmpegが起動直後に終了していないか確認してください。
- 入力デバイスを使う場合は、macOSのマイク権限が有効か確認してください。

Input Deviceで音が乗らない場合:

- 入力デバイスが実際に信号を受けているか確認してください。
- ループバック/仮想デバイスを使っている場合、意図せずシステム出力も混ざることがあります。
- macOSのマイク権限を確認してください。

Monitor Outputが使えない場合:

- Input DeviceソースではMonitor Outputは無効化されます。
- App AudioまたはFileソースで確認してください。
- Output Deviceを変更した場合は、必要に応じて `Refresh Monitor Devices` を押してください。

## Development

Build instructions are split by operating system:

- [Build on macOS](docs/build-macos.md)
- [Build on Windows](docs/build-windows.md)
- [Build on Linux](docs/build-linux.md)

macOS is the primary supported build target. Windows and Linux packaging notes are included for future platform work, but the current audio capture path depends on macOS Core Audio.

## Test Stream Config

`test_streamconfig.txt` is a local convenience note for stream testing. Treat it as sensitive operational data and do not publish it.

## Repository Documents

- `docs/implementation_plan.md`: project history, architecture notes, current plan, and future work
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
