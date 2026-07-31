# SCP Crawler

SCP財団の各支部サイトをクロールして、SCP Readerアプリ用の記事データ（`local-data/<lang>/scp-data.json`）を生成するリポジトリです。

アプリ（scpReader）は起動時に、選択中の閲覧言語に応じて以下のURLからデータを取得します：

```
# 日本語（互換のため従来パスのまま）
https://raw.githubusercontent.com/hirotakaakita/scpjpReaderActions/refs/heads/master/local-data/scp-data.json
# その他の言語
https://raw.githubusercontent.com/hirotakaakita/scpjpReaderActions/refs/heads/master/local-data/<lang>/scp-data.json
```

## 対応言語

対象サイト・ページの定義はすべて `languages.js` に集約されています。

| コード | 支部 | サイト | 備考 |
|---|---|---|---|
| jp | 日本語 | scp-jp.wikidot.com | 互換のため `local-data/` 直下にも同データを出力 |
| en | English | scp-wiki.wikidot.com | 本家。シリーズ1〜10 |
| cn | 中文 | scp-wiki-cn.wikidot.com | 支部記事はプレフィックス型slug（scp-cn-XXX） |
| cs | Česky | scp-cs.wikidot.com | スロバキア語リスト（scp-series-sk）も併設 |
| de | Deutsch | scp-wiki-de.wikidot.com | |
| es | Español | lafundacionscp.wikidot.com | プレフィックス型（scp-es-XXX） |
| fr | Français | fondationscp.wikidot.com | 支部一覧は liste-fr |
| int | International | scp-int.wikidot.com | INT独自記事（int-hub）のみ。全体シリーズ一覧は存在しない |
| it | Italiano | fondazionescp.wikidot.com | 番号なしslugのジョーク記事は対象外 |
| ko | 한국어 | scpko.wikidot.com | |
| pl | Polski | scp-pl.wikidot.com | プレフィックス型（scp-pl-XXX） |
| pt | Português | scp-pt-br.wikidot.com | |
| th | ภาษาไทย | scp-th.wikidot.com | |
| ua | Українська | scp-ukrainian.wikidot.com | 特殊構造のため支部独自リストのみ・anyLinkモード |
| vn | Tiếng Việt | scp-vn.wikidot.com | |
| zh-tr | 繁體中文 | scp-zh-tr.wikidot.com | 支部記事slugは scp-zh-XXX |

**未対応**: Русский（scpfoundation.net）はアンチボット保護（Anubis、JSでのproof-of-work必須）のため通常のHTTP取得ではクロールできません。旧wikidotミラー（scp-ru.wikidot.com）もscpfoundation.netへリダイレクトされるため代替になりません。

### クロール上の注意（調査済み）

- wikidotサイトの多くはHTTPS非対応（httpsはhttpへ301リダイレクトされ、HTTPS強制のクライアントだとループする）。`languages.js` の `baseUrl` のスキームを変えないこと。
- 支部独自記事のslugはサフィックス型（scp-001-de）とプレフィックス型（scp-es-001）が混在する。プレフィックス型はページごとに `entryPattern` で番号抽出パターンを指定している。
- `class="newpage"` のリンクは「リンク先未作成」。国際版ミラーでは「未翻訳（英語版は読める）」の意味なので含め、支部独自リストでは「記事が存在しない」ので除外する（`skipUnwritten`）。
- 出力フィールド名 `titleJP` / `urlJP` / `isTranslatedJP` のJPは歴史的経緯によるもので、多言語化後は「選択言語（現地語）の」の意味。アプリとの互換性のため維持している。

## データの更新方法

### 自動更新（GitHub Actions）

毎週日曜日午前0時（UTC、日本時間午前9時）に `scp-crawler.yml` が自動実行されます。手動実行はActionsタブの「SCP Crawler」→「Run workflow」から。

1. **setupジョブ**: `print-matrix.js` で全言語×全ページ（約210件）のmatrixを生成
2. **crawlジョブ（matrix）**: 一覧ページ1枚ずつ `partial-crawler.js <lang> <page>` でクロールし、部分JSONをartifactにアップロード
   - クロール先のレート制限対策として同時実行は5ページまで（`max-parallel: 5`）、エントリ間の待機は1000ms（`CRAWL_DELAY_MS`）
   - 既存の `local-data/<lang>/scp-data.json` を参照する差分クロールのため、取得済みの画像URLと `createdAt` は引き継がれる
3. **merge-and-deployジョブ**: artifactを `merge-data.js` で言語ごとに結合し、`local-data/` にcommit & push
   - **言語単位で全ページのクロールが成功した言語のみ**結合される。ある言語で1ページでも失敗するとその言語はスキップされ、配信データは前回のまま維持される（記事の欠損防止）

### 手動更新（ローカル実行）

```bash
npm install
node local-crawler.js jp     # 指定言語のlocal-data/<lang>/scp-data.jsonを一括生成（数時間かかります）
git add local-data/
git commit -m "Update SCP data"
git push
```

特定ページのみの分割クロールと結合をローカルで行う場合：

```bash
node partial-crawler.js jp scp-series-3   # partial-data/jp--scp-series-3.json に出力
node merge-data.js jp                     # jpの全ページ分を local-data/ に結合（引数省略で全言語）
```

一覧抽出だけを確認したい場合は `SKIP_IMAGE_FETCH=1` を付けると記事ページへの画像取得アクセスを省略できます。

masterブランチにpushした時点でアプリの取得先に反映されます。
アプリは起動時に選択言語の `meta.json` の `lastUpdated` を前回取り込み時の値と比較し、変化があれば `scp-data.json` を再ダウンロードします（`meta.json` と `scp-data.json` は必ずセットで更新してください）。

配信JSONは非ASCII文字をすべて `\uXXXX` にエスケープして出力します（`stringifyAsciiSafe`）。
raw.githubusercontent.com がcharset指定なし（`application/octet-stream`）で配信するため、生のUTF-8文字列を含めるとアプリ側でLatin-1解釈されて文字化けします。手動でデータを生成・修正する場合も必ずASCIIのみの形式を維持してください。

## 構成

```
.
├── .github/workflows/scp-crawler.yml   # 週次の分割並列クロールワークフロー
├── languages.js                         # 言語（支部サイト）ごとのクロール設定
├── local-crawler.js                     # クローラー本体（一括実行用エントリポイント兼クラス定義）
├── partial-crawler.js                   # 一覧ページ1枚だけクロール（matrixジョブ用）
├── merge-data.js                        # 部分JSONを言語ごとに結合してlocal-data/を生成
├── print-matrix.js                      # Actionsのmatrix定義を出力
├── local-data/
│   ├── scp-data.json                    # 日本語データ本体（旧アプリ互換パス）
│   ├── meta.json                        # 日本語メタデータ（旧アプリ互換パス）
│   └── <lang>/                          # 言語別データ（jp含む）
│       ├── scp-data.json
│       └── meta.json
└── package.json
```

## 変更履歴

- 2026-08-01: 多言語対応。`languages.js` に16言語（jp/en/cn/cs/de/es/fr/int/it/ko/pl/pt/th/ua/vn/zh-tr）のクロール設定を集約し、言語別に `local-data/<lang>/` へ出力。JPは互換のため従来パスにも出力。JPのクロール対象に scp-series-10 と scp-series-jp-5 を追加。
- 2026-07-10: クロール対象をページ単位に分割したmatrix並列ワークフローで自動更新を再構築（旧ワークフローは実行時間上限のため2026-07-10に一度廃止）。旧Firestore/Firebase Functions連携は廃止済み。
