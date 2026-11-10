# Article classification repair

The mobile-v3 catalog separates archived articles as `contentType: archive`.
An explicit archived tag, a terminal `-ARC` URL suffix, or the `archived:`
namespace identifies an archived article. A word such as "archive" in the title
or in an ordinary URL is insufficient.

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
