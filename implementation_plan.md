# SurroundStreamer — macOS 5.1サラウンド Icecast配信アプリ

macOSから **Ogg Opus 5.1** を **Icecast** サーバーへ配信するためのデスクトップGUIアプリケーションを開発する。
FFmpegをバックエンドに持ち、Electronで操作UIを提供する構成。

---

## User Review Required

> [!IMPORTANT]
> **技術スタック選定: Electron vs Swift (ネイティブ)**
> Electronを選定した理由は以下の通りです。判断に異論があればフィードバックください。
> - FFmpegプロセスの管理に `child_process` / `fluent-ffmpeg` が最適
> - UIの高速プロトタイピングが可能（HTML/CSS/JS）
> - 将来的にWindows/Linuxへの展開余地がある
> - Swiftネイティブの場合、CoreAudio直接操作は可能だがUI開発コストが大幅に増加する

> [!IMPORTANT]
> **FFmpegバイナリの同梱方針**
> `ffmpeg-static` (npm) を使ってアプリバンドルにFFmpegバイナリを含めるか、ユーザーのシステムFFmpeg（Homebrew等）を利用するか。
> - **同梱案（推奨）**: ユーザー環境に依存しない。ただしアプリサイズが +80MB程度増加
> - **外部依存案**: アプリは軽量だが、ユーザーに `brew install ffmpeg` を要求する
> 
> 現時点では **同梱案** で進める想定です。

> [!WARNING]
> **libopus対応の確認が必要**
> `ffmpeg-static` の macOS arm64 ビルドに `libopus` が含まれているか、ビルド時に検証が必要です。含まれていない場合はカスタムビルドまたはHomebrew FFmpegへのフォールバックが必要になります。

---

## Open Questions

1. **アプリ名は「SurroundStreamer」で確定でよいか？** ワークスペース名から仮採用しています。
2. **Icecastサーバーは既にあるか、それともローカルテスト用にDockerでIcecastも立てるか？** 検証計画に影響します。
3. **想定する入力ソースの優先度は？** 以下のうちどれを最優先で対応するか：
   - ファイル入力（5.1 WAV / FLAC / マルチチャンネルファイル）
   - リアルタイム入力（オーディオインターフェース / Aggregate Device）
   - 両方同時に対応
4. **ステレオ版の同時配信機能は初期バージョンから必要か？** それとも5.1配信単体を先行して後から追加するか。
5. **UIの言語は日本語 / 英語 / 両対応？**

---

## アーキテクチャ概要

```mermaid
graph TB
    subgraph Electron App
        UI[Renderer Process<br/>React/Vanilla JS UI]
        Main[Main Process<br/>FFmpeg Manager]
        IPC[IPC Bridge<br/>contextBridge]
    end

    subgraph Audio Input
        File[5.1 WAV/FLAC File]
        Device[Audio Interface<br/>6ch / Aggregate Device]
    end

    subgraph External
        Icecast[Icecast Server<br/>:8000]
        VLC[VLC Player<br/>5.1再生確認]
    end

    File --> Main
    Device --> Main
    UI <--> IPC <--> Main
    Main -->|FFmpeg child_process<br/>Ogg Opus 5.1| Icecast
    Icecast -->|HTTP Stream| VLC

    style UI fill:#1a1a2e,stroke:#e94560,color:#eee
    style Main fill:#1a1a2e,stroke:#0f3460,color:#eee
    style Icecast fill:#16213e,stroke:#533483,color:#eee
```

### データフロー

```text
[入力ソース] → [FFmpeg (libopus enc)] → [Ogg Opus 5.1 stream] → [Icecast /surround.opus]
                                       → [ダウンミックス → Ogg Opus stereo] → [Icecast /stereo.opus] (オプション)
```

---

## Proposed Changes

### Component 1: プロジェクト初期化・基盤

#### [NEW] package.json
- Electron + electron-builder によるプロジェクト構成
- 依存: `electron`, `electron-builder`, `fluent-ffmpeg`, `ffmpeg-static`（またはカスタム管理）
- Scripts: `dev`, `build`, `package`

#### [NEW] electron-builder.yml
- macOS向けビルド設定（dmg, zip）
- FFmpegバイナリのextraResources設定
- Apple Silicon (arm64) + Intel (x64) ユニバーサル対応

#### [NEW] .gitignore
- node_modules, dist, build artifacts

---

### Component 2: Main Process（バックエンド）

