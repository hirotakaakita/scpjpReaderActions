# Weekly feature catalog

- 104 shared weekly themes, 2026-11-11 through 2028-11-01, every Wednesday at 19:00 Asia/Tokyo.
- `schedule.json` fixes the common theme and publication date for every language. Regeneration preserves this reviewed order and limits the horizon to 104 weeks.
- `planned/<language>.json` stores that language's eligible editions. Every edition contains 5–10 real translated SCP articles. A theme without five available articles is omitted for that language; the publisher keeps the preceding edition.
- `<language>/index.json` contains released editions in `features`. Explicitly approved previews are separate in `previewFeatures`; the two-year plan is not all exposed as previews.
- Release feeds have no test previews. Home displays the latest released editions (currently one), and all 104 planned editions retain their original Wednesday publication dates. Released editions also use their shared thematic cover.
- `editorial/jp/weekly-001.json` through `weekly-003.json` preserve the reviewed prototypes. Their introductions omit the former article-count closing phrase. Editing public copy with `apply-feature-editorial.js` does not alter release or notification state.
- `theme-editorial-ja.json` contains individual Japanese titles and introductions for weeks 4–104. Other languages use localized theme labels and introductions, and article descriptions from their own translated source catalogs. The common theme, release date, and cover are shared.
- `generate-weekly-features.js` prioritizes article images, removes known blank/header images, avoids repeated selections when the candidate pool permits, and selects source sentences related to the theme. Generated article descriptions are source-derived extracts, not individually reviewed rewrites. The first three Japanese prototypes retain their reviewed short hooks.
- `images/` contains 104 distinct AI-generated thematic cover illustrations. The first three are the approved prototypes; the other 101 were generated separately with built-in `image_gen`. They illustrate the theme, not a named SCP's evidence photo. No OpenAI API key or fallback CLI was used.
- `cover-prompts.json` records the 101 new prompts, reused prototype paths, and final image metadata. A cover is shared only between language editions of the same week, never between different weeks.
- Source article credits and CC BY-SA license references remain in the catalogs and linked source articles.

## Publication

The existing Wednesday publication workflow selects only the latest eligible planned edition. It verifies source availability again, publishes it, and queues a feature notification only when the released ID changes. Generation and copy edits do not send notifications. Preview metadata never changes the publication date or bypasses notification rules.

## Rebuild and verify

```powershell
node generate-weekly-features.js
node --test test/weekly-features.test.js test/notifications.test.js test/notification-branches.test.js test/workflow-concurrency.test.js
```

The generation report gives actual language edition and distinct article counts. Languages with fewer eligible themes intentionally have fewer than 104 editions.
