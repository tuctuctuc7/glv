# MAD shared data parity — production backend contract

## Status

The authenticated V1/V2 handlers and normal shared owner now use the shared publication path when `GLV_MAD_V2_ENABLED=1`. This is no longer an unused adapter prototype. Local source/transport/handler tests are described below; **no live credentials, refresh, commit, or deployment were used**. Production activation and the independent browser acceptance run remain parent-owned.

Baseline: `0c8e6b8`, branch `fix/mad-shared-parity`. Backend scope only; this worker did not edit `public/` or `qa/`.

## Active paths

- Both APIs → `glv-mad-shared-reader.consumer` → the same immutable per-preset manifest → `glv-mad-shared.render`. Cookie authentication runs before source reads. V2 has no independent native preset/custom fallback. With V2 disabled, the original V1 route/producer path is unchanged.
- The existing `/api/glv-meta-ads/cron` remains the only scheduled owner. Under its lease, `ensureCorrection` persists a correction identity **before** source/FX work and invalidates old completion receipts. Normal continuation reuses the pending identity at the same cutoff. The native working pieces and ad checkpoints are scoped to that identity; `reopenCorrection` retains older facts and clears only the rolling seven-day correction window, incomplete pages and stale metadata. It does not request `full_history`.
- `runRefresh` validates and publishes all six shared preset bundles and one shared Promo history before certifying shared completion. Shared manifest, immutable-piece and correction-intent byte hashes are required in completion receipts. A failed source/account, missing currency coverage or partial publication keeps `all_tabs_verified=false`; a later normal invocation can recover. Receipt verification checks immutable bytes, not only unchanged manifest pointers.
- `glv-mad-shared-promo` supplies **both** format and concept histories to both versions from one generation, retaining reclassification, inventory, signed residuals, extraction time, and daily CNB conversion.
- Authenticated custom reads use `glv-mad-shared-custom`: the same policy in both versions, at most **90 completed days**, a **45-second total transport/source budget**, eight deterministic cache slots, and the existing global owner lease. They construct all three types once and publish one shared range bundle; they do not trigger scheduled/history force. Exact-range last-good is retained on failure. A concurrent owner causes a cache-only response/503, not duplicate pulls. Slot collisions never return another range as the requested range.

## Canonical facts and currency contract

TUC's V1 direct-period aggregate and ads observations remain authoritative. Its campaign daily observations come from V1. Exact-period reach is preserved and never summed from daily reach. TGLV retains its verified account identity and US scope. IDs, including nested creator ad IDs, are account-namespaced only at the V2 adapter boundary.

USD TUC rows are reconciled and materialized **at publication**, with the canonical entity population, status, partnership evidence, creator facts, signed Ghosts and nonmonetary metrics. Their monetary values come only from observed daily inputs and CNB fixings. This prevents a CZK/USD switch from silently choosing independently aged ad populations or counts. Ad-grain child identity uses the immutable ad ID, not its shared parent campaign or ad set.

Direct-period native monetary totals can differ from a sum of native daily observations. The response exposes `shared_provenance` and row-level `monetary_provenance`, including true daily inputs and native direct-period observations. **No period residual is assigned to an invented day.** Unsupported daily entity/creator coverage rejects publication, retaining the prior shared generation; it is not hidden by formatting or invented zero rows. Ratios continue to be calculated by consumers from the resulting aggregate inputs.

A retained native ads wrapper may predate the current correction. Publication and cache reuse validate actual **account + correction-window extraction evidence**, scoped to the durable correction ID, rather than changing its timestamp or requiring a fresh wrapper. Source ages and daily FX provenance remain visible.

Campaign metadata remains a separately verified dimension. Both API adapters bind the exact metadata digest to the served `generation_id`; `shared_generation_id` identifies the underlying common performance publication. A metadata switch between independent browser requests therefore yields a detectable generation mismatch rather than mixed labels under an unchanged generation.

## Durability and storage

