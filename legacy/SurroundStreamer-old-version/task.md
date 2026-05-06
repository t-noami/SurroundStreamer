# SurroundStreamer — Implementation Tasks

## Phase 1: MVP（最小動作版）

### Project Setup
- [x] Electron + Vite プロジェクト初期化
- [x] 依存パッケージのインストール
- [x] .gitignore 作成
- [x] プロジェクト構造の構築

### Main Process（バックエンド）
- [x] main.js — Electronエントリーポイント
- [x] preload.js — contextBridge API
- [x] ffmpeg-manager.js — FFmpegプロセス管理
- [x] device-scanner.js — macOSオーディオデバイス列挙
- [x] ipc-handlers.js — IPC通信ハンドラー
- [ ] config-store.js — 設定永続化 (Next Step)

### Renderer Process（フロントエンドUI）
- [x] index.html — メインHTML
- [x] index.css — デザインシステム（ダークテーマ）
- [x] app.js — メインアプリケーションロジック

### Icecast設定テンプレート
- [ ] icecast-surround.xml テンプレート
- [ ] docker-compose.yml（ローカルテスト用）

### 検証
- [/] アプリ起動確認
- [x] FFmpegバイナリ検出確認 (libopus support verified)
- [ ] デバイス一覧取得確認
- [ ] テストトーン送出確認（ローカルIcecastまたはドライラン）
- [ ] UI動作確認

## Phase 2: 実用版（後日）
- [ ] リアルタイムデバイス入力対応
- [ ] ステレオ同時配信
- [ ] Icecastステータスモニタリング
- [ ] 6chレベルメーター

## Phase 3: パッケージング（後日）
- [ ] electron-builderによるdmgビルド
- [ ] FFmpegバイナリのバンドル
- [ ] アプリアイコン
