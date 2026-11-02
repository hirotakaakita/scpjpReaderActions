# Automated mobile research board

The weekly crawler and manual relation refresh both generate the graph, validate it, export mobile v1 assets, and upload a run-scoped artifact. A separate publisher enters the catalog write lock, checks out current master, creates an immutable `research-board-v1-<revision>` release and commits only `research-board/latest.json` after every asset upload succeeds.

The release contains the mobile archive (stored ZIP of already-gzipped files) and source observations. The latter is a durable fallback when Actions source artifacts expire. The client downloads only the mobile archive, checks its size and SHA-256, validates every file and schema, then switches the persistent active pointer. Open views remain pinned to their old revision.

No API keys or new account are required. Publisher jobs use repository `GITHUB_TOKEN` with `contents: write`. STG remains manual-only and uses its own repository/releases. Never publish STG data into production.

Local validation: `node relations/mobile/export_research_board.cjs`; `node --test test/mobile-assets.test.js`; `python3 -m unittest discover -s test -p test_mobile_package.py`. Package: `python3 relations/mobile/package.py --input relations/mobile-output --records relations/.cache/records --output relations/release --repo hirotakaakita/scpjpReaderActions` (use the STG repository for staging).

Publishing is conditional on all generation/validation steps succeeding. The previous pointer remains on any earlier failure; a commit race fails the final push instead of overwriting another catalog or notification update. Re-running an existing immutable release reuses and verifies its assets.

Mobile schema is a compatibility contract. Breaking field/geometry changes require a new schema/channel and client update, not replacing the v1 pointer with incompatible data. Keyword/AI candidates remain excluded from asserted story relationships.
