# SCP document placeholder identities

An indexed article can initially have an ID such as `document-ru--scp-la-002`.
Once its URL and article classification establish that it is a numbered SCP,
both index merging and mobile-v3 generation use its shared SCP identity, for
example `scp-series-la-002`. This avoids displaying the entire published title
(`SCP-LA-002 - Фрукт`) in the app's ID field. The title itself is preserved.

This repair applies to classified SCPs across publishers, not just Russian
translations. Archive, Tale, GoI and supplement classifications take priority.
Distinct published URLs with an already occupied canonical ID keep separate
identities; a matching number alone is insufficient evidence to combine works.

Translation availability uses the repaired identity as well. Existing source
files and mobile-v1/v2 formats remain intact. No read/bookmark migration is
provided. Run the normal crawler or STG catalog rebuild to regenerate indexes
and delivery manifests; clients receive the advanced catalog timestamp.

Regression coverage: `node --test test/scp-document-identity.test.js test/catalog-indexes.test.js`.
