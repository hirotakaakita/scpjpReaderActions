# Russian Joke SCP classification

RuFoundation's `тип:шуточный` is authoritative Joke evidence for SCP articles.
The RU API crawler previously used the English catalog's classification when
available and otherwise defaulted to a regular series, missing foreign and
nondecimal Joke identifiers such as SCP-008-DE-J, SCP-1D6-J and SCP-3V1L-J.
The last article has the localized title SCP-3JIO-J.

A shared RU identity helper now handles the Joke tag, the `-J` token, native
branch codes, alphanumeric identifiers and compound variants. It is used by
the ordinary API crawler, official-index classification and mobile-v3 repair.
Correct existing Joke identities remain intact. Newly corrected articles use
canonical Joke IDs rather than regular-series/document placeholders. Old-ID
user-state migrations are intentionally omitted, as requested.

Cached body metadata is reused only for the exact article URL, including when
an ID is corrected. This preserves images, original creation dates and retry
behavior. Joke groups do not inherit numbered regular-series subdivisions.
Alphanumeric identifiers do not get a misleading partial numeric item ID.

Explicit archives, Tales and GoI formats keep their own category. SPC-169-J and
SPC-172-J remain SPC GoI formats. The suffix alone is not applied to arbitrary
non-SCP documents or other publishers. Existing frozen delivery channels keep
their previous contracts.

Sources: https://scpfoundation.net/scp-1d6-j ,
https://scpfoundation.net/scp-3v1l-j ,
https://scpfoundation.net/scp-008-de-j .
