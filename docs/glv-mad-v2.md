# GLV MAD V2 multi-account reporting

Route: `/glv-meta-ads-v2/`. Existing `/glv-meta-ads/` remains independent and unchanged in frontend/data scope. Both use the existing beta-cookie authentication boundary.

## Reporting contract

- TUC: Meta account `359758259164738`, native CZK, Europe/Prague, existing CZSK/US classification.
- TGLV: Meta account `1021777267558882`, native USD, America/Los_Angeles, US-only. Included in US and Triage US/All, never CZSK.
- Immutable account IDs determine identity and account-qualified entity keys. Campaign prefixes are human-readable labels, not join keys. Prefix mismatches warn without discarding spend. Account-local campaign numbers may overlap.
- Default display USD; USD/CZK switch beside theme. Daily CNB historical fixings, prior published fixing on nonbusiness days, native values/provenance retained. Convert monetary inputs before aggregation; ratios are derived from sums.
- Daily reports combine account-local date labels without rebucketing. Default ranges end on the latest date completed in both timezones. This is not synchronized hourly reporting or deduplicated store revenue.

## Runtime and refresh

- Vercel project `tucmedia/agenthic-lab`. Tom approved replacing obsolete scope `agenthic` with `tucmedia` for all Vercel work; do not use personal scope.
- `GLV_MAD_V2_ENABLED=1` enables V2. Absent/other values fail closed. Keep enabled in the production project environment for subsequent Git-triggered deployments.
- `GLV_MAD_V2_FB_ACCESS_TOKEN` is a dedicated sensitive production credential; V2 uses it before legacy fallbacks. Original MAD credential is unchanged. Never put credential values in Git, documentation or logs.
- One existing `/api/glv-meta-ads/cron` owner and shared lease, not a second scheduler. Current schedule is `0 0,1,2,4,8,12,16,20 * * *` UTC.
- Nineteen isolated V2 report caches: six presets × daily/aggregate/ads, plus converted/reclassified Promo history. Direct custom-date reads remain read-only live queries.
- Ads extraction checkpoints bounded chunks/pages and may require multiple invocations within the same completed-date cutoff. On cutoff rollover, retain validated completed historical chunks within the 90-day horizon, replace the latest seven completed days, and discard partial pages and cached metadata. Historical source extraction timestamps remain in `source_extractions`; the assembled rolling snapshot records its current refresh generation time. Cold bootstrap can still require continuation; monitor failed runs and preserve sufficient same-cutoff recovery opportunities.
- Complete per-preset generation manifests bind compatible source facts while preserving actual extraction timestamps. UI rejects wrong-range or incompatible generations; same-scope stale data is explicitly labeled.
- Large V2 values use bounded integrity-checked gzip/base64 envelopes with legacy JSON support. Exact stored-byte readback/TTL checks and receipt hashes remain mandatory. Checkpoints are private data, not public assets or handoff content.

## Verification and publication

- `npm test` runs V2 contracts alongside original regression tests.
- `NODE_PATH=<installed dependencies> node qa/mad-v2-browser.cjs` exercises synthetic browser fixtures; this is not live business reconciliation.
- `qa/mad-v2-live.py` is an authorized local read-only probe; its runtime depends on the installed private environment loader and must not export credentials.
- Before promotion, require all V1/V2 cache readbacks and `all_tabs_verified:true`, then an `already_verified` follow-up. Test anonymous UI login redirect and API 401. Authenticated browser verification requires an authorized session; do not weaken authentication to bypass a missing login.
- Publish source to canonical GitHub main before relying on the new URL. The scheduled business exporter deploys from main, so an uncommitted CLI-only route would disappear later.

## Creator ad-name migration (candidate; activation not performed)

V1 and V2 prefer a supported explicit `creator_PAC<number>_variant` ad prefix,
then retain legacy campaign-first/ad-set fallback. Bare PACs never identify a
creator. PAC340/372/468 remain held; this is not an ad-only cutover. Partnership
eligibility stays independent. All WL campaign splits now fetch individual ad
facts, including mixed AS13. V2 namespaces ad IDs before aggregation, keeping
multiple ads in one ad set distinct across days/accounts and preserving native
amounts, daily FX provenance, signed Ghost and authoritative campaign reach.

Aggregate/daily native snapshots containing WL require `creator_ad_version:1`
and validated per-ad children; obsolete ad-set-only snapshots fail closed rather
than being relabeled or retimestamped. Browser assets are released together.
Ghost is contextual information adjacent to labels, only in a requested valid
split with nonzero aggregate additive residuals; banners retain named actionable
issues. Quiet Glass styles, account/currency filters and cron schedule are unchanged.

### Activation requirements

1. Review/merge/deploy this candidate through canonical `tucmedia/agenthic-lab`;
   verify deployed source SHA and alias. Keep persisted `GLV_MAD_V2_ENABLED=1`
   and dedicated V2 credential. Reload open V1/V2 tabs. No activation was run here.
2. After the separately authorized Meta renames, invoke the authenticated shared
   `/api/glv-meta-ads/cron?full_history=1` once with the existing Bearer cron secret
   loaded securely. Do not use `include_today=1`. A normal call can return an old
   same-day `already_verified` receipt; the force parameter bypasses it and
   rebuilds existing ad-name snapshots. It also requests full Promo history and
   forces V2 pieces: budget failures are possible, not proof of completion.
3. Inspect every failed preset and exact stored readback before retrying. Recover
   with the normal completed-day owner to resume bounded V2 checkpoints and
   rolling Promo history. Normal V2 refresh may reuse same-cutoff valid **ads**
   pieces; therefore verify renamed source ad names in all six ads snapshots
   explicitly, not just `all_tabs_verified`. If a forced ads piece failed while
   an old same-cutoff ads cache remains, that piece still needs a successful
   forced rebuild (or the next cutoff refresh); do not certify naming activation
   from a reused old piece. Repeating full-history force resets continuation and
   is not a guaranteed recovery strategy.
4. Require all 19 V1 and 19 V2 dataset readbacks, exact completed ranges, current
   ad names/IDs, `creator_ad_version:1` on aggregate/daily payloads containing WL,
   compatible V2 generation manifests, USD/CZK totals and native/FX provenance.
   Inspect 035/AS13 individual children and signed Ghost; preserve paused states.
   Require `all_tabs_verified:true` and a subsequent matching `already_verified`
   response. Read actual payloads because cron summaries do not expose every
   schema field. No new cron, Meta status mutation or Notion write is required.
5. Authenticated native V1/V2 browser readback remains a separate release gate.
   Synthetic tests cannot establish live Meta workload feasibility or freshness.

Focused synthetic creator QA: `node qa/creator-ghost.cjs`; sibling:
`GLV_QA_V2=1 node qa/creator-ghost.cjs`. Optional `GLV_QA_WIDTH=320` or `390`
limits the viewport for resource-constrained hosts. Both exercise real keyboard,
touch, legend toggles, signed/action-only residuals, cancellation and mixed AS13.
