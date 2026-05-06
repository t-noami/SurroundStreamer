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
