# Article excerpts and voting controls

Related documents without an explicit Description section use the first part
of the article body as an excerpt. Remove Wikidot voting widgets
(`.page-rate-widget-box`) and credit/rating panels (`.creditRate`) before either
structured or fallback extraction. Extract the numerical rating separately from
the original DOM, and retain evaluations written as part of the story.

Cached metadata can be refreshed from the original pages with:

```
node tool/refresh-document-metadata.js https://scp-jp.wikidot.com/proposition-de-projet-2019-319
```

The tool accepts existing indexed article URLs only. It fetches all requested
pages successfully before updating index records and matching retained caches.
Run catalog merging and mobile generation afterward to deliver the repair.
STG's catalog rebuild exposes this as `refresh_document_urls`.

## Repair all retained excerpts

`article-excerpts.js` supplies a shared rule version for ordinary HTML crawls,
indexed documents and RU API captures. Prefer the Description section, including
unformatted paragraphs; remove voting/credit/ACS controls and report header
fields before fallback extraction. Narrative references to SCP numbers and
object classes remain part of the prose.

Normal crawler jobs also run `tool/repair-catalog-excerpts.js <language>`.
Recognizable cached voting widgets can be removed without another request.
Header-only or truncated excerpts are fetched again, with bounded retries.
Repairs contain the original excerpt and apply only while that value still
matches, so they cannot overwrite a newer observation. Source catalogs, index
records, retained document caches and legacy document catalogs are repaired
together by `tool/apply-excerpt-repairs.js`.

STG's crawler has a `repair_excerpts_only` dispatch mode: all 33 languages are
audited, every required refetch must complete, and publication checks the
entire mobile-v3 catalog for remaining voting controls or report headers.
This mode preserves the normal incremental acquisition model and does not
prepare notifications. The report is `local-data/excerpt-repair-report.json`.
