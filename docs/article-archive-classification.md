# Article classification repair

The mobile-v3 catalog separates archived articles as `contentType: archive`.
An explicit archived tag, a terminal `-ARC` URL suffix, or the `archived:`
namespace identifies an archived article. A word such as "archive" in the title
or in an ordinary URL is insufficient.

French `archivé` tags (including localized tag labels and decomposed Unicode)
also identify archives. On `fondationscp.wikidot.com`, numbered SCP URLs ending
in `-T`, including `scp-007-it-t`, identify retired translations even if their
saved tags are missing. This suffix rule is restricted to the French publisher;
it does not interpret `-T` on other Wikis as an archive or a country code.
The same shared classification runs during index merging and mobile-v3 delivery
generation, so rebuilding saved data repairs existing entries as well as future
crawls. IDs, URLs and the original branch (such as IT) remain unchanged.

French source example: https://fondationscp.wikidot.com/scp-039-t explicitly
marks the translation as outdated and no longer official, links its replacement,
and carries the `archivé` tag.

Article type is checked before assigning an SCP-shaped URL to a numbered series.
For example, SCP-2 is a Tale, distinct from SCP-002. SCP-002-KZ belongs to the
Kazakh original branch; KZ is origin metadata, not a newly enabled viewing language
or crawler destination. SCP-001 entry hubs remain within their numbered series.

Published item IDs, URLs, creation times and per-article timestamps remain stable.
Existing bookmarks and read state therefore retain their keys. Regeneration uses
saved catalog/index evidence and does not require a complete source crawl.
The mobile-v1 and frozen mobile-v2 delivery contracts remain unchanged.

Sources:
- https://scp-wiki.wikidot.com/scp-2
- https://scp-jp.wikidot.com/scp-002-kz
- https://scp-jp.wikidot.com/arukikata-kai

The app exposes Archive in HOME, search category filters and reading records in
all 28 UI locales. Archived works remain grouped by original branch.

Native list aliases such as `serie-scp-es`, `liste-fr`, `scp-it-serie-i`,
`lista-pl` and explicit first-page names (`scp-series-ko-1`) are normalized
with additional indexed articles to a single series key. ES uses 100-number
series; other configured numbered branches use 1000-number series.
Physical wiki index names do not create duplicate HOME sections.

The French `scp-021821135-fr` page is a separate Tale titled
`SCP-0███-FR`; it is not an alias of SCP-543-FR. The app uses the published
SCP-shaped document title when available instead of presenting URL digits as
an official article number. Stable catalog IDs and article URLs are retained.
