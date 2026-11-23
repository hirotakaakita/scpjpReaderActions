# Retained tag display labels

Some retained primary catalogs store canonical tag IDs as strings without display
labels. Non-ASCII source tags use stable IDs such as
`tag-7f558808845f404857963c5b` (original tag: `人造物品`). These are internal keys,
not corrupted text. Copying those strings into mobile-v3 exposed the keys in the UI.

Mobile-v3 generation now resolves string tag labels from the shared dictionary:
the publisher's language when translated, otherwise the original tag alias.
Explicit embedded or separately stored labels are retained. Article IDs, tag IDs,
URLs and per-article timestamps are unchanged. No guessed translations or
cross-language tag merges are introduced. Source catalogs and mobile-v1/v2 keep
their existing contracts.

The correction runs on every ordinary crawl, rebuild and image repair that
generates mobile catalogs; existing caches do not need a full article recrawl.
Regression coverage checks the reported Chinese tag, mixed tag formats, legacy
channel isolation, stable reader identity and repeated catalog generation.
