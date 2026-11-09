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
- Ads extraction checkpoints bounded chunks/pages and may require multiple invocations within the same completed-date cutoff. Cutoff rollover resets unfinished extraction; do not promise single-run cold-start completion. Monitor failed runs and preserve sufficient same-cutoff recovery opportunities.
- Complete per-preset generation manifests bind compatible source facts while preserving actual extraction timestamps. UI rejects wrong-range or incompatible generations; same-scope stale data is explicitly labeled.
- Large V2 values use bounded integrity-checked gzip/base64 envelopes with legacy JSON support. Exact stored-byte readback/TTL checks and receipt hashes remain mandatory. Checkpoints are private data, not public assets or handoff content.

## Verification and publication

- `npm test` runs V2 contracts alongside original regression tests.
- `NODE_PATH=<installed dependencies> node qa/mad-v2-browser.cjs` exercises synthetic browser fixtures; this is not live business reconciliation.
- `qa/mad-v2-live.py` is an authorized local read-only probe; its runtime depends on the installed private environment loader and must not export credentials.
- Before promotion, require all V1/V2 cache readbacks and `all_tabs_verified:true`, then an `already_verified` follow-up. Test anonymous UI login redirect and API 401. Authenticated browser verification requires an authorized session; do not weaken authentication to bypass a missing login.
- Publish source to canonical GitHub main before relying on the new URL. The scheduled business exporter deploys from main, so an uncommitted CLI-only route would disappear later.
