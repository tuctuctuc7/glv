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

Direct-period native monetary totals can differ from a sum of native daily observations. The response exposes `shared_provenance` and row-level `monetary_provenance`, including true daily inputs and native direct-period observations. **No period residual is assigned to an invented day.** Unsupported real campaign/ad/creator coverage rejects publication, retaining the prior shared generation. Ratios continue to be calculated by consumers from the resulting aggregate inputs.

### Explicit derived creator-reconciliation union

The producer creates `campaign_adset_residual` Ghosts separately for each observation. A direct-period campaign can balance while its daily Ghosts cancel in CZK but not after distinct daily FX conversions. The reverse is also valid: a direct-period Ghost can have no daily Ghost counterpart. These are derived reconciliation-row differences, not missing real entities.

Publication now takes the **union of nested creator Ghost identities only**, after checking the complete real-child identities on both sides. Multiple/malformed Ghosts are rejected before daily aggregation can merge them. Missing, extra or duplicate real identities, contradictory account ownership, unavailable creator attribution, or unavailable required additive operands remain failures. This is not a general relaxation of entity coverage.

- A missing native Ghost is calculated from that native observation's authoritative parent minus its complete real children. A missing USD Ghost is calculated from the actual daily-converted parent minus the actual daily-converted real children, with the original daily operands checked before aggregate normalization can default missing counts to zero.
- The result includes all nine supported creator-reconciliation additive metrics and `reach: null`. There is no epsilon suppression, invented video metric, invented daily residual series, invented extraction time, alteration of parent totals, or assignment to a named creator. Calculated zero means the available operands balance; it never means the source was unavailable.
- `piece.v1` retains the original observation. `piece.canonical_v1` is its cloned, augmented publication representation, consumed by both V1 and V2/CZK. Existing parent/real-child fields and original Ghost values are unchanged; callers' legacy/native objects are not mutated. Content validation rebuilds and checks the augmentation and provenance.
- `derived_reconciliation` identifies the derivation basis, parent identity, complete real-child identities, and exact parent/child operands. USD derivations also retain native daily monetary operands and references to the actual parent/child daily FX inputs; they do not claim those references are newly observed daily Ghosts.
- USD Ghost money retains the converted-daily observation, including a daily-only residual near USD 0.01 when the native residual is exactly zero. `reconciliation_observations` exposes both native-direct and converted-daily residual metrics, including legitimately different count residuals. **Displayed nonmonetary facts remain canonical-native**, consistent with the existing currency-invariant count contract; converted-daily counts are retained explicitly in provenance rather than silently substituted into canonical real-entity/parent counts.
- The `native` monetary fields used for native-CZK-equivalent visibility remain canonical-native in either currency; `monetary_provenance.native_daily` separately retains the daily observation's native money. Existing consumer Ghost visibility rules are unchanged. The row can be hidden for display without deleting its underlying residual facts.

This explicitly augments a reporting representation; it does **not** rewrite old source observations to claim the producer originally emitted a zero Ghost.

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

## Reconciliation-union local verification — November 11, 2026

- Both actual-cron-normalizer + `attachCreatorFacts` reproductions fail against the unchanged `a908c57` implementation: daily-only Ghost (`canonical=1 observed=2`) and period-only Ghost (`canonical=2 observed=1`), both at `rows.creator_rows`. Baseline RED evidence: `/home/tom/.hermes/cache/scratch/mad-reconciliation-union-red-baseline.log`.
- Final focused serial run: **26 passed, 0 failed, 0 skipped**. Full serial `tests/*.test.cjs` run: **552 passed, 0 failed, 0 skipped**, using `NODE_PATH=/home/tom/.openclaw/workspace/dashboard/glv/node_modules`. Evidence: `/home/tom/.hermes/cache/scratch/mad-reconciliation-union-focused.log` and `mad-reconciliation-union-full.log` in the same directory.
- Unchanged-interface actual-handler/shared-Promo browser acceptance: **959/959**, 28 exact image pairs, 595 control cases, nine document reloads, no failures/page errors, no partial phase, unchanged frontend and reader hashes. Evidence: `/home/tom/.hermes/cache/scratch/mad-reconciliation-union-browser/acceptance.json`. Runtime source SHA-256: `a9229e79d72b1f29db3dc3c94550d651fd52b7dbdaaf6ff9a12267aa25a16e5b`. The final additional duplicate-real-child regression changed tests only, not this browser-verified runtime.
- `npm run verify:glv-release` and `git diff --check` passed. No `public/` or `qa/` files were edited. No live credential access, production calls, commits, deployment or refresh occurred; synthetic offline acceptance is not live migration/freshness proof.

## Parent-owned acceptance / nonclaims

Final pre-release gate (November 11, 2026): independent follow-up production-source review passed after correcting cold custom-read lease contention, expired cleanup overriding last-good responses, currency-dependent renamed market classification, native ownership contradictions, and the V1 common-midnight policy. The real normalizer-to-browser ownership regression also passes. `NODE_PATH=/home/tom/.openclaw/workspace/dashboard/glv/node_modules npm test` passed 536/536 with no skips; the serial suite independently passed the same count. Actual-handler/shared-Promo offline browser acceptance passed 959/959, including 28 exact panel screenshot pairs, 595 control cases and nine document reloads. Additional focused midnight/recovery browser checks passed 62/62. These use synthetic Redis/source/FX and do not certify live production data or login issuance. Warm and verify the unaliased production-environment candidate before promotion; live activation remains a separate gate.

- No production data, deployed SHA, live ad naming list, recurring refresh or authenticated live browser was verified here.
- Browser consumers must honor the **common completed-day cutoff** while V2 is enabled and the shared 90-day custom policy, including Prague/Los Angeles midnight boundaries. Their independent-request generation recovery must retain the metadata-bound `generation_id`; do not replace it with `shared_generation_id`.
- Run the expanded browser/QA matrix against this integrated tree; this backend worker did not edit or certify the other worker's UI/QA changes.
- A real direct-period entity missing from retained daily coverage is a truthful fail-closed condition. Inspect the explicit source/currency-coverage failure and recover supported facts; do not force all Promo history or synthesize daily allocations to make a receipt pass.
