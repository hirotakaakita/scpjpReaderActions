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

## 強制アップデート・メンテナンス制御（app-status.json）

アプリは起動時（データ取得より前）に以下のURLを取得し、内容に応じて強制アップデート画面
またはメンテナンス画面を表示します。取得に失敗した場合（配信元の一時的な不調など）は
制限なしとして通常起動します。

```
https://raw.githubusercontent.com/hirotakaakita/scpjpReaderActions/refs/heads/master/app-status.json
```

```json
{
  "maintenance": false,
  "maintenanceMessage": "現在メンテナンス中です。しばらくしてから再度お試しください。",
  "minSupportedVersion": "1.2.5",
  "updateMessage": "ご利用のバージョンはサポートされていません。最新版にアップデートしてください。",
  "androidStoreUrl": "https://play.google.com/store/apps/details?id=com.scp.reader",
  "iosStoreUrl": "https://apps.apple.com/app/idXXXXXXXXXX"
}
```

| フィールド | 説明 |
|---|---|
| `maintenance` | `true`にすると、バージョンに関わらず全ユーザーにメンテナンス画面(離脱不可)を表示する |
| `maintenanceMessage` | メンテナンス画面の案内文。空文字ならアプリ側の既定文言を使う |
| `minSupportedVersion` | この値未満のアプリバージョン（`pubspec.yaml`の`version:`の`+`より前、例: `1.2.4`）には強制アップデート画面(離脱不可)を表示する。ドット区切りの数値のみ対応 |
| `updateMessage` | 強制アップデート画面の案内文。空文字ならアプリ側の既定文言を使う |
| `androidStoreUrl` / `iosStoreUrl` | 強制アップデート画面の「アップデートする」ボタンの遷移先 |

**使い方**: このファイルを直接編集してmasterにpush・commitするだけで、次にアプリが起動した
ユーザーから順次反映されます（ビルドやリリース作業は不要）。メンテナンスを終える時は
`maintenance`を`false`に戻してください。

