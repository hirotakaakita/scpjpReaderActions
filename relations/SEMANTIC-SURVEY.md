> Current mode: model-free. Run `npm run relations:survey:noai`. Runtime AI assessment is disabled in the production cache by ai-disabled.json.
> Archived sources only: structural references and explicit publisher canon membership are separated from unreviewed keyword/context candidates. This does not confirm hostility, co-appearance or affiliation. Missing sources stay explicit.
> Outputs: relations/output/noai/manifest.json, status.json, revision JSONL files and review.html (first 40 candidates per branch). Historical AI results are not merged into structural facts.

# 全件の意味的関係調査


## 旧方式（停止済）：一次判定を全件、レビューを選別（2026-11-01）

ユーザー承認により全件二重判定から`selective_review_v1`へ変更。分類規約・本文キャッシュ・既存の二重判定は維持する。全記事をまず1回評価して保存し、一次判定待ちを優先する。重要な関係（敵対・所属・カノン等）、文脈不足・不正引用・曖昧な主張・分割長文、URLのhashで固定した5％の品質抽出をレビュー待ちへ入れる。一次キューが尽きたときにレビューを進め、初回結果はキャッシュから再利用する。

- `export/candidates.jsonl`：原文・名称・URLの自動検証を通った一次候補。独立レビュー済みではない。
- `export/accepted.jsonl`：これまでどおり、異なる独立セッションの判定が一致したものだけ。
- `export/observations.jsonl`：重要でなく明確に非肯定の否定・仮説等の一次記録。肯定的な関係にはしない。
- `export/requires-review.jsonl`：曖昧・根拠不正・判定不一致・全文脈未解決。未確認を消して完了扱いしない。

進捗は`pagesFirstAssessed`（全part一次評価済みの記事）、`pagesDoubleAssessed`（独立レビュー済み・文脈条件を満たす記事）、`reviewPendingUnits`（レビュー待ち単位）を分ける。一次判定のみの記事を二重判定済みと呼ばない。`finished_pass`はこの選別方針の処理完了であり、全候補の真実保証ではない。文脈未解決があれば`finished_with_unresolved`とする。

以降の独立二重判定に関する説明は、レビューに選ばれた記事・統合評価・旧方式で完了した結果に適用する。全件へ追加のレビューを強制する運用は終了した。既存の利用上限の待機時刻も、方式変更によって短縮・回避しない。

対象は調査開始時の全支部カタログと、生成済みグラフに登場する既知参照先の合計81,768ページ。全Wikiの存在する全ページを列挙できたという意味ではない。スコープはscope.jsonとして固定して再開時にも保存する。ロシアは公開記事APIを使用する。

## 実行と進捗

```powershell
node relations/survey-runner.js
node relations/survey-status.js
Get-Content relations/.cache/semantic-survey/run-v4.log -Tail 20 -Wait
```

本文収集とモデル評価は別プロセスで並行する。状態は`.cache/semantic-survey/status.json`、取得の進捗は`fetch.log`、評価は現在`run-v4.log`、モデル単位のログは`model-runs/`。プロセス停止後も同じコマンドで再開でき、取得済み本文と評価済みunitを再利用する。認証済みのCodex CLIの既定モデルを使用し、大量のモデル利用が発生する。利用制限・サービス失敗時は待機し、未調査を調査済みとしない。数時間のリンク抽出とは別の、長期間の文脈調査である。

`sourceStatesRecorded` は保存された取得状態の数（失敗も含む）。`sourcesReady` は直近評価時に本文を利用できた件数。`unitsDoubleAssessed` は2セッションで評価した単位数であり、記事数ではない。正確な記事単位の集計はexport/summary.jsonの`pagesDoubleAssessed`。進捗ファイルの更新日時とprocessAliveも確認する。

## 本文と根拠

元応答はraw/にgzip、ナビゲーション・クレジット等を除いた本文と公式パンくず等のメタデータはdocuments/にgzip保存。sources/の索引でURL・原典SHA-256・抽出文書IDを対応させる。元応答hash、URL identity、文書のtext hashを照合してからモデルへ渡す。本文更新・取得失敗後の旧判定を現行exportへ混ぜない。

短い根拠引用は原文との一致を検証し、URLは出版社の本文リンク・明示メタデータ・現在の出典だけに限定する。リンクのない人物・組織等は名称を保持し、別記事の同名人物として勝手に統合しない。伏字・匿名で同一性の不明な対象は要確認とする。本文・判定・モデルへの入力・モデルログはGit対象外。