Each immutable Redis piece stores only its own type, not three copies of the entire bundle. Existing integrity-checked compressed transport is used. Current and previous validated manifests/pieces remain durable; exact retired/unreferenced pieces receive the existing grace TTL. Partial writes and corrupt current pieces fall back to the validated previous generation. Retirement remains best effort under cleanup failures; this is not a claim of arbitrarily bounded orphan storage.

Before the first shared publication, V1 can still serve its validated legacy preset bundle with `shared_migration_pending`. V2 intentionally fails closed rather than serving the old independent native population as shared parity. **Release sequencing must warm and verify shared keys using the candidate owner before switching production traffic** if uninterrupted V2 availability is required. Unsupported live source coverage must remain a visible failed migration, not a claimed success.

## Operator audit

`glv-campaign-metadata.auditPublished` now calls the same `consumer` adapters as the HTTP handlers: six presets × three types × two versions, plus both Promo types × both versions. Results include actual and requested ranges, performance and served generation identities, source extraction time, account-scoped names, monetary/count summaries, and deep semantic digests (including nested creator/ad identity, partnership evidence and signed residuals; Promo includes inventory). The operator can compare TUC/CZK digests and generation IDs directly.

The audit is operator-only (`names_only` / `campaign_id`), deadline-bounded, exception-safe, and memoizes immutable reads. Ordinary scheduled runs do not run a second full consumer audit after publication.

## Local verification

New RED/GREEN regressions exercise actual authenticated HTTP handlers, the actual normal owner handler (old receipt → one-account failure → normal recovery → `already_verified` → corrupt immutable-piece recovery), actual custom extraction/cache reuse, metadata generation races, direct-period/daily rounding, currency-invariant populations/counts, multi-ad creator children, signed Ghosts, older wrappers with fresh correction evidence, and tampered materialized USD rejection. Existing native-reader tests were migrated to seed the **active shared publications**, rather than requiring the removed independent V2 fallback.

The real Redis Unix-socket test exercises compressed shared publication, interrupted writes, current/previous TTL -1, corruption fallback, idempotent correction intent, lease exclusivity/release and completion reuse. It starts only its own rootless Redis process, with port 0 and persistence disabled.

Final integrated-tree serial suite: **522 passed, 0 failed, 0 skipped** with `NODE_PATH=/home/tom/.openclaw/workspace/dashboard/glv/node_modules node --test --test-concurrency=1 tests/*.test.cjs`. Receipt: `/home/tom/.hermes/cache/scratch/mad-shared-production-verified-suite.log`. `npm run verify:glv-release` and `git diff --check` also passed. Other workers were modifying their owned frontend/tests concurrently; this count describes the tree at that invocation.

## Parent-owned acceptance / nonclaims

Final pre-release gate (November 11, 2026): independent follow-up production-source review passed after correcting cold custom-read lease contention, expired cleanup overriding last-good responses, currency-dependent renamed market classification, native ownership contradictions, and the V1 common-midnight policy. The real normalizer-to-browser ownership regression also passes. `NODE_PATH=/home/tom/.openclaw/workspace/dashboard/glv/node_modules npm test` passed 536/536 with no skips; the serial suite independently passed the same count. Actual-handler/shared-Promo offline browser acceptance passed 959/959, including 28 exact panel screenshot pairs, 595 control cases and nine document reloads. Additional focused midnight/recovery browser checks passed 62/62. These use synthetic Redis/source/FX and do not certify live production data or login issuance. Warm and verify the unaliased production-environment candidate before promotion; live activation remains a separate gate.

- No production data, deployed SHA, live ad naming list, recurring refresh or authenticated live browser was verified here.
- Browser consumers must honor the **common completed-day cutoff** while V2 is enabled and the shared 90-day custom policy, including Prague/Los Angeles midnight boundaries. Their independent-request generation recovery must retain the metadata-bound `generation_id`; do not replace it with `shared_generation_id`.
- Run the expanded browser/QA matrix against this integrated tree; this backend worker did not edit or certify the other worker's UI/QA changes.
- A real direct-period entity missing from retained daily coverage is a truthful fail-closed condition. Inspect the explicit source/currency-coverage failure and recover supported facts; do not force all Promo history or synthesize daily allocations to make a receipt pass.
