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