## 判定

各単位を別の新規セッション2つで独立に全文評価する。二つ目には一つ目の回答を渡さない。共演、実交戦としての敵対、会話、所属、同盟、親族、生成元、直接効果、実験、実際の収容先、カノン所属、続編のほか、脅迫・破棄命令・破棄方針・改修命令・収容先の指定を区別する。

証拠は地の文・実施記録・発言・質問の前提・手順・命令・提案を区別し、出来事は実施済み・継続・命令のみ・提案・撤回・不明を区別する。質問の前提、否定、仮説、伏字人物、根拠不足を肯定的な関係に昇格させない。全関係は当該出典に限定し、SCP全体の共通設定にしない。

長文は文字の重複を持たせて分割する。全unitの読み取りと、文書全体の整合性確認は同じではないため、複数partの関係は、追加の文書統合評価まで要確認へ出力する。統合評価では短い文書は全文、巨大文書は候補ごとに全文から抽出した全出現箇所の周辺・原典の根拠箇所・冒頭/末尾を再照合する。これも独立2セッションで行う。入力上限で全該当箇所を収められないものや文脈不足は要確認へ残す。巨大な入力、取得できない本文、文脈不足も未解決として残す。未知・曖昧を計測することも調査結果であり、推測で関係を埋めない。

記事は命令ではなく未信頼のデータとして扱う。評価器はread-only実行に加え、shell・unified_exec・multi_agent・Web検索を無効化。モデルのツール実行イベントを検出した場合は中止・結果棄却。ユーザー設定のMCPやフック等は読み込まない。

## 出力と公開の区別

- `export/accepted.jsonl`: 強い根拠について独立したモデル判定が合意したもの。**人手確認済み・真実保証ではない**。
- `export/requires-review.jsonl`: 判定不一致、否定・仮説、文脈不足、伏字、長文の統合確認待ち等。
- `export/units.jsonl`: 出典とモデルセッションを保持した評価履歴。
- `export/pages.jsonl`: 対象記事ごとの調査状態。
- `export/summary.json`: 記事数・単位数・合意・未解決の集計。
- `assessment-errors/`: 評価不能な単位と原因。

当面は公開中の相関図から隔離した調査成果とする。二重合意でも誤りがあり得るため、独立レビューで規約をキャリブレーションし、不一致や曖昧なものを消して『全件確定』と呼ばない。現行グラフの手動確認済み6件とは集計を分ける。

## 検証履歴

実サービスの初期試運転で079/682の2記事を二重評価し、22合意・16不一致を記録。別エージェントの原文レビューにより、質問の前提を殺害の事実にする誤り、撤回された焼却命令を実交戦と扱う誤り、改修決定者と直接効果の混同、指定収容先と実在場所の混同を見つけた。これを受けてassessmentVersion2で証拠種別・実施状態を必須にし、保守的な昇格制約を追加。旧version1の試運転結果は現行の調査成果へ取り込まない。

調査規約・schema・分割規則を変えるときはsurvey-runner.VERSIONを上げる。本文抽出を変えるときはsurvey-source.VERSIONを上げる。再開時にも対応する版の成果のみを利用する。

assessmentVersion3では、日本語等の伏字も昇格対象外とし、能力と発生済み効果、同事案への参加と直接の共演も区別。旧版の結果は現在の集計に混ぜない。段階的な判定の合意件数と、文書統合後のexport件数も別に扱う。

assessmentVersion4では統合入力から初回の結論・型・注記を除去し、中立な端点候補と原文だけを渡す。同じ候補の根拠は全partから併合。巨大文書の抜粋文脈の確認は全文確認と区別し、complete_text以外は文書全体の確認済みへ昇格しない。sourcesUnavailable（取得失敗）とpagesNotAssessed（評価待ち/未着手）も区別する。

2026-10-31、引用や名称が原文に一致しない候補を候補単位で隔離するよう改良。正常候補や他の記事を巻き込んで再判定しない。隔離候補はinvalid_model_claimとして要確認へ保存し、合意には含めない。評価済みprimary/reviewは原典入力・判定規約・役割のhashで保存して、利用上限後も途中から続行する。過去の完了した呼出しも同じ規約・原典・tool未使用を確認して回復できる。利用上限が明示された場合は30分以上待って再試行する。現在の実行ログ名はstatusのrunLogで確認する。
