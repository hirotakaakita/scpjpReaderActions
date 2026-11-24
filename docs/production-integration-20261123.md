# Production feature integration — 2026-11-23

The earlier additional-language branch has a history unrelated to the current
production checkpoint. Its source changes were ported from the original
feature diff with three-way conflict resolution. Current arrival timestamps,
weekly features, notification ledgers, localized tag validation and decimal
article IDs are retained. Old generated tag dictionaries and catalog snapshots
were not replayed over current production data.

The source changes include publisher-specific Archive/Joke/Tale classification,
native series grouping, image and excerpt extraction, exact-URL metadata reuse,
and regular-crawl regression gates. English ordinary subject tags are separated
from explicit language-origin tags. Publication preserves existing article IDs
by their exact publisher URL, and advances the delivery timestamp when a repair
changes data without a newer source timestamp.

The current mobile-v3 publication was repaired directly from its prior payloads:
33 languages, 125,397 rows, with 7,983 metadata updates. Every itemId and publisher
URL is conserved. Images, titles, descriptions, ratings, creation dates and
article update dates are unchanged. Only article category, series group and
localized tag labels change. Legacy source JSON and mobile-v1/v2 remain untouched.

Planned weekly editions are reconciled with eligible source articles before
publication. Missing selections are replaced; editions lacking five eligible
articles are deferred and can recover automatically. Editorial selections are
validated before any plan writes. Published feeds and notification ledgers are
not edited by this maintenance repair.

The old experimental production checkout was preserved as a local binary patch
and source archive before returning it to the current production branch.
No app-store release, manual notification or cloud deployment is part of this
source/catalog integration.


## 2026-11-24 staging fixes promoted to production

Port the generic metadata, classification, origin evidence, article extraction,
full-text refresh and research-board generation changes from STG b9e9ec83.
Keep production notification topics, credentials references, app status, published
weekly editions, manga and legacy mobile-v1/v2 data unchanged. Reconcile weekly
plans with production articles; no plan updates are needed for this checkpoint.

Build mobile-v3 from production's own catalogs instead of copying staging
catalog snapshots. All 33 languages and 125,397 reader keys retain their exact
publisher URLs, titles, excerpts, ratings, images and existing dates. Preserve
multiple previously published keys for the same URL. Classification repairs
update 309 pageType/series values, 100 content types, 596 numeric identifiers and
257 translation-language lists. Delivery timestamps advance for changed data;
all previously committed catalog payloads remain available for cached pointers.

Seed the new board's source store with the independently captured STG publisher
evidence, then import the production catalog's additional records. Legacy index
extractors cannot replace complete source captures with empty link/credit data.
Newer body-aware metadata and terminal source failures still take effect. Verify
translation-path proofs from both publishers' actual origin tags and shared
work ownership, independently of an unclassified representative catalog entry.

The production board is generated from its own 125,388 distinct page URLs:
65,612 works, 186,345 references, revision 2ec8505bb847fb63c11b. It includes all
67 reviewed translation-work corrections and hides 45 retired page versions
(10 fully retired works in the production graph). Counts differ from staging
because the catalogs and published reader identities are different.

Validation: 423 Node tests; catalog/index validation; full source-evidence and
board rebuild validation; the actual Flutter importer, tile/search, versions,
relations and density checks against this production corpus. Reproduce the
reader-key and reviewed-repair checks with:

```sh
node tool/verify-production-promotion.js 4623e2d23cd85b6423c01631f817c94e53ea4b47
node research-board/validate.js
node --test
```

No notification delivery, manual crawl, app-store release or Firebase deployment
is triggered by this promotion.

## Production runtime delivery — 2026-11-24

The board delivery moves from schema 3 to the schema 4 consumed by the release
app. Revision `7b6cfaeac40e2b86f797` contains 65,612 works and 185,542 directed
references. Its gzip is 4,850,224 bytes, down 61.4% from 12,579,604 bytes.
The complete publisher graph is unchanged from production checkpoint `1ece532`;
803 references supported only by retired pages are omitted from mobile delivery.
The paired complete graph is retained in `local-data/research-board-audit.json.gz`.

All 33 language catalogs and 125,397 article rows are unchanged, including reader
keys and URLs. The graph retains all 67 reviewed identity repairs, 45 retired
page URLs and 10 fully retired works. No STG catalogs, app-status changes or
notification state are copied to production.

Validation: 427 Node tests passed; catalog/index validation, full board rebuild,
runtime projection and production reader-key verification passed. Flutter's
`tool/verify_research_board_test.dart` installed and explored the actual
production runtime offline successfully. Publication workflows retain the
paired audit file on future updates.