**注意**: この仕組み自体を認識できるのはこの機能を含むバージョン以降のアプリだけです。
それより古いバージョンは`app-status.json`を一切参照しないため、強制アップデートや
メンテナンス通知は届きません。

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
├── send-new-scp-notifications.js        # 新着SCPのFCM週次PUSH通知送信
├── app-status.json                      # 強制アップデート・メンテナンス制御
├── local-data/
│   ├── scp-data.json                    # 日本語データ本体（旧アプリ互換パス）
│   ├── meta.json                        # 日本語メタデータ（旧アプリ互換パス）
│   └── <lang>/                          # 言語別データ（jp含む）
│       ├── scp-data.json
│       └── meta.json
└── package.json
```

### 記事詳細取得に失敗した場合のタグ

詳細取得が全リトライ失敗した場合、既存のタグと `tagVersion` を保持し、
`tagFetchStatus: "failed"` を記録して次回クロールで再取得します。
取得成功時はタグが空でも `"success"` と現在のバージョンを記録します。
旧データの「成功記録のない空タグ」も再取得対象とし、過去の取得失敗による空タグを修復します。
強制更新が失敗した場合も、次回は強制フラグなしで再取得します。

## 週次通知キューの運用

`scp-crawler.yml` はデータ公開前に `prepare-notification-queue.js` を実行し、
GitのHEADにある前回カタログとの差分を `local-data/notification-queue.json` に保存します。
通知キューとカタログは同じコミットで公開されます。

`scheduled-notifications.yml` は15分ごとにキューを確認します。
通知タイトル・定型文は配信先の支部言語で生成します（INTは英語、cnは簡体字、zh-trは繁体字）。
文言は `notification-messages.js` に集約し、旧送信スクリプトも同じ文言を使用します。
記事タイトルは各言語カタログのものを使い、総件数と先頭2件を表示します。
長い記事タイトルは絵文字・結合文字を途中で分割せずに短縮します。
未知の支部コードは英語へフォールバックし、既知の支部の翻訳漏れはテストで検出します。

各言語の現地時刻で日曜20時以降に未送信の新着記事を通知します。キュー未生成の初期状態では、
送信・コミットとも正常にスキップします。次回クロールの公開成功時にキューが作られます。
通知復旧のために過去の全記事をキューへ投入する必要はありません。
キューが空、送信時刻外、またはFirebase Secret未設定の場合も送信しません。

送信履歴は `local-data/notification-deliveries.json` に言語・現地日付単位
（例: `jp/2026-10-04`）で保存します。各送信の前に `sending` と対象記事のスナップショットを
コミット・pushし、成功した場合に限りFCMを呼び出します。FCMの受理後はメッセージIDと
`sent` を記録し、その記事だけをキューから除いて即座にコミット・pushします。
途中の言語でFCMエラーになっても、他言語は処理を続け、最後にジョブを失敗扱いにします。
push失敗時はその場で停止し、自動rebaseや競合の強制解消はしません。

FCMの送信とGitの保存は単一トランザクションにできないため、「必ず1回だけ届く」保証はありません。
FCMの応答が不明なら `unknown`、送信途中で停止した場合や結果のpushが失敗した場合は
リモートに `sending` が残ります。これらは翌週も同じ言語の自動送信を保留し、ジョブを失敗扱いにします。
送信前の停止も保留に含めることで、結果不明の通知を自動再送しません。
`sent` はFCM受理または運用者による再送抑止の確定を意味し、端末到達の保証ではありません。

### 部分失敗からの復旧

1. GitHub上の台帳で対象IDを確認し、失敗した実行ログのFCMメッセージIDと照合します。
   結果保存のpush失敗時は、30日間保持する `notification-recovery-<run>-<attempt>` artifactにも
   ローカルの台帳が残ります（強制停止などでartifact保存自体が実行されない場合もあります）。
2. Actionsの `Scheduled SCP Notifications` → `Run workflow` で `recovery_delivery` に対象ID、
   `recovery_reason` に調査結果を指定します。
3. `recovery_action=sent` は再送を抑止して対象記事をキューから除きます。
   `retry` は重複する可能性を承知した明示的な再送許可です。未送信を確認できた場合に使用してください。
   復旧操作は履歴に理由・日時を記録し、通常送信と同じ排他グループ内で保存します。
   この実行自体では通知しません。許可した再送は次の現地日曜20時以降の実行で、元の対象記事に対して行います。

台帳の削除・過去コミットへの巻き戻しは再送防止記録を失うため行わないでください。
通常実行・過去ジョブの再実行とも最新のmasterをcheckoutします。
復旧時も `sending` / `unknown` 以外のレコードは変更できません。

回帰テストは `node --test test/notifications.test.js` で実行できます。
一時Gitリポジトリ・ローカルbare remote・模擬FCMで、部分成功、送信前後のpush失敗、
実行中断、新しいcheckoutからの再実行、翌週の保留、手動復旧を確認します。
実際のFirebaseやGitHubへの送信・pushは行いません。通知ワークフローでも送信前に実行します。

## 変更履歴

- 2026-09-08: 強制アップデート・メンテナンス制御用の `app-status.json` を追加。アプリが
  起動時に参照し、該当バージョン以降のアプリで強制アップデート/メンテナンス画面を出し分ける。
- 2026-08-01: 多言語対応。`languages.js` に16言語（jp/en/cn/cs/de/es/fr/int/it/ko/pl/pt/th/ua/vn/zh-tr）のクロール設定を集約し、言語別に `local-data/<lang>/` へ出力。JPは互換のため従来パスにも出力。JPのクロール対象に scp-series-10 と scp-series-jp-5 を追加。
- 2026-07-10: クロール対象をページ単位に分割したmatrix並列ワークフローで自動更新を再構築（旧ワークフローは実行時間上限のため2026-07-10に一度廃止）。旧Firestore/Firebase Functions連携は廃止済み。
