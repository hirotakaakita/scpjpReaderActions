# Auxiliary link filter refresh - 2026-11-17

## Scope

Exclude identified publisher UI components from article-body references:

- More From This Author collections, identified by the collection heading or author-table signature.
- The shared multibranch database chooser (multibranch-wrapper).
- Site-7 chapter navigation (rnb-navbar) and two-link Previous Page / Next Page pagination.

Ordinary hub collections, linked narrative images and genuine references elsewhere
in the same article remain. The same destination may still be linked from a
translation or another body passage; work grouping is unchanged.

## Replay and delivery

Re-extracted all 35,016 available saved raw bodies (HTML version 11; FTML version
12) without network requests. Four previously unavailable captures remain
excluded. Verified raw checksums before parsing. Preserved source retrieval dates,
checksums, identity, titles and attribution. All 124,860 stored source records have
unchanged non-extraction metadata. Ordinary language catalogs are unchanged.

- Previous revision: 62b852305d34eb381071.
- Revision: be96f7d1e68e7a928120.
- Nodes: 57659; the same catalog aliases and work identities are retained.
- Reference edges: 189,427 -> 102,250.
- Removed reference edges: 87,177; added: 0.
- Wire edges: 102252 (client displays reference relations only).
- Gzip bytes: 9687941; decoded bytes: 66833641.
- SHA-256: f05c4be9d759dc21cc1d258853e28aa8ae4b2e7f31b9314dc2af41362dcd1200.

The manifest timestamp remains the original source capture time; the content
revision changes and triggers the normal client update.

## Validation

- All 302 Node tests passed, including 8 new regression tests.
- Link-only replay matched full makeRecord extraction on 100 actual HTML pages
  spanning 16 publisher hosts.
- Every reference proof uses the upgraded extraction version (140,430 proofs).
- Source metadata and node identity/version inventory exactly match the previous delivery.
- English SCP-3169 retains only its narrative Site-196 link (scp-7793).
- Traditional Chinese SCP-079 retains SCP-682; SCP-682 retains SCP-079/409/689.
- WARPAINT has no outgoing chapter-navigation references.
- Flutter's real catalog installer accepted the full payload and passed offline
  search, node lookup, geometry, reference and evidence queries.
- Deterministic regeneration is checked by research-board/validate.js before publication.

The new regression suite is also included in the scheduled crawler workflow.
The prior payload is retained for cached manifests.

## Publication verification

Published to STG master in commit 2b041833. The normal application manifest URL
returned this revision and the gzip matched its SHA-256 and byte length exactly.
Restarted the connected STG Android application and confirmed its active.json
switched to be96f7d1e68e7a928120 through normal catalog synchronization.
No application reinstall or user-data reset was needed.
