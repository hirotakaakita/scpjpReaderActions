# Weekly themed SCP selections

`features/schedule.json` fixes 156 shared weekly themes (2026-11-11 through 2029-10-31).
All releases are Wednesday 19:00 Asia/Tokyo (10:00 UTC), independent of device locale.
Each `features/planned/<branch>.json` contains the pre-generated language editions.
`features/<branch>/index.json` is the public app feed and contains **only actually
published** editions. The weekly publisher rechecks article availability before
adding an edition to this feed and publishing its notification queue atomically.
An edition has 5–8 locally available SCP articles. Missing editions are deliberately
absent: clients keep the most recent published selection for that language.
If no edition has ever qualified, show an empty state rather than another language.

## Content generation

`node generate-weekly-features.js` generates the initial plan and all 33 editions
from local catalogs. This is an offline preparation tool, **not a weekly job**.
Do not regenerate already published content: review changes and retain published
editions when extending or correcting the plan. `generation-report.json` records
which languages have enough articles. Languages with fewer than five suitable
articles may have no editions.

Themes are explicit tag intersections and, for some themes, object classes.
Shared article IDs allow verified tags from another translation to fill sparse
metadata without substituting another language's article. Each blurb joins the
localized theme with a short introductory sentence from that language's source
description. These are deterministic source excerpts, not invented plot claims.
Titles and excerpts retain SCP Wiki's CC BY-SA 3.0 license; every item keeps its
original URL, where the authors and attribution are available. Review editorial
copy in GitHub before changing any already published selection.

## Publication and notifications

The app loads its language edition independently of home article loading, caches
it, hides future editions, and retains old editions for offline reading. The
current feature is the latest published edition at or before the current time;
the archive lists all preceding published editions.

`features/published.json` is initialized with `node publish-weekly-features.js
--bootstrap` before activation. Bootstrap queues **zero** retrospective pushes.
The weekly workflow advances only languages whose feature ID changed, durably
publishes `local-data/feature-notification-queue.json`, and then sends to separate
`weekly_feature_<branch>` topics (`stg_weekly_feature_<branch>` in staging).
Only feature-capable clients subscribe; older clients keep receiving only their
existing new-article notifications. Follow-up runs at 19:15, 19:30 and 19:45 are idempotent.

Feature receipts use `local-data/feature-notification-deliveries.json`, separate
from new-article delivery history. Both publishers and both notification workflows
share the `scp-data-update` concurrency lock. Reservations are pushed before FCM;
uncertain outcomes stop automatic retries and require investigation using the
workflow's recovery inputs, matching the existing new-article safety mechanism.

Notification data includes `type=weekly_feature`, `feature_id`, `language` and a
durable `delivery_id`. Updated clients open that exact selection. GitHub Actions and FCM may delay actual
delivery beyond the nominal 19:00 update time.
