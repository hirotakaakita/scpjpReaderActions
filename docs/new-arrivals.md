# 追加収集SCPの新着処理

`mobile-v3` は従来カタログと公式索引などの追加収集分を統合する。
新着画面は `createdAt` のない記事を除外するため、配信時に全記事へ日時を付与する。

- 前回配信の有効な `createdAt` を維持する。
- 初回は収集データの `createdAt`、なければ `lastUpdated` を使う。
- 日付のない既存記事は前回配信の `lastUpdated` で補完する。これは収集日時の代用であり、Wiki上の公開日ではない。
- 日付補完だけの場合も配信の `timestamp` を進め、アプリが再取り込みできるようにする。再生成時はその下限を維持する。
- 既存配信のハッシュ不一致や破損はエラーにし、日時や通知差分を空の履歴から作り直さない。

通知準備は `HEAD` と現在の従来カタログに加え、同じ言語の `mobile-v3` のSCPを比較する。
追加収集したSCPも、配信データに初めて追加された時点で既存の週次通知キューへ入る。
追加収集のログ・Taleはこの通知拡張の対象外。従来記事の通知範囲は維持する。
通知待ち記事と `lastSentWindow` は引き継ぐ。既に配信された過去の追加収集SCPは一括再通知しない。

再生成と通知準備は、最新のmasterを取得した公開ロック内で、コミット前にこの順番で行う。

```sh
node mobile-catalog.js
node prepare-notification-queue.js
```

今回の既存データ補完では `mobile-v3` の記事IDと日付以外の本文メタデータを維持し、
`mobile-v1` / `mobile-v2` および通知キュー・送信履歴を変更しない。

検証:

```sh
node --test test/catalog-arrivals.test.js test/mobile-catalog.test.js test/notifications.test.js test/workflow-concurrency.test.js
```