#### [NEW] src/main/main.js
- Electronアプリのエントリーポイント
- BrowserWindowの生成
- IPC handlerの登録
- アプリライフサイクル管理（起動/終了時のクリーンアップ）

#### [NEW] src/main/ffmpeg-manager.js
FFmpegプロセスの管理を担当する中核モジュール。

**責務:**
- FFmpegバイナリパスの解決（バンドル内 or システム）
- FFmpegプロセスの起動・停止・状態監視
- コマンドライン引数の組み立て（入力ソース × エンコード設定 × 出力先）
- stderr/stdoutのパース（進捗、エラー検出）
- プロセス異常終了時の自動再起動（オプション）

**主要メソッド:**
```javascript
class FFmpegManager {
  // 配信開始
  async startStream(config: StreamConfig): Promise<void>
  // 配信停止
  async stopStream(): Promise<void>
  // 現在の状態取得
  getStatus(): StreamStatus
  // オーディオデバイス一覧取得
  async listAudioDevices(): Promise<AudioDevice[]>
  // FFmpegバージョン・コーデック確認
  async checkCapabilities(): Promise<Capabilities>
}
```

**StreamConfig型:**
```typescript
interface StreamConfig {
  // 入力
  inputType: 'file' | 'device'
  inputPath: string              // ファイルパス or デバイス識別子
  
  // エンコード
  channels: 6
  channelLayout: '5.1'
  codec: 'libopus'
  bitrate: string                // '384k', '512k' etc.
  sampleRate: 48000
  mappingFamily: 1
  vbr: 'on' | 'off' | 'constrained'
  application: 'audio' | 'voip' | 'lowdelay'
  frameDuration: 20 | 40 | 60
  
  // 出力（Icecast）
  icecastHost: string
  icecastPort: number
  mountPoint: string             // '/surround.opus'
  sourcePassword: string
  
  // オプション
  enableStereoFallback: boolean
  stereoMountPoint: string       // '/stereo.opus'
  stereoBitrate: string          // '128k'
}
```

#### [NEW] src/main/device-scanner.js
macOSのオーディオデバイスを列挙するモジュール。

**方法:** `ffmpeg -f avfoundation -list_devices true -i ""` の出力をパースし、デバイス名・インデックス・チャンネル数を取得する。

> [!NOTE]
> AVFoundationの `-list_devices` は stderr に出力するため、stderrをキャプチャしてパースする必要がある。チャンネル数の詳細取得には追加で `ffprobe` を使う可能性あり。

#### [NEW] src/main/icecast-monitor.js
Icecastサーバーの状態監視モジュール。

**方法:** `/status-json.xsl` エンドポイントをポーリングし、マウントポイントの状態・リスナー数・ストリーム情報を取得。

```javascript
class IcecastMonitor {
  async getServerStatus(host, port, credentials?): Promise<ServerStatus>
  startPolling(intervalMs: number): void
  stopPolling(): void
  // EventEmitter: 'status-update', 'mount-active', 'mount-inactive'
}
```

#### [NEW] src/main/ipc-handlers.js
Renderer ↔ Main 間のIPC通信ハンドラー定義。

| チャンネル | 方向 | 用途 |
|-----------|------|------|
| `stream:start` | Renderer → Main | 配信開始 |
| `stream:stop` | Renderer → Main | 配信停止 |
| `stream:status` | Main → Renderer | 状態更新（push） |
| `devices:list` | Renderer → Main | デバイス一覧取得 |
| `icecast:status` | Main → Renderer | サーバー状態（push） |
| `ffmpeg:log` | Main → Renderer | FFmpegログ転送 |
| `config:save` | Renderer → Main | 設定保存 |
| `config:load` | Renderer → Main | 設定読込 |

#### [NEW] src/main/preload.js
contextBridgeによるセキュアなAPI公開。`nodeIntegration: false`, `contextIsolation: true` を維持。

---

### Component 3: Renderer Process（フロントエンドUI）

#### [NEW] src/renderer/index.html
アプリケーションのメインHTML。

#### [NEW] src/renderer/index.css
デザインシステム。ダークテーマベースのプロフェッショナルなオーディオアプリ風UI。

**デザイン方針:**
- ダークモード（`#0a0a0f` ベース）
- アクセントカラー: パープル～シアンのグラデーション
- グラスモーフィズムのパネル
- リアルタイムレベルメーター風のインジケーター
- 配信中/停止中の状態がひと目でわかるステータスインジケーター

