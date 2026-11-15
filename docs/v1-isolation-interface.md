# Native V1 isolation interface

Local source changes only; no commit or deployment implied.

- V1 cron and `fb-data` always use native durable V1 publications. `GLV_MAD_V2_ENABLED` does not change V1 work, ranges, leases, receipts or readers.
- V1 calendar is Europe/Prague yesterday, including the UTC/Prague midnight gap and DST. Intentionally historical selections remain historical. V1-owned browser calendar and freshness assets avoid changing files imported by V2.
- Existing ad-name-first creator rules, seven-day corrections, retained histories, immutable bundles and exported normalizers remain. `fetchAndCache(...,{rangeOverride})` still supports explicit native-helper callers.
- `scheduledRefresh` now accepts optional `lockKey` and `stateKey`; defaults remain the V1 lease and receipt.
- Optional `names_only=1` refresh reads/writes `glv:v1:campaign-metadata:1` under its independent metadata lease. It neither refreshes V2 metadata nor gates ordinary performance refresh. Existing shared metadata is not silently adopted into this independent V1 dimension.

## Authenticated read-only operator audit

Use the existing cron bearer header. No new public authentication bypass is added.

- `/api/glv-meta-ads/cron?read_only=1`: native reader summaries for 18 preset pieces and both Promo types. This uses the actual `fb-data` consumer with an internal cache-only option, not a second adapter. Returns `datasets`, each with `preset`, `type`, `status`, actual/requested range, source timestamp, generation, coverage/staleness, creator diagnostics and SHA-256 of the served payload.
- Full replay payload must select one dataset: `read_only=1&include_payload=1&type=ads&date_preset=last_30d`. For Promo use `type=promo_formats` or `promo_concepts` with `date_preset=promo_history`. The selected entry contains `payload`; unscoped payload requests return 400 before storage reads.
- Readable stale publications return 200 with explicit stale/coverage metadata, not freshness certification. Missing publications return 503. Unauthenticated calls return 401. The audit never acquires a lease, writes Redis, refreshes names, or falls back to Graph, including cold misses and requests containing refresh flags.
- Creator diagnostics for aggregate/daily count campaign child facts; ads diagnostics count partnership-positive ads using the current ad-name-first resolver. Promo has no such creator diagnostic (`null`). Counts are not proof that a particular rename list was applied.
- Payload is private operator data; do not commit real responses. Each request reads one payload at most; unusually large individual datasets may still require a separate bounded transport strategy.

## Test ownership

V1 worker updated: `history-continuity-race`, `wl-ui-freshness`, `mad-header`, `meta-promo-creative-tab`, V1 metadata sections of `mad-full-parity-metadata`, `mad-full-parity-owner`, and `mad-full-parity-live-audit`. Shared browser harness loads date/freshness dependencies declared by each route's HTML. Parent/other workers own schedules, release packaging, shared backend and V2 backend adaptations.
