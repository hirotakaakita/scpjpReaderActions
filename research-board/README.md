# Official-catalog research board (STG)

The only article membership input is the currently published `mobile-v3/<language>/manifest.json` and its hash-verified catalog. A body hyperlink never discovers an additional node. Pages outside the fetched catalogs, including synthetic organizations, are excluded.

Run `node mobile-catalog.js` in the existing weekly crawler workflow. The command generates mobile-v1/v2/v3 as before, then the shared `mobile-v3/research-board/manifest.json` and immutable gzip payload. No new schedule, AI request, Firestore read, or independent crawl is introduced. New body requests made by the existing crawler optionally capture source-specific assertions and explicit translation metadata for the next build.

## Scope and identity

- Article existence, title, category and original branch come from the official-index catalog, not the hosting language of a translation.
- The ledger identity `pageType + itemId` merges the normal SCP translations. An exact shared page URL or an explicit publisher translation assertion can establish additional aliases. Unrelated branch originals, proposals and variants remain distinct.
- All accepted identities of a merged work are retained in schema 3. Classification-rejected IDs cannot leak into aliases. Aliases cannot belong to multiple nodes.
- Catalog rows, IDs, bookmarks and reading history are never rewritten by the board generator.
- SCP, record/log, hub, Tale, GoI format and setting categories occupy separate districts. Invalid origin codes stay unclassified rather than creating invalid branches.

## Relationships

**Body hyperlinks connect existing catalog members only.** Version 6 extraction removes navigation, credits, interwiki/translation metadata, missing-page links and fragment-only links. Explicit HTML and FTML links become directed `references` edges. Reciprocal links yield two directions. Links never discover nodes or trigger target fetches; references to an uncollected page and links within a consolidated translation work are omitted. Repeated references between the same works share an edge, retaining their source evidence. Translation identity is separate and is not drawn as an edge.

Only source-specific, previously reviewed semantic assertions with exact quotes, or approved explicit canon breadcrumbs, create semantic edges. Latest failed/deleted observations suppress older assertions and references. Metadata with a changed content hash cannot preserve old claims without revalidation. Merely having a link, a similar identifier, a shared generic tag or nearby layout positions is not evidence of a story relationship.

Older cached link lists have uncertain navigation filtering and are not promoted to version 6. `node research-board/refresh-links.js <language>` backfills only already-published catalog member URLs, writes resumable per-page checkpoints, and never follows extracted targets. The existing weekly language jobs run this with a 600-request / 5-minute budget per hosting site after the usual crawl. Fresh ordinary captures also supply version 6 immediately. Untested pages come first, then snapshots older than 28 days; failures back off for one day. The shared overview reports `bodyLinkCoverage.checkedPages`, `totalPages` and `referenceEdges`, so a partial backfill is never presented as exhaustive. FTML includes, code, HTML blocks and comments are not expanded.

The published manifest is authoritative for work/edge counts and payload sizes. `references` edges describe navigation in the article body, separately from the source-specific semantic assertions. This is not an exhaustive semantic review of all articles. Isolated works remain visible.

## Rendering and update contract

For a bounded manual catch-up, dispatch `research-board-backfill.yml` on STG
master. It reuses `refresh-links.js` against the currently published catalogs,
checking at most 500 pages per site by default (17 sites, 8,500 attempts maximum).
Four sites run in parallel; the ordinary `scp-crawl` lock prevents overlap with
the weekly crawler. Per-page metadata checkpoints are uploaded as compressed
artifacts, and the short `scp-data-update` writer lock is acquired only after
collection. Publication checks out current master, merges the captures, validates
the graph and pushes only board/source data. It never collects new catalog
members, changes mobile-v1/v2/v3 article catalogs or sends notifications. Logs
show progress every 25 attempts and the publish summary lists totals per site.
Artifacts remain available for seven days if collection or publication fails.

The Flutter app installs the shared gzip during startup into immutable local shards in an isolate. Only visible geometry and selected relations/evidence enter bounded caches. Search uses a compact branch index rather than repeatedly decoding all node versions. The same graph revision is reused across content languages. Failed updates keep the last valid version; open routes pin their version. Corrupt local shards mark the snapshot for reinstallation, even when the remote revision is unchanged.

`node research-board/validate.js` validates checksums, exact catalog membership, work/alias uniqueness, allowed link types, versioned body evidence, classifications and deterministic regeneration from saved inputs. Existing STG validation and weekly publication both run it. Production Actions are unchanged and the production app does not enable or download the board by default.

## HOME category parity (2026-11-08)

Article types now exactly follow HOME's `ArticleClassification.category`: SCP, SCP-EX, JOKE-SCP, Tale, GoI, record, setting, hub and other. Source tags and URL patterns cannot override the catalog category. Work consolidation runs first; the representative catalog row determines the final category. Districts and the Flutter legend follow HOME's category order. Flutter reuses HOME's localized labels for all supported locales.

The stable numeric wire IDs remain separate from that display order, with EX=8 and JOKE=9 added. Existing STG clients reject those unsupported IDs and preserve their prior snapshot; install the updated STG APK. Shared contract fixtures cover the Dart/JavaScript mapping, and validation checks all 75,285 published work categories against the underlying catalog rows.