#### [NEW] src/renderer/app.js
メインアプリケーションロジック。

**UI構成（5つのセクション）:**

1. **ヘッダー / ステータスバー**
   - アプリ名・バージョン
   - 配信状態インジケーター（🔴 LIVE / ⚫ IDLE）
   - Icecast接続状態
   - リスナー数

2. **入力ソースパネル**
   - ファイル入力 / デバイス入力の切替タブ
   - ファイル選択（ドラッグ&ドロップ対応）
   - オーディオデバイスドロップダウン（チャンネル数表示付き）
   - 入力レベルメーター（6ch個別表示: FL FR FC LFE BL BR）

3. **エンコード設定パネル**
   - ビットレート選択（256k / 384k / 512k / 768k / カスタム）
   - VBR設定
   - アプリケーションモード
   - フレーム長
   - サンプルレート

4. **Icecast接続パネル**
   - ホスト / ポート / マウントポイント / パスワード
   - ステレオ同時配信トグル（ステレオ用マウントポイント・ビットレート）
   - 接続テストボタン

5. **コントロール / ログパネル**
   - 大きな配信開始/停止ボタン
   - 配信経過時間
   - FFmpegログ（リアルタイム表示、スクロール可能）
   - エラー通知

#### [NEW] src/renderer/components/level-meter.js
6チャンネル個別のレベルメーターコンポーネント。Canvas描画。
各チャンネル（FL, FR, FC, LFE, BL, BR）をラベル付きで縦バー表示。

> [!NOTE]
> リアルタイムレベル表示はFFmpegの `ebur128` フィルタまたは `astats` フィルタの出力をパースして実現する。ただしこれはPhase 2の拡張機能として、初期バージョンではオプション扱いとする可能性あり。

#### [NEW] src/renderer/components/channel-test.js
5.1テストトーン生成・再生機能。各チャンネルを個別にテストトーンで鳴らし、チャンネル配置を確認する。
ユーザー提供情報にあったFFmpegの `sine` + `join` フィルタを使ったテスト信号をIcecastへ送出。

---

### Component 4: 設定管理

#### [NEW] src/main/config-store.js
JSON形式の設定ファイルを `~/Library/Application Support/SurroundStreamer/config.json` に保存/読込。

**保存する設定:**
- 最後に使用したIcecast接続情報
- エンコード設定プリセット
- 入力デバイス設定
- ウィンドウ位置・サイズ

---

### Component 5: Icecast設定テンプレート

#### [NEW] icecast/icecast-surround.xml
ユーザーが参照できるIcecast設定テンプレート。5.1配信用のマウントポイント設定を含む。
ユーザー提供情報のXML設定をベースにする。

#### [NEW] icecast/docker-compose.yml
ローカルテスト用のIcecast Dockerコンテナ定義（オプション）。

---

## 開発フェーズ

### Phase 1: MVP（最小動作版）
- [ ] プロジェクト初期化（Electron + Vite）
- [ ] FFmpeg Manager実装（ファイル入力 → Icecast出力）
- [ ] 基本UIの実装（接続設定 + 開始/停止 + ログ表示）
- [ ] macOSデバイス一覧取得
- [ ] 5.1テストトーン送出機能

### Phase 2: 実用版
- [ ] リアルタイムデバイス入力対応
- [ ] ステレオ同時配信
- [ ] Icecastステータスモニタリング
- [ ] 設定の永続化
- [ ] 6chレベルメーター

### Phase 3: パッケージング
- [ ] electron-builderによるdmgビルド
- [ ] FFmpegバイナリのバンドル
- [ ] アプリアイコン・メタデータ
- [ ] コード署名（オプション）

---

## Verification Plan

### Automated Tests

#### FFmpeg Manager テスト
```bash
# libopus対応確認
ffmpeg -codecs | grep opus

# テストトーン → Icecast（ローカル）送出テスト
ffmpeg -f lavfi -i "sine=frequency=440:sample_rate=48000" \
  -f lavfi -i "sine=frequency=550:sample_rate=48000" \
  -f lavfi -i "sine=frequency=660:sample_rate=48000" \
  -f lavfi -i "sine=frequency=80:sample_rate=48000" \
  -f lavfi -i "sine=frequency=770:sample_rate=48000" \
  -f lavfi -i "sine=frequency=880:sample_rate=48000" \
  -filter_complex "[0:a][1:a][2:a][3:a][4:a][5:a]join=inputs=6:channel_layout=5.1[a]" \
  -map "[a]" -c:a libopus -b:a 384k -mapping_family 1 \
  -f ogg -content_type audio/ogg \
  icecast://source:hackme@localhost:8000/surround.opus
```

