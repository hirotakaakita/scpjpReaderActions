# 追加SCPサイトの収集対応

`scpReader/docs/scp-branch-codes.md` の41コードを対象に、2026年11月9日にサイト・一覧・実記事を確認した。
独立サイト14か所から16閲覧言語を追加し、既存17言語と合わせて33言語を収集対象とする。
調査ボードの実装、アプリのバージョン更新、masterへの反映・配信は今回の作業に含めない。

## 追加対象

| 閲覧コード | 記事サイト | UI言語 |
|---|---|---|
| AR | https://scp-ar.wikidot.com/ | アラビア語（RTL） |
| CY | https://scp-cy.wikidot.com/ | ウェールズ語 |
| DA | https://scp-nd.wikidot.com/da:start | デンマーク語 |
| EL | https://scp-el.wikidot.com/ | ギリシャ語 |
| HU | https://scp-hu.wikidot.com/ | ハンガリー語 |
| LA | https://scp-la.wikidot.com/ | 英語 |
| NL | https://scp-nl.wikidot.com/ | オランダ語 |
| NO | https://scp-nd.wikidot.com/no:start | ノルウェー語・ブークモール（nb） |
| PIG | https://scp-pig.wikidot.com/ | 英語 |
| RO | https://scp-romanian.wikidot.com/ | ルーマニア語 |
| SGA | https://scp-sga.wikidot.com/ | 英語 |
| SH | https://scp-sh.wikidot.com/ | クロアチア語（hr） |
| SL | https://scp-slovenija.wikidot.com/ | スロベニア語 |
| SV | https://scp-nd.wikidot.com/sv:start | スウェーデン語 |
| TOK | https://scp-tok.wikidot.com/ | 英語 |
| TR | https://scpvakfi.wikidot.com/ | トルコ語 |

ラテン語・Pig Latin・SGA・トキポナはユーザーの指定により、記事を原語、UIを英語で表示する。
SHは複数の標準語を扱う共通サイト。記事は原語を維持し、UIは対応ロケールhrを使用する。
北欧の掲載言語と原作分類NDは別の情報。`da:`, `no:`, `sv:` の名前空間をURLに保持し、
カタログ上のSCP番号はEN原作なら `scp-series-173`、ND原作なら `scp-series-nd-002` として共有する。
FOは元のコード一覧に含まれないため今回の対象外。

## 独立した閲覧対象を増やさないコード

| コード | 対応 |
|---|---|
| EO・IE・IO・IR・ISV | 独立した記事サイトを確認できなかったため新しいURLを推測して登録しない。INT内の既存収集を継続 |
| ND | 北欧共通サイトをDA・NO・SVの3閲覧言語に分割。NDは原作分類として保持 |
| SK | CSとサイトを共有し、既存CS収集にスロバキア語記事を含む |
| OTHER | 未分類を示す状態でありサイトではない |
| その他の既存17コード | 現行の収集対象を維持 |

`scp-ie.wikidot.com` はアイルランド向け、`scp-sl.wikidot.com` は韓国語のゲームWikiだった。
HTTP 200やコードに似たドメイン名だけでは採用せず、支部一覧と記事内容を照合した。
ROは `scp-romanian.wikidot.com`、SLは `scp-slovenija.wikidot.com` を使う。
NLの独自一覧には404になる既存リンクがあるため、通常のオランダ語訳一覧を必須クロールにし、
独自一覧は索引収集側で継続確認する。リンク切れを理由に既存カタログを空にしない。

## GitHub Actions

- `languages.js` が追加設定を読み込み、既存の週次ワークフローのmatrixに16言語を追加する。
- 必須一覧は実際にリンクを抽出できたページに限定。追加のシリーズ、Tale、GoI、001提案ハブ等は索引収集に登録した。
- 新規180コレクションの確認記録は [additional-site-inventory.json](additional-site-inventory.json)。抽出数は一覧上のリンク数であり、全リンク先の現存を保証しない。
- [additional-site-article-check.json](additional-site-article-check.json) は16言語から各1記事を実取得した確認記録。全件クロール完了を示すものではない。
- `Validate additional SCP sites` はPR上のテストと、手動の `live_check` による公開・通知なしの実サイト検証を提供する。
- 一覧・本文の取得失敗は現行の保持・再試行に従う。公開済み記事ID、通知履歴、既存言語のURLは書き換えない。
- 通知文と時刻設定、タグ辞書の対応ロケールも追加。既存の実行・公開ロックを維持する。

## アプリとの接続と後日の反映

アプリの変更は `v1.7.1-build29` を起点とした `feature/add-scp-branches` に分離する。
閲覧言語はActionsの配信ディレクトリコードと一致させる。新しいデータがない状態での言語変更失敗は、
既存の原子的なインポート処理により現在の言語・既読・ブックマークを保持する。
活動記録のサーバー側許可コードも追加するため、アプリ配信前に同変更を反映する必要がある。
本番公開やアプリストアへのアップロードはこの作業では行わない。

## 出典

検証：Nodeテスト101件成功、索引スキーマ検証成功、ワークフローYAML解析成功。
Windows上でも北欧の名前空間付きチェックポイントを結合し、mobile-v3生成まで確認した。
アプリ側はFlutter357件成功・1件スキップ、解析指摘なし、Android STG debugビルド成功。

- [SCP International 支部一覧](https://o5command-int.wikidot.com/branch-list)（非公認プロジェクトの区分も含む）
- [Other Branches Hub](https://scp-int.wikidot.com/other-hub)
- 各サイトの現行一覧と実記事（上記JSONにURLと確認時刻を保存）
