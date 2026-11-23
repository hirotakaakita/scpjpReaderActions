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
