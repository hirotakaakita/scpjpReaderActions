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

Spanish `-VO` versions and pages tagged `vo` on `lafundacionscp.wikidot.com`
are archives too. VO means "Versión Original": versions preserved after a rewrite.
The rule includes numbered SCPs, Joke/decommissioned SCPs, Tales, hubs and
supplements. A `vo` tag is sufficient on this publisher even without a `-vo` URL;
the suffix is sufficient when saved tags are absent. Neither marker is applied
to other publishers (for example, INT's Volapük translations).
Live replacements keep their existing classification. Original branches, stable
IDs, URLs, timestamps and legacy mobile-v1/v2 contracts are preserved on rebuild.

Spanish source: https://scp-wiki.wikidot.com/news-02-2025 (Project Torquemada).

On `scpfoundation.net`, `тип:архив` and `тип:-v` tags identify archives, including
when a retained catalog has only their hashed IDs. The classifier resolves those
IDs through the tag dictionary. Terminal `-V` and numbered forms such as `-V-1`
are a publisher-specific fallback, also covering archived proposals and Tales.
This decision precedes Joke classification: `SCP-500-J-V` is an archived Joke,
not a live Joke. A terminal `-D` alone is not sufficient; the RU guide explicitly
notes that some live articles retain old-style suffixes. Explicit archive tags
still classify those that really are archived.
Sources: https://scpfoundation.net/archived-scps and
https://scpfoundation.net/tag-guide .

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
series, as does PT; other configured numbered branches use 1000-number series.
Physical wiki index names do not create duplicate HOME sections.

PT's physical `series-1-pt` / `series-2-pt` indexes map to `scp-series-pt` /
`scp-series-pt-2`: Series I contains 001–099 and Series II contains 100–199.
Sources: https://scp-pt-br.wikidot.com/series-1-pt and
https://scp-pt-br.wikidot.com/series-2-pt .

Joke SCPs previously published under a `document-<language>--...` placeholder
are assigned their canonical Joke ID during official-index merging. For example,
PT's `document-pt--scp-pl-2021-j` becomes `joke-scps-pl-2021`, shared with PL and
other translations, and displays as `JOKE-SCP-PL-2021`. This intentional ID repair
does not add an old-ID compatibility layer or migrate existing user state.

The French `scp-021821135-fr` page is a separate Tale titled
`SCP-0███-FR`; it is not an alias of SCP-543-FR. The app uses the published
SCP-shaped document title when available instead of presenting URL digits as
an official article number. Stable catalog IDs and article URLs are retained.
