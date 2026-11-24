# Research board independent verification

This directory contains an **independent, read-only audit** of the existing research-board data. No publishing, STG writes, catalog changes or crawler checkpoint mutations occur.

Russian-hosted (`ru`) pages participate in sampling by default. Independent FTML navigation filtering is covered by unit tests and a 50-page live/same-response/frozen-replay check. Use `--exclude-ru` only for an explicitly scoped HTML-only diagnostic.

## Verification contract

- A directed reference `A -> B` exists when an eligible hyperlink occurs in the article body of a catalog member belonging to work A, and the destination belongs to a **different** catalog work B.
- Evidence from translated pages counts toward the shared source/target work. Do not equate a translated article with a separate SCP.
- Exclude author credits, licenses, global navigation, translation metadata, missing-page links, fragments, self-work links and unsafe URLs.
- Record links into uncollected/non-catalog pages as **outside_catalog**, separate from false negatives.
- Explicit source-specific semantic relations (experiments, canon associations, etc.) are **not** `references` edges and are not evaluated by this audit.
- Dynamic scripts, includes, modules, iframe content and interactive DOM may be absent from static HTML or FTML. The script reports these limitations; do not claim a comprehensive semantic audit.

## How it works

1. **Coverage inventory.** Recompute coverage from the committed catalogs and source shards, then export URL, branch, unresolved reason, and retry-after to `unresolved-pages.csv`. Board publication also refreshes `local-data/research-board-body-link-coverage.json.gz`; the independent audit does not trust an older saved inventory.
2. **Sampling.** Read the published manifest, hash-verify the board, construct original-page-to-work mapping, and extract per-page expected `references` from proof URLs. Choose up to 500 pages with a fixed seed: 250 representative, 50 zero outgoing links, 50 high-degree, 50 translations, 50 unusual formats and 50 identity-risk cases. A stratum with too few candidates is topped up from other pages. Representative sampling guarantees at least one per supported language.
3. **Independent capture.** Fetch page HTML/FTML with explicit host restrictions, manual redirect checks and >=1-second request spacing. HTML uses its own DOM walk; FTML uses an independent token scanner, including chapter-navigation filtering. Russia uses the `scpfoundation.net/api/articles/{slug}` JSON endpoint and parses its `source` FTML field. Link parsing **does not call** `research-board/extract.js` or its link methods; the inventory separately reads committed catalog/source data.
4. **Comparison.** Map observed target URLs to work IDs and compare the directed edges with published `references`. Record extra published edges (FP), missing published edges (FN), source element/selector/quote and ignored destinations.
5. **Freshness guard.** Compare response SHA-256 with the stored source snapshot. Only byte-identical pages are scored in **strict** precision/recall. Independently report **live agreement** on all fetched pages, but do not interpret these results as historical truth when hashes differ. Global page chrome alone can change HTML bytes. Changed content, missing snapshots, network failures and unsupported dynamic markup are reported separately.
6. **Review / holdout.** Investigate differences, fix the crawler only after separate review, then rerun with a different seed and `--exclude` from the initial `audit.json`.

## Commands

From repository root (Node 24 / `npm ci`):

```sh
node --test research-board/verification/verification.test.js
node research-board/verification/audit.js --inventory --out research-board/verification/audit-results
node research-board/verification/audit.js --limit 25 --seed smoke-2026-11-19 --out research-board/verification/audit-results
node research-board/verification/audit.js --limit 500 --seed 2026-11-19-initial --out research-board/verification/audit-results
# --include-ru remains accepted for compatibility; RU is included by default.
node research-board/verification/audit.js --limit 50 --include-ru --seed ftml-review --out research-board/verification/ru-review-results
node research-board/verification/audit.js --limit 500 --seed holdout-2026-11-19 --exclude research-board/verification/audit-results/audit.json --out research-board/verification/holdout-results
```

A separate, read-only Actions workflow, `.github/workflows/research-board-verification.yml`, runs tests and inventory against the checked-out revision. Branch pushes audit six targeted pages, including RU; manual dispatch audits the requested sample. Both write a fresh baseline to `audit-results/current/`, triage it, then pass that same baseline to `same-snapshot.js` for all disagreement pages and up to ten controls. The board and baseline therefore always share a revision, including after merging newer master data. Raw same-response HTML/FTML and API metadata are preserved in the output artifact.

Reports are stored as short-lived **workflow artifacts**, not committed back to the repository. No previous run or artifact is required to execute a new audit. Download any reports/raw snapshots needed for long-term evidence before their retention period ends.

### Historical replay (separate, optional)

`replay.js` remains available for previously downloaded frozen snapshots. Historical evidence must be paired with its original board revision; do not feed an old baseline to a current-board audit. The November 2026 reports in this directory describe revision `d1169d1aedd310205196`, not the latest board.

For the original 58-page replay, create a separate worktree at commit `c4dd6daac618a7483774f1e1d8d7c4e86630a1ff` (which contains that board and verifier), run `npm ci` there, and run:

```sh
node research-board/verification/replay.js /absolute/path/to/downloaded-artifact/same-snapshot /absolute/path/to/replay-output
```

The original artifacts expire on December 3 (500-page baseline) and December 6 (58 raw snapshots), 2026. After expiry, historical replay requires an independently retained download; the workflow cannot recover expired evidence. These historical artifacts are not dependencies of current audits.

## Outputs

- `inventory.json`: total, checked, pending and unresolved reasons (not necessarily just the originally failed 30 pages).
- `unresolved-pages.csv`: source URLs still unresolved in the current published snapshot.
- `audit.json`: revision, deterministic sample, page-level status and aggregate metrics.
- `differences.csv`: links and evidence for inspection; original HTML snippets are truncated to 450 characters.
- `SUMMARY.md`: concise statistics and methodological limitations.
- `partial-progress.json`: checkpoint-style progress in the current run; not a resume mechanism.

Only **byte-identical** source pages contribute to strict precision and recall. Live agreement is reported separately and may reflect content changes or shared parser blind spots. Both are sample diagnostics, not whole-population guarantees. Mixed language sampling is useful for finding bugs, not estimating corpus-wide rates without reweighting.

## Known limits and next stage

- This verifier checks the **published corpus**, not whether every official SCP index has been completely discovered. A future branch-by-branch official-index inventory is required for catalog recall.
- Source content hashes are byte-sensitive: innocuous page chrome changes can cause `content_changed` exclusions.
- Special chapter navigation and auxiliary-content cases may require human review. Sampled disagreements are candidates, not automatically crawler bugs.
- Russian content arrives through the RuFoundation JSON API. Same-response artifacts preserve both the exact source FTML and API metadata needed by the production parser; replay uses those bytes without requesting the site again.
- FTML transclusions and interactive scripts are not expanded. Track limitations rather than assuming zero missed links.
- Once discrepancies are reviewed, publish repaired extraction logic separately. Do not automatically modify production or STG from this verifier.
