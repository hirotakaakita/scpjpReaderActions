# SCP Crawler

SCP-JPサイト（http://scp-jp.wikidot.com/）をクロールして、SCP Readerアプリ用の記事データ（`local-data/scp-data.json`）を生成するリポジトリです。

アプリ（scpReader）は起動時に以下のURLからデータを取得します：

```
https://raw.githubusercontent.com/hirotakaakita/scpjpReaderActions/refs/heads/master/local-data/scp-data.json
```

## データの更新方法（手動）

クロールに数時間かかるため、GitHub Actionsの実行時間上限に収まりません。更新はローカルで手動実行します。

```bash
npm install
npm run crawl        # local-data/scp-data.json を生成（数時間かかります）
git add local-data/
git commit -m "Update SCP data"
git push
```

masterブランチにpushした時点でアプリの取得先に反映されます。
※ アプリ側はローカルDBに記事が存在すると再ダウンロードをスキップするため、インストール済み端末への反映にはアプリの再インストール（またはデータ削除）が必要です。

## 構成

```
.
├── local-crawler.js           # メインクローラー（全URL対応）→ local-data/ に出力
├── test-crawler.js            # テスト用クローラー → test-data/ に出力
├── local-data/
│   ├── scp-data.json          # SCPデータ本体（アプリが参照）
│   └── meta.json              # メタデータ
├── example/                   # クロール対象ページのHTMLサンプル
└── package.json
```

## 変更履歴

- 2026-07-10: GitHub Actionsによる自動更新（`scp-crawler.yml` + `github-crawler.js` + `data/`）を廃止し、`local-crawler.js` による手動更新に一本化。旧Firestore/Firebase Functions連携も廃止済み。
