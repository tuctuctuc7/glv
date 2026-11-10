# Global WL creator hierarchy

## Attribution contract

- Prefer a strict supported ad-name prefix: `Kristyna_PAC419_variant`, `ActionKate_PAC460_variant`, `ActionKate_PAC462_variant`, `befit_over40_PAC470_variant` (the parser supports other explicit numeric PACs too; PAC numbers never identify creators). Match supported creator spelling case/diacritic-insensitively, require `_PAC<number>_` and a nonempty variant, and retain source names/suffixes unchanged.
- For legacy ads without a valid explicit prefix, keep campaign-first attribution; only a campaign with no recognized creator permits ad-set-name fallback. Multiple campaign matches remain ambiguous; a matching ad set cannot override them.
- Campaign 035 intentionally mixes creators. Keep its parent campaign totals and campaign unique reach intact. Attribute only individual nested ad facts, including multiple creators inside AS13, never duplicate a parent total per creator.
- Missing or ambiguous names remain unresolved. Preserve all performance in totals and display escaped affected campaign/ad-set names. Never infer creators from bare PAC codes or arbitrary ad-name substrings, and never default to a creator.
- Optional ad-level fetch/pagination failure preserves successfully fetched campaign facts with a sanitized actionable warning. Primary campaign fetch failures remain failures. Partial child pages cannot become an apparently complete split.
- Nested facts must reconcile additive metrics before use. Reach is not additive: unsplit totals retain campaign-level reach; ad-set reach is never presented as deduplicated campaign reach.
- Promo split and the WL report share the explicit-ad-first migration resolver. Existing tab eligibility, market/group filters, phase precedence and WL report's last-full-month default remain independent. PAC462 removes only ActionKate attributed spend from the report's reported-spend denominator, not outcomes.

## Actionable warnings and contextual Ghost information

Global warning banners contain unresolved creator naming/source issues only, with exact campaign and ad-set names and the explicit-ad-first / legacy campaign-first / ad-set-fallback resolution instruction. Signed reconciliation residuals are information, not global warnings.

Ghost / unattributed creator is shown only in a valid, requested WL creator breakdown with nonzero residual metrics after aggregation (using the producer's `1e-9` floating-point tolerance). This includes action-only residuals, not just spend/revenue; zero and cancelling residuals do not create empty labels. Campaign totals, signed residual math, real creator facts and eligibility are unchanged. The independent Promo Creative financial-visibility rule is unchanged.

Ghost labels in KPI cards, both table orientations and chart HTML legends have adjacent accessible info buttons. Hover/focus opens, click/tap pins, Escape closes and restores focus; rerenders close detached triggers. Legend controls still toggle chart visibility. Explanation lives in the contextual popup, not the global banner.

Run `node qa/creator-ghost.cjs` in addition to the gates below: synthetic fixtures cover signed and action-only residuals, zero/cancellation, split on/off, exact TUC_035 / AS13 warnings, keyboard/touch popup interactions, legend toggles and 1440/390/320 widths in both themes. No live Meta calls or cache writes are made.

## Cache and refresh

Aggregate/daily/ad preset payloads retain `creator_version: 2`; aggregate/daily WL facts additionally require `creator_ad_version: 1` and real ad IDs/names. Old ad-set-only caches miss and must be re-extracted, never split by guessing. Live and cron campaign producers request `level=ad` for every WL campaign (even a creator-named campaign); all ad payloads now use `wl_version: 3` for verified-positive partnership eligibility (see README); creator attribution alone is not eligibility. Old schema payloads cannot satisfy the new contract. Nested campaign facts preserve the original campaign rows for unsplit tabs. Every preset cache write is followed by a GET of the exact key and serialized-value comparison; mismatches fail the refresh. Completion stats include `readback_verified` and unresolved `creatorIssues`.

Retain the single registered `/api/glv-meta-ads/cron` schedule at `0 0,1,2,4,8,12,16,20 * * *` UTC (current main recovery opportunities). It refreshes all preset sources and shared creative history; do not create a WL-only schedule or alter the completed-day cutoff.

After approved merge and a Ready production deployment, verify its source SHA and that the registered cron host points to it:

```bash
npx --no-install vercel crons list --project agenthic-lab --scope tucmedia --json
npx --no-install vercel crons run /api/glv-meta-ads/cron --project agenthic-lab --scope tucmedia
```

A trigger acknowledgement is not completion. Require the exact deployment/path invocation's HTTP success, completion event, preset/date coverage, cache readback confirmations, and sanitized unresolved campaign/ad-set names. Do not commit raw provider logs or client exports. Report unresolved names to Tom without credentials. Application login and provider authorization are separate; do not bypass app authentication to claim browser/data verification.

## Migration rollout requirements (implementation only)

- Deploy backend, shared resolver and cache-busted browser assets together after review; reload open tabs. No deployment or cache write is implied by local tests.
- Run the existing authorized refresh / next cron and verify exact aggregate/daily keys have `creator_ad_version:1`, per-ad identities/names and signed reconciliation. Refresh ads caches as well after Meta renames; cached names are snapshots and this change does not retimestamp them.
- Verify 035 / AS13 on actual ad-level rows across presets and daily dates, retaining campaign totals. If ad-level extraction fails, preserve totals and display the source warning; do not split an aggregate ad set among creators. Higher ad-level pagination workload must fit the existing refresh budget.
- PAC340 / PAC372 / PAC468 remain held. Keep legacy campaign/ad-set fallback until the full naming inventory is verified and an explicit final ad-only cutover is approved. No PAC-to-creator mapping is implemented.
- Partnership-positive eligibility remains the WL report gate; legacy phase-based Promo grouping is not an alternative eligibility signal. No Meta or Notion mutations are performed by this implementation.

## Verification commands

```bash
npm test
npm run verify:glv-release
npm run qa:meta-ads
node qa/global-wl.cjs
node qa/wl-report.cjs
```

On a memory-constrained runner, run the maintained Meta QA one viewport at a time with `GLV_META_QA_VIEWPORT` and a separate `GLV_META_QA_EVIDENCE_DIR`. The complete matrix is `desktop`, `desktop-1001`, `tablet-1000`, `desktop-800`, `desktop-721`, `mobile-720`, `mobile-390`, `mobile-320`; a single viewport pass is not a full-matrix pass. Invalid viewport names fail rather than silently skipping coverage. Global WL QA exercises mixed creators, campaign precedence, totals/reach preservation, unresolved names/XSS, warning recovery, Promo grain changes and WL report totals at 1440/390/320 in both themes using synthetic data.
