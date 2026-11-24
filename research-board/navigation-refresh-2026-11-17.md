# Navigation-filtered board delivery — 2026-11-17

Target: `hirotakaakita/scpjpReaderActions-stg`, `master`.

All 35,020 source pages supporting references in revision
`f53793aceda6ba706403` were checked again. Requests were paced per hosting site;
captures were checkpointed and failed requests retried up to three times.

- Successfully retrieved: 35,016 (30,534 HTML; 4,482 FTML).
- Unavailable (HTTP 404): 4. Their old relations are excluded.
- HTML extraction version: 8; FTML extraction version: 10.
- Every reference in the generated board has an upgraded source capture.
- The same 73,477 catalog identity aliases are retained.

The FTML filter also handles single-line centered Wikidot markup, such as
`= [[size 90%]]**<< [[[SCP-3112]]] | SCP-3113 | [[[SCP-3114]]] >>**[[/size]]`.
All retrieved FTML bodies were reprocessed from their saved raw responses after
this additional format was identified. Their retrieval timestamps and checksums
were preserved.

## Generated artifact

- Revision: `62b852305d34eb381071`.
- Work nodes: 57,659.
- Reference edges: 189,427 (189,429 total wire edges).
- Gzip size: 10,317,859 bytes; decoded size: 71,830,294 bytes.
- SHA-256: `84e4e738ba0477453a7bf936c7f20f5a6c888c55a1fe2b57a95f1d32f6031f15`.

The ordinary language catalogs are unchanged. The board's existing work grouping
policy remains in place. Catalog IDs, saved-reading IDs and bookmarks are not
rewritten by this delivery.

## Validation

- All 294 Node tests passed.
- `node research-board/validate.js` verified checksums, membership, identities,
  evidence and exact deterministic regeneration.
- Audit: no reference uses an older extraction version; catalog alias inventory
  matches the previous delivery exactly.
- SCP-3113 → SCP-3114, previously supported only by Russian chapter navigation,
  is absent from the regenerated relations. The refreshed Russian SCP-3113 has
  no outgoing article-body links.
- The actual Flutter catalog installer accepted the complete gzip and verified
  offline article search, node lookup, geometry, relations and recent evidence.

The four unavailable pages were:

- `https://scp-wiki-de.wikidot.com/scp-1393`
- `https://scp-wiki-de.wikidot.com/scp-466`
- `https://scpfoundation.net/sandbox:a-thousand-times-before-his-death`
- `https://scpfoundation.net/sandbox:ambrose-london-prix-fixe`
