# Remaining origin classification audit (2026-11-09)

Starting point: published STG commit `9745fa7`, board revision
`b3f79ece4f3f9e89aa29`, 463 unclassified nodes.

The follow-up reclassification resolves 45 existing pages/nodes, leaving 418.
All 123,777 delivered catalog pages retain their URLs and item IDs.
Generated board revision: `f8e460b440b6946354b4`.

## Rules and primary evidence

- [ULI posting instructions](https://scp-int.wikidot.com/unofficial:language-incubator-hub):
  the namespace and matching language tag describe the delivery language, while
  translated articles preserve the original unix-name. Exclude only the tag
  matching that namespace, only on INT pages tagged `language-incubator`.
  Other origin tags and genuine multiple-origin conflicts remain intact.
- Extend exact native-catalog matching to tales, proposals, incident reports and
  documents. Require a source URL on its native publisher whose catalog origin
  agrees with that publisher. A translated catalog entry, missing source, or
  several disagreeing native sources cannot establish one original branch.
- [Official Other Branches Hub](https://scp-int.wikidot.com/other-hub) explicitly
  lists Iranic (IR), Nordic (ND), Pig Latin (PIG), Serbo-Croatian (SH), and
  Standard Galactic Alphabet (SGA). Add these origin codes and the `iranic` tag
  alias. This extends origin metadata without adding new crawl targets.

New classification bases: 27 publisher-origin tags (including corrected ULI
delivery tags), 18 exact native source catalog matches.

Examples: `unofficial:isv:scp-005` -> EN,
`unofficial:ca:dr-clef-s-proposal` -> EN,
`doctor-janns-proposal` -> PIG, `meat-and-vapor` -> SH.

## Remaining 418

| Reason | Nodes |
|---|---:|
| Insufficient original-branch evidence | 373 |
| Conflicting original-branch tags | 28 |
| Unresolved source behind interwiki metadata | 14 |
| Unresolved explicit original credit | 2 |
| Unsupported source behind interwiki metadata | 1 |

These figures describe the current evidence; they do not prove the 418 pages
cannot ever be classified. More source attribution or an explicit policy for
international coauthored works is required to resolve further cases safely.

Validation: 191 Node tests pass, catalog-index validation passes, publication
utility asserts unchanged delivered membership and item IDs in all languages.
The board validator also rebuilds the artifact against the committed inputs.