#### アプリ起動テスト
```bash
npm run dev
# ブラウザツールで UI 動作確認
```

### Manual Verification

1. **チャンネル配置確認**: 各チャンネル個別テストトーンをVLCで再生し、FL/FR/FC/LFE/BL/BRが正しい位置から出力されることを確認
2. **Icecast管理画面**: `http://localhost:8000/admin/` で `/surround.opus` マウントがアクティブであることを確認
3. **VLC再生**: `http://localhost:8000/surround.opus` をVLCのネットワークストリームで開き、5.1再生を確認
4. **長時間安定性**: 30分以上の連続配信で切断・メモリリークがないことを確認
5. **ステレオフォールバック**: 5.1 + ステレオの同時配信が両方のマウントで正常に動作することを確認

---

## 技術的考慮事項

### FFmpegコマンドライン生成の要点

```bash
# 最小構成（ファイル入力）
ffmpeg -re -i input_5.1.wav \
  -ac 6 -channel_layout 5.1 \
  -c:a libopus -b:a 384k -mapping_family 1 \
  -f ogg -content_type audio/ogg \
  icecast://source:PASSWORD@HOST:PORT/surround.opus

# macOS デバイス入力
ffmpeg -f avfoundation -i ":DEVICE_INDEX" \
  -ac 6 -channel_layout 5.1 \
  -c:a libopus -b:a 384k -mapping_family 1 -application audio \
  -vbr on -frame_duration 20 \
  -f ogg -content_type audio/ogg \
  icecast://source:PASSWORD@HOST:PORT/surround.opus
```

### macOS固有の注意点

- **Aggregate Device**: 6ch入力を得るには、Audio MIDI Setupで複数デバイスをAggregateする必要がある場合がある
- **AVFoundation**: FFmpegは `-f avfoundation` でmacOSオーディオデバイスにアクセスする。デバイスインデックスは実行時に確認が必要
- **サンドボックス**: Electron + コード署名時にマイク権限（`NSMicrophoneUsageDescription`）の宣言が必要
- **Apple Silicon**: FFmpegバイナリがarm64ネイティブであることを確認（Rosetta経由は性能劣化の可能性）

### Opusエンコード設定の推奨値

| パラメータ | 推奨値 | 備考 |
|-----------|--------|------|
| `-mapping_family` | `1` | 5.1サラウンド必須。LFE最適化含む |
| `-b:a` | `384k` | 実用的。高品質なら `512k` |
| `-vbr` | `on` | 品質優先 |
| `-application` | `audio` | 音楽配信用 |
| `-frame_duration` | `20` | レイテンシと効率のバランス |
| `-ac` | `6` | 5.1 = 6チャンネル |
| `-channel_layout` | `5.1` | FL FR FC LFE BL BR |

### 現行実装の配信パラメータ

現時点のアプリでは、配信時のエンコード設定はほぼ固定値で、UIからは変更できない。

#### 現行のFFmpeg音声設定

```bash
-ac 6
-channel_layout 5.1
-c:a libopus
-b:a 384k
-vbr on
-application audio
-mapping_family 1
-frame_duration 20
-f ogg
-content_type audio/ogg
```

| 項目 | 現行値 | 備考 |
|------|--------|------|
| チャンネル数 | `6` | 5.1前提 |
| チャンネルレイアウト | `5.1` | FL FR FC LFE BL BR |
| コーデック | `libopus` | Ogg Opus配信用 |
| ビットレート | `384k` | Rendererから固定値として渡している |
| VBR | `on` | 品質優先 |
| Opus application | `audio` | 音楽・一般音声向け |
| Opus mapping family | `1` | 5.1サラウンドに必要 |
| フレーム長 | `20` ms | レイテンシと効率のバランス |
| コンテナ | `ogg` | IcecastへOgg Opusとして送出 |
| Content-Type | `audio/ogg` | Icecast用HTTPヘッダ |
| サンプリングレート | 未明示 | 入力依存。Opus 5.1配信用には `48000` 明示が望ましい |

#### 現行コード上の固定箇所

