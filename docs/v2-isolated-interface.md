# Isolated V2 runtime interface

Coordinator: `require('./lib/glv-mad-v2-isolated.cjs').refresh({mode: 'morning' | 'late', tokenFor, token, redis, fetcher, now, deadline, force:false})`.

`tokenFor(account)` receives the verified configured account object. `redis(command, ...args)` returns `{result}`. Default budget 270 seconds. Result: `{verified, mode, through, summaries, errors, readbacks, date_policy:'account-isolated'}`. Morning targets Prague yesterday and late targets Los Angeles yesterday. Late selects TGLV only: no TUC Graph or Promo extraction. Existing six presets plus both TUC/CZSK Promo types participate in default refresh verification. Optional `presets`, `includePromo`, `build`, `loadFx`, `fetchPromo` support tests.

## Ownership and migration

New namespace: `glv:mad:v2:isolated:1:`. Separate account leases, phase/account checkpoints, working source pieces, durable account manifests, and coherent combined manifests. Small combined-publication leases prevent concurrent composition races. Existing immutable publication helper verifies stored bytes and retains prior generation references. Neither V1 nor shared owner state is written.

Bootstrap reads validated old V2 native manifests (legacy native pieces only if coherent), splits account histories without retimestamping them, and imports only each selected account's raw checkpoint chunks. Pending old force markers must match. Migration reopens the rolling seven-day correction window, drops unfinished pages/metadata, and writes only new keys. Fresh work never treats a migrated same-date wrapper as a completed phase receipt. Failure leaves independently retained source publications readable. No credentials or pagination URLs are emitted in diagnostics.

Morning retries do not overwrite a completed late-phase same-date TGLV bundle. Older targets cannot regress scheduled publication. Late requires exact retained TUC coverage to certify overall success; it never extracts TUC to repair missing coverage.

## Reader and diagnostics

`api/glv-meta-ads-v2/fb-data.js` delegates to `glv-mad-v2-isolated-reader.cjs`; existing cookie authentication remains unchanged. Scope ceiling is Prague yesterday. Responses declare `date_policy:'account-isolated'` and `account_coverage:[{account_id,range,complete_through,partial,generated_at}]`; missing account coverage additionally declares `missing:true`.

Non-daily retained account facts whose start differs from the publication start are omitted and listed in `omitted_accounts`; exact period reach is never sliced or summed from daily reach. Daily rows can be filtered to requested dates. Partial/end-short coverage stays explicitly disclosed. Structural `complete:true` does not imply `coverage_complete:true`.

Cold custom ranges use eight bounded isolated slots, distributed coalescing, and the same account source pipeline. They never call V1 cron or shared ownership. Exact cached native ranges can be reused; reach is never fabricated for a narrower period. A source timeout can return retained exact-range data or 503 while checkpointed extraction resumes on retry.

Both Promo types use the original TUC/CZSK source/conversion contract, bootstrapped read-only from old Promo history and then refreshed independently with rolling replacement. TGLV remains outside that established Promo product and is explicitly disclosed as such. Late reuses and verifies Promo without Graph extraction.

`readback({redis, now, presets?, includePayload:false, includePromo?})` validates actual combined/native publications, returns per-preset coverage, generation/digest and row-count/payload-digest stats, plus Promo verification by default. `includePayload:true` adds `presets[].payloads.USD|CZK.daily|aggregate|ads` and Promo payloads. It performs no Graph requests. Expose only through the existing authenticated cron bearer wrapper; no authentication bypass was added.

## Compatibility boundary and unverified gates

Isolated TUC extraction persists exact-range campaign/creator and ad direct observations alongside daily facts. The V2-owned pure observation composer preserves native CZK direct observations and uses daily CNB monetary conversion for USD while preserving the same canonical entity/creator population and nonmonetary basis. Both creator-Ghost union directions retain their observation provenance. Neither V1 publications nor the retired shared runtime are consumed. Daily-only legacy history remains explicitly identified and readable, but cannot certify completion of the new direct-observation contract. Tests cover deliberately divergent daily/period facts, exact reach and account isolation; populated production parity remains a live release gate.

Tests use synthetic Redis and Graph transport and exercise the real source and authenticated API handler. Production bootstrap transport size, credentials, budgets, populated historical native-observation parity, browser rendering and both live passes require deployment verification by the parent. No commit or deployment is performed by this worker.
