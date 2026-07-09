# SCP Crawler

SCP-JPサイト（http://scp-jp.wikidot.com/）をクロールして、SCP Readerアプリ用の記事データ（`local-data/scp-data.json`）を生成するリポジトリです。

アプリ（scpReader）は起動時に以下のURLからデータを取得します：

```
https://raw.githubusercontent.com/hirotakaakita/scpjpReaderActions/refs/heads/master/local-data/scp-data.json
```

## データの更新方法

### 自動更新（GitHub Actions）

毎週日曜日午前0時（UTC、日本時間午前9時）に `scp-crawler.yml` が自動実行されます。手動実行はActionsタブの「SCP Crawler」→「Run workflow」から。

一括クロールは約3時間かかりActionsの実行時間上限に触れるため、以下の分割並列構成にしています：

1. **crawlジョブ（matrix、17ページ）**: 一覧ページ1枚ずつ `partial-crawler.js` でクロールし、部分JSONをartifactにアップロード
   - クロール先のレート制限対策として同時実行は3ページまで（`max-parallel: 3`）、エントリ間の待機は1000ms（`CRAWL_DELAY_MS`）
   - 既存の `local-data/scp-data.json` を参照する差分クロールのため、取得済みの画像URLと `createdAt` は引き継がれる
2. **merge-and-deployジョブ**: 全ページのartifactを `merge-data.js` で結合し、`local-data/` にcommit & push
   - **17ページ全てのクロールが成功した場合のみ**実行される。1ページでも失敗すると結合はスキップされ、配信データは前回のまま維持される（記事の欠損防止）

### 手動更新（ローカル実行）

```bash
npm install
npm run crawl        # local-data/scp-data.json を一括生成（数時間かかります）
git add local-data/
git commit -m "Update SCP data"
git push
```

特定ページのみの分割クロールと結合をローカルで行う場合：

```bash
node partial-crawler.js scp-series-3   # partial-data/scp-series-3.json に出力
node merge-data.js                     # partial-data/ の17ページ分を local-data/ に結合
```

masterブランチにpushした時点でアプリの取得先に反映されます。
※ アプリ側はローカルDBに記事が存在すると再ダウンロードをスキップするため、インストール済み端末への反映にはアプリの再インストール（またはデータ削除）が必要です。

## 構成

```
.
├── .github/workflows/scp-crawler.yml   # 週次の分割並列クロールワークフロー
├── local-crawler.js                     # クローラー本体（一括実行用エントリポイント兼クラス定義）
├── partial-crawler.js                   # 一覧ページ1枚だけクロール（matrixジョブ用）
├── merge-data.js                        # 部分JSONを結合してlocal-data/を生成
├── test-crawler.js                      # テスト用クローラー → test-data/ に出力
├── local-data/
│   ├── scp-data.json                    # SCPデータ本体（アプリが参照）
│   └── meta.json                        # メタデータ
├── example/                             # クロール対象ページのHTMLサンプル
└── package.json
```

## 変更履歴

- 2026-07-10: クロール対象をページ単位に分割したmatrix並列ワークフローで自動更新を再構築（旧ワークフローは実行時間上限のため2026-07-10に一度廃止）。旧Firestore/Firebase Functions連携は廃止済み。