- `src/renderer/src/renderer.js`: `bitrate: '384k'` を固定で `stream:start` に渡している。
- `src/main/ffmpeg-manager.js`: `-ac 6`, `-channel_layout 5.1`, `-c:a libopus`, `-vbr on`, `-application audio`, `-mapping_family 1`, `-frame_duration 20` を固定で組み立てている。
- `-ar 48000` はまだ付与していない。

#### 推奨する次の改善

- UIにビットレート選択を追加する: `256k / 384k / 512k / 768k / custom`
- `-ar 48000` を明示し、Opus 5.1配信のサンプルレートを安定させる。
- UIにVBR設定を追加する: `on / constrained / off`
- 5.1配信の推奨初期値は `384k` または `512k`, `48000Hz`, `vbr on` とする。

---

## Audio Hijack的アプリ音声キャプチャ実装計画

### 現行版の保全

Audio Hijack的な低レイヤ音声キャプチャを追加する前段階として、現行版は `legacy/SurroundStreamer-old-version/` に退避済み。
この snapshot は、ファイル入力・デバイス入力・Icecast配信を中心とした旧版として保持する。

### Phase A: Core Audio Process Tap PoC

目的: QuickTime Playerなど、macOS上で音を出しているアプリケーションの出力音声を、仮想オーディオデバイスなしで直接捕捉できるか検証する。

実装済み:

- `native/audio-tap-helper/` に Objective-C CLI helper を追加
- `AudioHardwareCreateProcessTap` を利用
- `--list-processes` で Core Audio process object 一覧をJSON出力
- `--create-tap --pid <pid>` で指定アプリに短時間の stereo process tap を作成
- Electron main processから helper を起動する `src/main/app-audio-helper.js` を追加
- Rendererに `App Audio` タブ、アプリ一覧、`Tap Test` ボタンを追加
- macOS packaged app の `Contents/Resources/audio-tap-helper` に helper を同梱

検証済み:

- QuickTime Playerの process object を列挙できる
- QuickTime Playerに対して Process Tap 作成が成功
- 取得tap format例: `2ch`, `48000Hz`, `32-bit`

### Phase B: PCMストリーム化

次の実装目標:

1. Process Tapを含む private aggregate device を作成する。
2. `AudioDeviceIOProc` または `AudioDeviceCreateIOProcID` でtap音声を読み出す。
3. helper stdout または named pipe にPCMを流す。
4. FFmpegへ `-f f32le -ar 48000 -ac 2 -i pipe:0` のように接続する。
5. まずは stereo App Audio -> Ogg Opus Icecast 配信を成立させる。

### Phase C: 5.1対応検証

Process Tapの基本コンストラクタ `initStereoMixdownOfProcesses` は stereo mixdown になるため、5.1維持には別経路の検証が必要。

検証候補:

- `initWithProcesses:andDeviceUID:withStream:` を使い、出力デバイス stream format に追従する。
- macOS側の出力デバイスを5.1構成にした状態で、tap formatが6chになるか確認する。
- 取得PCMのchannel orderをFFmpegの `5.1` / Opus mapping family 1 に合わせる。
- 6ch維持できない場合、App Audioモードはstereo配信として扱い、5.1はBlackHole/Loopback/Audio Device入力を推奨する。

### Phase D: UI統合

App Audio入力を正式な配信入力として扱うために追加する項目:

- 対象アプリ選択
- System Audio / App Audio の切替
- Tap format表示: sample rate / channels / bit depth
- Stereo App Audio配信と5.1配信の可否表示
- Tap作成失敗時の詳細ログ
- helper crash時のcleanup

### 2026-05-05 実装進捗: App Audio PCMパイプ配信

Audio Hijack的なアプリ音声奪取機能について、Phase Bの初期実装として以下を追加した。

- `native/audio-tap-helper` に `--stream-pcm --pid <pid>` を追加
  - macOS Core Audio Process Tapで指定PIDの出力音声を取得
  - private aggregate device + IOProcでPCMを読み出し
  - stdoutへ 32-bit float PCM を連続出力
- Electron Main側でApp Audio入力をFFmpegへ接続
  - `app-audio-helper.spawnPCMStream(pid)` でヘルパーを起動
  - ヘルパーstdoutをFFmpeg stdinへpipe
  - FFmpeg入力は現時点で `f32le / 48000Hz / 2ch`
