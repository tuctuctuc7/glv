# GLV MAD refresh recovery

The existing bearer-protected `/api/glv-meta-ads/cron` remains the **only** Meta cache refresh scheduler. Its Vercel UTC schedule is `0 0,1,2,4,8,12,16,20 * * *`: midnight is the daily primary; seven later invocations are bounded recovery opportunities, not separate jobs. Current-day partial data is still excluded by default.

## Provider retries

The shared cron fetcher retries the *same request/page*, at most three attempts, with 500ms and 1000ms backoff. It recognizes Meta error code 2 (including HTTP 400/subcode 1504044), `is_transient`, HTTP 429/5xx, network TypeErrors and bounded request timeouts. Auth/permission/schema codes 10/100/102/190/200 are not retried, even if a contradictory transient flag is present. Invalid JSON is not interpreted as empty success. Redis commands are never retried by this wrapper.

All preset and history operations share an absolute wall-clock budget; response-body reads are abortable. Coordination has a 270-second deadline; provider work stops ten seconds earlier to reserve completion readback. History's existing tighter internal bound also remains. A failed page never advances pagination or publishes accumulated partial rows. Existing schema/reconciliation/partnership checks remain authoritative; Ghost residuals do not repair unavailable provider responses.

## One owner and honest completion

An atomic Redis `SET NX EX 330` lease serializes scheduled and authorized manual calls. The lease exceeds Vercel's 300-second hard invocation cap. Release uses a token-checked Lua compare/delete; crashes expire the lease instead of permanently blocking recovery. A competing call returns HTTP 202, `ok:false`, `refresh_in_progress`, not a false freshness success. Redis coordination errors fail closed with HTTP 500.

A successful completed-day run records a receipt only after all seven consumer checks pass and all 19 exact source snapshots (six aggregate/daily/ads presets plus shared Promo/Concept history) have been read back. Receipt SHA-256 digests are produced at publication, not inferred from timestamps. Later invocations read every exact key and compare digests before returning `already_verified`; they make no Meta calls. Missing/changed keys, missing/malformed receipts, or a new completed UTC day require another refresh. Partial success never creates completion. Receipt storage itself is read back. `include_today=1` and `full_history=1` share the lease but bypass the skip guard and do not establish a completed-day receipt.

Provider failure preserves the prior source payload; Promo history retains its existing persistent last-good behavior, while preset snapshots retain their existing 25-hour TTL. Failures remain explicit, and a sustained provider outage can still defeat all daily attempts; this is bounded automatic recovery, not guaranteed provider availability. The next day starts a new target automatically. Do not add a public recovery route, second scheduler, or unbounded manual retry loop.

## Verification / operations

- Run `npm test`, `npm run verify:glv-release`, and sequential `npm run qa:meta-ads` / `npm run qa:mad` browser regressions.
- Release from current main through reviewed PR and Git/Vercel integration; never direct-deploy a stale checkout.
- Verify production deployment SHA, Ready status, canonical alias, and provider project `crons.definitions` / enabled state; repository cron config alone is not active-schedule proof.
- Use the authorized installed environment loader for one completed-day request (omit `include_today`). Require `all_tabs_verified:true`, exact ranges and source `readback_verified:true`. A second request should return `already_verified` quickly, proving the production guard and exact cache readback without another heavy pull.
- Historical `last_month` correctly ends at its calendar month-end, not yesterday. November 4 acceptance is November 3 for rolling/current-month/history and October 31 for last-month/WL default.
- Record safe dates, row counts, request outcome and deployment identity. Never emit tokens, token-bearing URLs, raw environments, or large ad-ID inventories. Backend cache verification is distinct from authenticated browser verification.
