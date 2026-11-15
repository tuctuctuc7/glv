# GLV MAD refresh recovery

## Refresh scopes and schedule (2026-11-13)

Policy (Tom): TUC/CZSK is the core business and must arrive for **both** dashboards on the Prague cutoff before 08:00 GMT+7, with no dependency on Los Angeles or V2 work. TGLV may be partial for its last day until LA midnight.

- **Reporting cutoff** = TUC's completed Prague day (`commonCutoff` in `public/glv-meta-ads-v2/dates.js`, used by V1, V2, cron and browser). TGLV's last day is partial until LA midnight (`refreshPhase`: `tglv-partial` → `final`).
- **Scopes** (thin routes over `api/glv-meta-ads/cron.js`, each with its own completion receipt `glv:refresh:complete:v1:scope:<scope>`):
  - `cron-tuc`: V1/TUC presets + Promo history only. Never touches V2/TGLV.
  - `cron-v2`: V2 native (TUC complete + TGLV so far) + shared publication, reusing the published V1 facts.
  - `cron-tglv`: TGLV-only completion. Skips until 01:00 Los Angeles; retains same-cutoff TUC facts verbatim (never re-pulls TUC), drops TGLV's 7-day ad chunk window once and re-pulls it, republishes shared. Never advances the cutoff.
  - `/api/glv-meta-ads/cron` (no scope) = legacy combined run, manual only.
- **Schedule (UTC)** — source of truth `tests/helpers/mad-cron-schedule.cjs`: TUC `0,20,40 0` (07:00–07:40 GMT+7) + `0 3,6,12,18,21`; V2 `10,30,50 0,1` (07:10–08:50 GMT+7) + `10 3,6,12,18,21`; TGLV `0,15,30,45 8,9` (first eligible 09:00 UTC = 16:00 GMT+7 in PST, 08:00 UTC = 15:00 GMT+7 in PDT) + `0 11,14`. No runs 22:00–23:59 UTC (Prague/UTC dates differ then).
- **V1 independence:** the V1 reader serves V1's own verified publication whenever it is newer than the shared V1+V2 bundle (`v1_ahead_of_shared`), so V1 never waits on V2.
- **Notes:** V2 responses carry `account_coverage`. With TGLV partial, `warning` states the LA pull time and the GMT+7 completion time; after completion, `refresh_note` "Both accounts have full data through <date>." is appended to the V2 header refresh info.

## Legacy single schedule (superseded)

The existing bearer-protected `/api/glv-meta-ads/cron` remains the **only** Meta cache refresh scheduler. Its Vercel UTC schedule is `0 0,1,2,4,8,12,16,20 * * *`: midnight is the daily primary; seven later invocations are bounded recovery opportunities, not separate jobs. Current-day partial data is still excluded by default.

## Provider retries

The shared cron fetcher retries the *same request/page*, at most three attempts, with 500ms and 1000ms backoff. It recognizes Meta error code 2 (including HTTP 400/subcode 1504044), `is_transient`, HTTP 429/5xx, network TypeErrors and bounded request timeouts. Auth/permission/schema codes 10/100/102/190/200 are not retried, even if a contradictory transient flag is present. Invalid JSON is not interpreted as empty success. Redis commands are never retried by this wrapper.

All preset and history operations share an absolute wall-clock budget; response-body reads are abortable. Coordination has a 270-second deadline; provider work stops ten seconds earlier to reserve completion readback. History's existing tighter internal bound also remains. A failed page never advances pagination or publishes accumulated partial rows. Existing schema/reconciliation/partnership checks remain authoritative; Ghost residuals do not repair unavailable provider responses.

## One owner and honest completion

An atomic Redis `SET NX EX 330` lease serializes scheduled and authorized manual calls. The lease exceeds Vercel's 300-second hard invocation cap. Release uses a token-checked Lua compare/delete; crashes expire the lease instead of permanently blocking recovery. A competing call returns HTTP 202, `ok:false`, `refresh_in_progress`, not a false freshness success. Redis coordination errors fail closed with HTTP 500.

A successful completed-day run records a receipt only after all seven consumer checks pass and all 19 exact source snapshots (six aggregate/daily/ads presets plus shared Promo/Concept history) have been read back. Receipt SHA-256 digests are produced at publication, not inferred from timestamps. Later invocations read every exact key and compare digests before returning `already_verified`; they make no Meta calls. Missing/changed keys, missing/malformed receipts, or a new completed UTC day require another refresh. Partial success never creates completion. Receipt storage itself is read back. `include_today=1` and `full_history=1` share the lease but bypass the skip guard and do not establish a completed-day receipt.

Provider failure preserves the prior source payload; Promo history retains its existing persistent last-good behavior, while preset snapshots retain their existing 25-hour TTL. Failures remain explicit, and a sustained provider outage can still defeat all daily attempts; this is bounded automatic recovery, not guaranteed provider availability. The next day starts a new target automatically. Do not add a public recovery route, second scheduler, or unbounded manual retry loop.

## Shared publication source checkpoint

Shared V1/V2 publication runs after every source refresh inside the same invocation budget. On 2026-11-12 the 00:00, 01:00 and 04:00 UTC runs verified every source and then failed publication with `Cron refresh/request time budget exceeded`; each retry re-extracted all sources and timed out again, leaving both dashboards on the prior cutoff.

After a clean, non-forced source pass the owner now writes `glv:mad:shared:1:sources` (no expiry) with the exact target (`<V1 cutoff>:v2:<common cutoff>`), shared correction ID, every source key's SHA-256, and stripped summaries. A later normal invocation reuses it only when target and correction match, every listed key is byte-identical, and current-clock tab freshness (ranges, 25-hour extraction age, V2 verification) still passes; it then skips extraction and spends its full budget on publication. Any mismatch falls back to normal extraction. `include_today` and `full_history` runs never read it; forced runs never write it. Responses report `freshness.resumed_from_source_checkpoint`. Regression: `node --test tests/mad-shared-source-checkpoint.test.cjs`.

## Verification / operations

- Run `npm test`, `npm run verify:glv-release`, and sequential `npm run qa:meta-ads` / `npm run qa:mad` browser regressions.
- Release from current main through reviewed PR and Git/Vercel integration; never direct-deploy a stale checkout.
- Verify production deployment SHA, Ready status, canonical alias, and provider project `crons.definitions` / enabled state; repository cron config alone is not active-schedule proof.
- Use the authorized installed environment loader for one completed-day request (omit `include_today`). Require `all_tabs_verified:true`, exact ranges and source `readback_verified:true`. A second request should return `already_verified` quickly, proving the production guard and exact cache readback without another heavy pull.
- Historical `last_month` correctly ends at its calendar month-end, not yesterday. November 4 acceptance is November 3 for rolling/current-month/history and October 31 for last-month/WL default.
- Record safe dates, row counts, request outcome and deployment identity. Never emit tokens, token-bearing URLs, raw environments, or large ad-ID inventories. Backend cache verification is distinct from authenticated browser verification.
