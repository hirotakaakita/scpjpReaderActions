# Production mobile-v2 delivery

The existing `SCP Crawler` workflow generates both channels after merging normal
article catalogs. Its weekly Sunday 00:00 UTC schedule, manual dispatch, publish
lock and notification queue are unchanged. No research-board code is included.

| Endpoint under `local-data` | Reader | Content |
| --- | --- | --- |
| `mobile-v1/<language>/manifest.json` | Released app | Original article catalog only |
| `mobile-v2/<language>/manifest.json` | Updated app | Original articles plus related documents in one gzip |

Both use schemaVersion 1 JSON envelopes and checksum-named gzip files. The
mobile-v1 timestamp/count match the unchanged legacy language metadata. The
mobile-v2 timestamp also reflects additional-document updates. The updated app
checks its mobile-v2 manifest for updates. Additional-only updates do not change
mobile-v1, and no guessed URLs or SCP numbers are assigned to documents.

Normal HTML and Russian API crawlers capture links and metadata while handling
existing responses. After merge, `related-documents.js` imports those captures and
processes up to 300 missing/stale pages with a 180-second loop budget, rate limits,
publisher host restrictions and a persisted retry queue. It does not recursively
expand links from additional documents. Origin follows catalog types, publisher
tags, explicit translation metadata or SCP identifiers; unknown/conflicting origins
remain unclassified. Document IDs do not depend on the inferred origin.

`local-data/related-document-cache` retains extracted metadata in gzip shards,
not full page bodies. `local-data/related-documents/catalog.json.gz` stores the
additional catalog and pending queue. Plain catalog JSON is an ignored local
intermediate. Initial metadata reuses previously captured public source records;
it is not a fresh download of every document. Unverified document translations
retain separate page IDs.

Initial production build (2026-11-06): 12,531 additional pages across 17 language
deliveries. Japanese: 14,042 original articles + 1,352 documents = 15,394 rows.
These are page counts, not guaranteed distinct works across translations.

Validation: 69 Node tests passed. All 17 generated mobile-v2 payloads were checked
against the production mobile-v1 payloads: every original row remains byte-for-byte
equivalent after decoding, followed only by document rows; gzip checksums and
sizes match their manifests. Published mobile-v1 files, legacy catalogs, metadata,
app status and notification state are not changed by this deployment.

Production v2 is ready for the app release but does not update an installed app's
hardcoded endpoint. The updated app must be released separately. This change does
not publish an Android app or send any notification.