- Renderer側でApp Audio選択から配信開始できるよう変更
  - 以前の「Tap Testのみ」制限を解除
  - ログ上は `stereo mixdown` と明示
- パッケージング確認
  - `npm run build`
  - `npm run build:unpack`
  - `codesign --verify --deep --strict --verbose=2 dist/mac-arm64/SurroundStreamer.app`

現時点の重要な制約:

- App Audio配信はステレオミックスダウンであり、5.1保持ではない。
- 5.1アプリ音声をそのまま奪うには、`CATapDescription initWithProcesses:andDeviceUID:withStream:` と対象出力デバイス/ストリーム指定の検証が必要。
- この実行環境ではCore Audioの実音声出力プロセスが列挙されなかったため、PCM実データ取得の実機検証は未完了。

### 2026-05-05 実装進捗: Preserve Surroundモード試作

App Audio入力に、ステレオミックスダウンだけでなく出力デバイスstreamのフォーマットへ追従する `Preserve Surround` モードを追加した。

追加内容:

- `audio-tap-helper --list-output-streams`
  - Core Audio出力デバイスを列挙
  - 各デバイスのoutput stream index、sample rate、channel count、bit depthをJSON出力
- `audio-tap-helper --create-tap / --stream-pcm` に `--device-uid <uid> --stream-index <index>` を追加
  - 指定がある場合は `CATapDescription initWithProcesses:andDeviceUID:withStream:` を使用
  - 指定がない場合は従来通り `initStereoMixdownOfProcesses`
- UIにApp Audio modeを追加
  - `Stereo Mixdown`
  - `Preserve Surround`
- UIに出力stream選択を追加
  - Preserve Surroundでは選択streamの `channels` / `sampleRate` をFFmpeg入力へ渡す
- FFmpeg App Audio入力を可変チャンネル化
  - raw PCM: `f32le`
  - sample rate: 選択streamに追従
  - channel count: 選択streamに追従
  - 3-8chはOpus `mapping_family 1`
  - 8ch超は暫定で `mapping_family 255`

検証状況:

- `bash scripts/build-audio-tap-helper.sh` 成功
- `npm run build` 成功
- `npm run build:unpack` 成功
- `codesign --verify --deep --strict --verbose=2 dist/mac-arm64/SurroundStreamer.app` 成功
- この実行環境ではCore Audio出力デバイス/プロセスが空のため、実音声サラウンド取得は未検証

実機検証条件:

- HDMI、USBオーディオIF、BlackHole 16ch、Loopback等のマルチチャンネル出力デバイスを用意する
- macOSの出力先をそのデバイスへ設定する
- 再生アプリが2chではなくマルチチャンネルPCMをその出力先へ出していることを確認する
- App Audioで対象アプリを選択し、Preserve Surroundで該当streamを選んでTap Test/配信開始する

残課題:

- 実際のchannel orderがFFmpeg/Opusの期待順と一致するか確認する
- 8ch超のOpus配信互換性を検証する
- Preserve Surround失敗時にStereo Mixdownへ手動/自動フォールバックするUIを追加する

### 2026-05-05 実装進捗: 配信設定とピークメーター

配信前段の制御として以下を追加した。

- 配信ビットレート設定
  - UIで 128k / 192k / 256k / 384k / 512k / 768k を選択
  - `FFmpegManager` の `-b:a` に反映
- サンプル周波数設定
  - UIで 44.1kHz / 48kHz / 96kHz を選択
  - FFmpeg出力側 `-ar` に反映
- 配信に流すチャンネル指定
  - UIで最大8chの入力チャンネルをON/OFF
  - FFmpegの `pan` filterでエンコード前に不要チャンネルを落とす
  - 選択チャンネル数に応じて `-ac` と `-channel_layout` を更新
- 配信ピークメーター
  - FFmpeg filter chainへ `astats=metadata=1` と `ametadata=print` を追加
  - `lavfi.astats.<ch>.Peak_level` をMain processでパース
  - IPC `stream:meter` でRendererへ転送
  - RendererでチャンネルごとのピークバーとdB表示を更新

実装上の意図:

- チャンネル削減はOpusエンコード前の `pan` filterで行うため、不要チャンネルをエンコードしない。
- メーターはエンコード直前のfilter chain上で見るため、実際に配信へ入るチャンネル構成に近い値を表示する。

検証:

