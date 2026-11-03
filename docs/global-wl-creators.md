# Global WL creator hierarchy

## Attribution contract

- Resolve one recognized creator from the campaign name first: Kristyna, ActionKate or befit_over40.
- Only a campaign with no recognized creator permits ad-set-name fallback. Multiple campaign matches remain ambiguous; a matching ad set cannot override them.
- Campaign 035 intentionally mixes creators. Keep its parent campaign totals and campaign unique reach intact. Attribute only reconciled nested ad-set facts, never duplicate a parent total per creator.
- Missing or ambiguous names remain unresolved. Preserve all performance in totals and display escaped affected campaign/ad-set names. Never infer creators from PAC codes or ad names, and never default to a creator.
- Optional ad-set fetch/pagination failure preserves successfully fetched campaign facts with a sanitized actionable warning. Primary campaign fetch failures remain failures. Partial child pages cannot become an apparently complete split.
- Nested facts must reconcile additive metrics before use. Reach is not additive: unsplit totals retain campaign-level reach; ad-set reach is never presented as deduplicated campaign reach.
- Promo split and the WL report share the campaign-first resolver. Existing tab eligibility, market/group filters, phase precedence and WL report's last-full-month default remain independent. PAC462 removes only ActionKate attributed spend from the report's reported-spend denominator, not outcomes.

## Cache and refresh

Aggregate/daily/ad preset payloads now use `creator_version: 2`; all ad payloads now use `wl_version: 3` for verified-positive partnership eligibility (see README); creator attribution alone is not eligibility. Old schema payloads cannot satisfy the new contract. Nested campaign facts preserve the original campaign rows for unsplit tabs. Every preset cache write is followed by a GET of the exact key and serialized-value comparison; mismatches fail the refresh. Completion stats include `readback_verified` and unresolved `creatorIssues`.

Retain the single registered `/api/glv-meta-ads/cron` schedule at `0 0 * * *` UTC. It refreshes all preset sources and shared creative history; do not create a WL-only schedule or alter the completed-day cutoff.

After approved merge and a Ready production deployment, verify its source SHA and that the registered cron host points to it:

```bash
npx --no-install vercel crons list --project agenthic-lab --scope tucmedia --json
npx --no-install vercel crons run /api/glv-meta-ads/cron --project agenthic-lab --scope tucmedia
```

A trigger acknowledgement is not completion. Require the exact deployment/path invocation's HTTP success, completion event, preset/date coverage, cache readback confirmations, and sanitized unresolved campaign/ad-set names. Do not commit raw provider logs or client exports. Report unresolved names to Tom without credentials. Application login and provider authorization are separate; do not bypass app authentication to claim browser/data verification.

## Verification commands

```bash
npm test
npm run verify:glv-release
npm run qa:meta-ads
node qa/global-wl.cjs
node qa/wl-report.cjs
```

On a memory-constrained runner, run the maintained Meta QA one viewport at a time with `GLV_META_QA_VIEWPORT` and a separate `GLV_META_QA_EVIDENCE_DIR`. The complete matrix is `desktop`, `desktop-1001`, `tablet-1000`, `desktop-800`, `desktop-721`, `mobile-720`, `mobile-390`, `mobile-320`; a single viewport pass is not a full-matrix pass. Invalid viewport names fail rather than silently skipping coverage. Global WL QA exercises mixed creators, campaign precedence, totals/reach preservation, unresolved names/XSS, warning recovery, Promo grain changes and WL report totals at 1440/390/320 in both themes using synthetic data.
