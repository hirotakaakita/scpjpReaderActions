# Research board validation — evidence-bounded status (2026-11-22)

**Scope:** `research-board` schema v3, published revision `d1169d1aedd310205196`. **Read-only** validation branch; STG, official catalogs and crawler checkpoints are unchanged. Russian API/FTML articles remain outside of sampled link-accuracy validation as requested (not removed from the published graph).

## Completed checks with reproducible evidence

| Verification | Result | Evidence |
| --- | --- | --- |
| Original independent 500-page sample (without RU) | 499 pages fetched, 451 live-workset matches, 48 mismatches; **no byte-identical historical HTML** | [Run 44535992868](https://github.com/hirotakaakita/scpjpReaderActions-stg/actions/runs/44535992868) |
| Baseline triage | 719 candidates: 517 image-only international menu links, 156 dynamic CN tool-box differences and 46 others | Original `differences.csv`, `triage.js` |
| 48 mismatched pages + 10 control pages, one live snapshot fed to both parsers | **58/58** fetched. Before verifier fixes, 30 independent-only links (28 chapter navigation, one breadcrumb and one original-source licensing note); 80 both-current-only and 84 both-published-only absent | [Run 45008914452](https://github.com/hirotakaakita/scpjpReaderActions-stg/actions/runs/45008914452), `same-snapshot/raw/*.html.gz`, CSV |
| Exact offline replay after verifier changes | **58/58** replayed with the original frozen bytes. **Zero** cross-parser work-set disagreements and **zero** mismatched pages. No network drift | [Run 45009587137](https://github.com/hirotakaakita/scpjpReaderActions-stg/actions/runs/45009587137), `frozen-replay/REPLAY.json` |
| Recursive explicit original-source graph | 11,354 unique direct credit pointers followed (depth cap 32); 10,788 work IDs agree, 240 split candidates, 78 collision candidates, 248 credited targets not in catalog; 7 multi-original ambiguous pages separately recorded | [Run 45009587137](https://github.com/hirotakaakita/scpjpReaderActions-stg/actions/runs/45009587137), `identity-provenance/` |
| Original EN numbered SCP identity scan | 9,874 EN canonical numbered pages checked; 61 unusual work-key assignments to examine; this is **not** 61 confirmed bugs | `identity/identity-anomalies.json` |
| Global coverage inventory | 124,830 checked of 124,860; 30 unresolved (27 RU sandbox API 404, two DE changed URLs, one EN) | `unresolved-pages.csv` |

## Confirmed data defect — separate from the verified parser noise

The current graph **incorrectly merges** EN `https://scp-wiki.wikidot.com/scp-179` (Sauelsuesor) into work `catalog:scp-series-es:scp-series-es-179`, with the unrelated native Spanish `https://lafundacionscp.wikidot.com/scp-es-179`. The English published source *explicitly* gives `https://lafundacionscp.wikidot.com/scp-es-026` as the Original Article (this is also in stored `credit_original_label` provenance); native `SCP-ES-026` is already cataloged as work `catalog:scp-series-es:scp-series-es-026`. The translated ZH-TR version `https://scp-zh-tr.wikidot.com/scp-179` is meanwhile attached to `catalog:scp-series:scp-series-179`, a third work. The mismatch is verified on the published board revision, not guessed from the link URL.

Likely contributing mechanisms requiring fixes in a **separate graph-generation change**:
- `translation-identities.js::scpIdentityKey()` transforms the EN delivery slug and original Spanish `scp-es-179` to compatible branch+number identities, even though the EN page is actually a translation of `scp-es-026`.
- `works.js` prefers certain catalog-ledger keys and blocks many non-number `translation_assertion` merges for SCP kinds. A safe fix must validate original-credit consistency first, disambiguate catalog IDs, and rebuild+diff the graph.
- Other candidates (EN `scp-1138` with RU origin path, EN `scp-705-fr` crediting FR `scp-655-fr`) require separate source-specific reviews before applying a rule globally.
- `identity-provenance.json` contains candidate provenance inconsistencies but many are legitimate archive variants, auxiliary pages, or suspect original-credit extraction. **Do not treat every 78/240 flag as a defect or automatically merge on credit alone.**

The repo's GitHub Issues feature is disabled (HTTP 410), so the defect is tracked here in the verification draft PR instead.

## Source-data limitation / why total historical correctness cannot be certified

For the 58 mismatched and control pages, frozen **current** HTML proves the independent validator now agrees with the actual production extractor, but **not** that published edges matched source HTML captured on November 18. The previous `research-board/source-store.js` persisted `contentSha256` and the extracted links, not the full original HTML. Checking original collect-job artifacts found JSON link records, also without the HTML. Therefore the 80+84 old-vs-current differences cannot be independently adjudicated without a trustworthy historical snapshot or other publisher revision history. Re-crawling the current site never reconstructs the original bytes.

Additional whole-corpus claims remain beyond the sample: verifying every official index member against the catalogs, manually adjudicating unresolved provenance, confirming missing/retired 30 pages, and testing generalization on a disjoint holdout sample. A zero mismatch of **two parsers on 58 sampled pages** is not proof that **124,860 pages** are complete and correct.

## Safe next actions / acceptance criteria

1. **Identity repair on separate feature branch:** add tests for EN SCP-179 → ES-026 and separation from ES-179, for translated ZH-TR `scp-179`, EN SCP-2104 → ES-004 and EN SCP-6470 → CN-2469, and for correctly same-number native SCPs. Rebuild without changing catalog reading IDs, validate proof integrity and inspect global graph diff before production publish.
2. Persist (or make reproducibly addressable) exact HTML/FTML raw sources with URL, retrieval time, response hash and extractor version for audited pages. Retain immutable snapshots for subsequent independent historical comparison.
3. Manually review `identity-provenance/` (especially foreign-native collisions) with issuer-author claims and exclude generic license/author/link footers that are not genuine original assertions.
4. Validate the remaining 30 catalog URLs: RU API `sandbox:` pages are not normal member pages, DE URLs moved, and one EN evidence bundle has a 404 at last capture.
5. Only after fixing confirmed defects: run **new disjoint 500-page non-RU holdout** and separate complete catalog-index reconciliation. Require explicit outcomes for all discrepancies or label the source-limited ones “unverifiable”; do not hide them in accuracy metrics.

This document is an audit ledger, **not a claim that all graph edges are correct**.