- `npm run build` 成功
- `npm run lint` 成功。ただし既存の `SurroundWebPlayer/app.js` と `legacy` 側のPrettier警告は残存
- FFmpeg filter単体テストで `pan + astats + ametadata` の構文成立を確認
- `npm run build:unpack` 成功
- `codesign --verify --deep --strict --verbose=2 dist/mac-arm64/SurroundStreamer.app` 成功

残課題:

- 実配信時のピークメーター更新頻度とログ量を実音声で確認する
- Preserve Surround時のチャンネル順序とUIラベルの一致を実機で確認する
- 8ch超のチャンネル指定UIは未対応。現状UIは最大8chまで

### 2026-05-05 実装進捗: 配信音声モニターアウト

配信へ送る直前の音声を、別系統でローカル出力するモニターアウト機能を追加した。

追加内容:

- Monitor Output UIを追加
  - モニター出力ON/OFF
  - 出力デバイス指定
  - モニターモード選択
    - `Ch1/Ch2 Stereo`
    - `Binaural HRTF`（Web Audio API `PannerNode` のHRTFで処理）
- Web Audio出力デバイス列挙
  - Renderer側で `navigator.mediaDevices.enumerateDevices()` の `audiooutput` を列挙
  - 指定デバイスへの出力は `HTMLMediaElement.setSinkId()` を使用
  - `selectAudioOutput()` が使える環境ではRefresh操作時に出力先選択を試行
- FFmpeg分岐出力
  - モニターON時は `-filter_complex` で配信用音声を `asplit=2`
  - `[enc]` は従来通りIcecast/Ogg Opusへ送出
  - `Ch1/Ch2 Stereo` では `[mon]` を `pan=stereo|c0=c0|c1=c1` で2ch化し、raw `f32le` として `pipe:3` へ出す
  - `Binaural HRTF` では `[mon]` をマルチチャンネルraw `f32le` のまま `pipe:3` へ出す
  - Main processは `pipe:3` のPCM chunkをIPC `monitor:audio` でRendererへ転送

HRTF / バイノーラル化について:

- Web Audio API標準のHRTFはRenderer上のWeb Audioグラフで使うため、FFmpegからモニター用PCMをRendererへ分岐転送する方式で実装した。
- `AudioWorkletNode` がraw PCMをチャンネル別mono出力へ展開し、各チャンネルを `PannerNode` へ接続する。
- `PannerNode.panningModel = 'HRTF'` を使用し、5.1/7.1相当のチャンネル位置を仮想音源位置へ割り当てる。
- LFEは定位対象として扱いにくいため、暫定的に低ゲイン中央成分として混ぜる。

検証:

- FFmpeg filter単体テストで `asplit + astats/ametadata + pipe:3 f32le monitor` の構文成立を確認
- `npm run build` 成功
- `npm run lint` 成功。ただし既存の `SurroundWebPlayer/app.js` と `legacy` 側のPrettier警告は残存
- `npm run build:unpack` 成功
- `codesign --verify --deep --strict --verbose=2 dist/mac-arm64/SurroundStreamer.app` 成功

残課題:

- 実機でWeb Audio output device列挙、`setSinkId`、指定デバイスへの出力を確認する
- 実機でHRTFモニターのレイテンシ、IPC転送負荷、長時間安定性を確認する
- HRTFのチャンネル位置/ゲイン、特にCenter/LFE/Rearの聴感チューニングを行う

### 2026-05-05 修正: AudioWorklet module load failure

実機起動時に `Error starting monitor output: Unable to load a worklet's module.` が出たため、Worklet配布方式を修正した。

原因:

- `new URL('./monitor-worklet.js', import.meta.url)` を使ったところ、ViteがWorkletコードを `data:` URLへインライン化した。
- Electron/AudioWorklet側でその `data:` URLモジュールをロードできず、`audioWorklet.addModule()` が失敗した。

修正:

- Workletを `src/renderer/public/monitor-worklet.js` に配置し、ビルド後に `out/renderer/monitor-worklet.js` として実ファイル配布する。
- Renderer側は `audioWorklet.addModule('./monitor-worklet.js')` で同一originの静的JSとして読み込む。

検証:

- `npm run build` 成功
- ビルド結果に `out/renderer/monitor-worklet.js` が存在することを確認
- 出力JSが `data:text/javascript` を参照していないことを確認
- `npm run lint` 成功。ただし既存の `SurroundWebPlayer` と `legacy` 側のPrettier警告は残存
- `npm run build:unpack` 成功
- `codesign --verify --deep --strict --verbose=2 dist/mac-arm64/SurroundStreamer.app` 成功

