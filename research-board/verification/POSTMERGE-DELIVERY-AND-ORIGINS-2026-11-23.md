# 2026-11-23 — PR #6マージ後の相関図再検証（STG）

## 対象と結論

- STG master `8a2056603872bcf836fc7107ae9889ca69f56f6a`。
- 相関図のリビジョン `b53af973497a96159bc3`、125,100記事URL / 54,929作品ノード / 157,368エッジ。
- **STGアプリが実際にアクセスする公開URLへのGET成功**。マニフェストとgzipボードはいずれも HTTP 200。取得したマニフェストはmasterと完全一致し、ボードgzipの12,079,378バイト／SHA-256 `5e3cdad685d6e7196deb8c4f8683054b2657f05a6dee17a17b3e12d6c1d6f466` も一致した。gzip展開、JSON、ノード・エッジ数も整合。
- **本番向け独立リポジトリの同パスはHTTP 404**。STGは配信成功しているが、実アプリの端末内へのダウンロード完了・本番へのリリースは別問題。

証拠：[CDN実測Actions 45186390144](https://github.com/hirotakaakita/scpjpReaderActions-stg/actions/runs/45186390144) ／ [Flutter側実装](https://github.com/hirotakaakita/scpReader/blob/master/lib/services/research_board_catalog.dart)。

## 全量原作クレジットの差分

同じ公開ソースの原作クレジット11,712件について、PR #6前後で作品IDを再分類。

| 分類 | 修正前 | 修正後 |
| --- | ---: | ---: |
| 原作と同じ作品 | 11,281 | 11,307 |
| 原作と分裂 | 133 | 107 |
| ネイティブ作品の衝突候補 | 44 | 44 |
| 原作URLがカタログ外 | 254 | 254 |
| **未解決計** | **431** | **405** |

**26件の分裂が解消**。だが修正後も明示的な原作関係には405件の要再検証が残る（確定バグの件数ではない）。独立ソースURLが示す原作の一部は退役・複数稿・旧版であり、番号だけで自動統合してはいけない。

証拠：[原作クレジット差分Actions 45186993533](https://github.com/hirotakaakita/scpjpReaderActions-stg/actions/runs/45186993533)、`PR6_IDENTITY_CHANGES.csv` と `ALL_OUTSTANDING_ORIGINAL_CLAIMS.csv`。

## 明確な追加問題：ロシア語原作 SCP-1138

- 英語 `scp-wiki.wikidot.com/scp-1138` はロシア語 `scpfoundation.net/scp-1138`（**Книга писем = Book of Letters**）を原作クレジットとして明記。
- 現行グラフでは英語版と CN/PT/VN 版がロシア語 `scpfoundation.net/scp-1138-ru`（**Прямой эфир = Live Broadcast**）の作品ID `catalog:scp-series-ru:scp-series-1138-ru` に入り、異なる原作と誤統合されている。
- 一方 `scpfoundation.net/scp-1138` は `catalog:scp-series:scp-series-1138` に属し、FR/ES/JP/PL/DE/KO版とまとまっている。
- **合計11記事のBook of Lettersと、独立したRU-1138-RU原作1記事**の関係を調べ、4記事の誤統合を再配置する修正を [Draft PR #7](https://github.com/hirotakaakita/scpjpReaderActions-stg/pull/7) で別途検証中。カタログ・実配信データの変更はまだ行っていない。

その他 EN `SCP-206`, `SCP-2195`, `SCP-1150-J` も RU原作クレジットとの作品ID分裂候補だが、転載版・同番号の独立したRU作品が存在しうるため、出版社証拠に基づく個別精査が必要。VN `SCP-179` 2URLの同一原作衝突も引き続き保留。

証拠：[SCP-1138全関連版の実記録調査Actions 45188635052](https://github.com/hirotakaakita/scpjpReaderActions-stg/actions/runs/45188635052)、`CREDITED_RU_AND_VN_WORKS.json`。このスナップショットには、URL、タイトル、原作クレジット、全文ハッシュ、所属バージョン一覧、既存カタログIDが含まれる。

## 残存リスクと扱い

- リンク抽出については以前のマージ後500記事の独立検証（旧版の `567e87a668607aa8babd`）が成功。ただしPR #6により作品ノードの所属が変化しているため、**最新配信版の全125,100記事について完全な外部リンク精度まで証明したわけではない**。
- 旧原作サイトのHTTP 403は削除と断定できない。
- 本PRは検証スクリプト・ワークフロー・記録のみ。**相関図データ、カタログ、Flutterの既読／ブックマークを変更しない**。

次に実施する作業は、SCP-1138の全量プレビュー通過、旧ID別名と参照エッジの差分確認。その後、残りのRU原作や同一サイトに2つの翻訳があるケースをそれぞれ精査する。
