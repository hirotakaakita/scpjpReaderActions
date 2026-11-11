# Article image audit

Image cache repair applies to all published viewing languages, including indexed
Tales, GoI documents and hubs. Article IDs, article URLs, creation times, read
state and bookmark keys are preserved.

The extractor accepts uppercase extensions such as .PNG. It excludes credit
widgets, warning templates, transparent/spacer pixels, navigation assets and
unexpanded Wikidot parameters. Images in credit/navigation containers are not
article illustrations. Successful RU API source fetches also clear removed images;
failed requests preserve the cached image.

`node tool/audit-image-metadata.js plan` writes a reviewable plan under
`partial-data/image-audit.json` without network fetching or published-data edits.
`audit` additionally checks unresolved candidates against original pages, using
six workers and a 500 ms minimum request interval per host.

Repairs prefer a positive image observation keyed by the exact article URL in
the saved source metadata. Old negative observations are rechecked because the
old extractor missed uppercase extensions. Known decorative assets are removed
when no verified illustration is available; the app then displays its ordinary
placeholder instead of a warning/credit graphic. A later normal article crawl
can populate a real illustration using the corrected extractor.

An attachment owned by another article or a reused number is a reason to inspect,
not proof of an error. Legitimate shared images remain unchanged when supported
by the article's own source. Failures and exhausted request budgets are reported
without clearing the existing image.

The STG-only `audit-images.yml` workflow uploads the audit report before a
separate publication job acquires the existing data-write lock. Patch application
rejects conflicting newer images, regenerates catalogs and verifies the complete
article identity set and the absence of decorative image URLs before publishing.
The workflow does not send notifications or publish production data.