### 2026-05-05 修正: 配信中のMonitor Output設定反映

配信中にMonitor Outputの設定を変更した場合、その場で反映されるように修正した。

修正内容:

- FFmpeg側のモニター分岐を常時マルチチャンネルPCM出力へ変更
  - `pipe:3` は配信へ送るチャンネル構成と同じraw `f32le` を出す
  - `Stereo` / `Binaural HRTF` の差分はRenderer側Web Audioグラフで処理する
- Main processに `monitor:set-active` IPCを追加
  - FFmpegの `pipe:3` は常にdrainする
  - Rendererへの `monitor:audio` 転送だけON/OFFする
  - これにより配信開始後にモニターON/OFFできる
- Renderer側で配信中の変更イベントを監視
  - Monitor Output ON/OFF
  - 出力デバイス変更
  - `Ch1/Ch2 Stereo` / `Binaural HRTF` 切替
- 設定変更時はWeb Audio Monitorを再構成
  - 出力デバイスは `setSinkId()` で反映
  - モード変更時は `AudioWorkletNode` + `PannerNode` グラフを再生成

制約:

- 配信に流すチャンネル指定そのものはFFmpeg filter graphを変える必要があるため、配信中の変更は現時点では対象外。
- モニター設定変更時はWeb Audioグラフを短く再起動するため、一瞬の音切れは発生し得る。

検証:

- FFmpeg filter単体テストで `asplit + pipe:3 f32le monitor` の構文成立を確認
- `npm run build` 成功
- `npm run lint` 成功。ただし既存の `SurroundWebPlayer` と `legacy` 側のPrettier警告は残存
- `npm run build:unpack` 成功
- `codesign --verify --deep --strict --verbose=2 dist/mac-arm64/SurroundStreamer.app` 成功

### 2026-05-05 修正: 配信開始後のUI横はみ出し

配信開始後に画面内容が横方向へ広がり、ウィンドウ外へはみ出す問題を修正した。

原因:

- FFmpeg起動ログやmonitor/device名などの長い文字列が折り返されず、grid/flex itemの最小幅を押し広げていた。
- CSS gridの `1fr` は内容のmin-content幅を尊重するため、長いログ行やselect表示が列幅を拡張していた。
- `input-section` が横一列固定に近く、App AudioやMonitor周りのselect/buttonが狭いウィンドウで押し出されやすかった。

修正:

- `main` / `.form-grid` を `minmax(0, 1fr)` ベースに変更
- `.panel` / `.form-group` / `.input-section` / `.file-selector` / meter周りに `min-width: 0` を追加
- `.input-section` を `flex-wrap: wrap` にしてselect/buttonが折り返せるように変更
- `.log-container` の横スクロールを抑制し、`.log-entry` を `overflow-wrap: anywhere` / `white-space: pre-wrap` で折り返すよう変更
- channel selector / peak meterもmin-content幅で親を押し広げないよう調整

検証:

- `npm run build` 成功
- `npm run lint` 成功。ただし既存の `SurroundWebPlayer` と `legacy` 側のPrettier警告は残存
- `npm run build:unpack` 成功
- `codesign --verify --deep --strict --verbose=2 dist/mac-arm64/SurroundStreamer.app` 成功

### 2026-05-05 修正: UI panel clipping regression

前回の横はみ出し対策後、panel内部のフォームが縦方向に切れて表示されるregressionを修正した。

原因:

- `.panel { overflow: hidden; }` により、panel内コンテンツがpanel高さを超えた場合に表示ごと切られていた。
- `main` に `grid-template-rows: auto auto 1fr` を指定していたため、Monitor/Config/Control/Logsなど後続rowの高さ配分が不自然になっていた。

修正:

- `.panel` の `overflow: hidden` を削除
- `main` は `grid-auto-rows: max-content` と `align-content: start` に変更
- panel子要素には `min-width: 0` を維持して、横はみ出し対策は残す
- logsは `max-height` 付きの内部スクロールにして、画面全体を押し広げないようにした

検証:

- `npm run build` 成功
- `npm run lint` 成功。ただし既存の `SurroundWebPlayer` と `legacy` 側のPrettier警告は残存
- `npm run build:unpack` 成功
- `codesign --verify --deep --strict --verbose=2 dist/mac-arm64/SurroundStreamer.app` 成功
