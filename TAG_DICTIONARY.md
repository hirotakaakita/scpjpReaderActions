# Tag dictionary generation

`tag-dictionary.json` is a build input maintained in this repository. The app
does not download it. Each catalog embeds `tags: [{"id": "humanoid", "label":
"人間型"}]`; IDs are used for search/recommendations and labels for display.

Workflow order:

1. Validate the checked-in dictionary before crawling.
2. Crawl pages, excluding underscore-prefixed management tags, language codes,
   and the generic `scp` tag. Cached object tags are accepted too.
3. Run `node prepare-tag-dictionary.js`: discover tags from partial data and
   retained catalogs, register stable IDs and write `tag-translations-pending.json`.
4. Run `node merge-data.js`: merge successful languages, then embed labels using
   the dictionary in all catalogs, including retained languages and the JP mirror.
5. Commit the catalogs, dictionary and translation backlog together.

The seed dictionary contains the app's existing 16 tag translations in 15 UI
languages. Add verified synonyms to `aliases` and translations to `labels`, keyed
by UI locale (`ja`, `en`, `zh`, `zh-Hant`, etc.). IDs must not change after use.
Duplicate aliases across IDs fail validation rather than silently merging topics.
Do not infer equivalence merely because two tags occur on the same article.

Unknown tags are retained and listed in the backlog. Until translated, their label
is their original tag name. This is explicitly a fallback, not a translation.
Discovery never overwrites existing translations. No translation service is invoked
by default, and no API credentials are embedded in the app.

Local checks: `node --test test/public-tags.test.js test/tag-dictionary.test.js`.
Local generation: run `node prepare-tag-dictionary.js` before `node merge-data.js`.
