# Article image audit

Image cache repair applies to all published viewing languages, including indexed
Tales, GoI documents and hubs. Article IDs, article URLs, creation times, read
state and bookmark keys are preserved.

The extractor accepts uppercase extensions such as .PNG. It excludes credit
widgets, warning templates, transparent/spacer pixels, navigation assets and
unexpanded Wikidot parameters. Images in credit/navigation containers are not
article illustrations. Successful RU API source fetches also clear removed images;
failed requests preserve the cached image.

Supported raster extensions are JPG/JPEG, PNG, GIF, WebP, BMP and WBMP,
case-insensitively. Explicit img elements may also use extensionless/dynamic
HTTP(S) URLs, lazy attributes (data-src/data-original/data-lazy-src), srcset,
or picture source fallbacks. Non-network schemes and embedded credentials are
rejected. SVG/AVIF/HEIC/TIFF and CSS/canvas/iframe-rendered illustrations are
outside the current thumbnail contract.

The STG audit's missing_samples_per_language input probes a deterministic sample
of articles whose image URL is absent, up to 100 original pages per language.
This is a sample audit, not proof that every missing image in every article has
been recovered. Positive recoveries preserve article identities.

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
