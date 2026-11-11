# MAD V1 / V2 parity audit

Audit date: November 11, 2026. Baseline: `7f63fdf` (PR 65).

## Verdict

**The dashboards are not literally 1:1 except for the TGLV merge.** The audit found real behavioral defects, additional presentation differences, and an API-range policy difference. Earlier creator-only checks were insufficient to establish whole-dashboard parity.

The repair candidate fixes the confirmed defects below. It deliberately does not conceal the remaining differences by weakening the differential assertions or silently replacing V2's visual design.

**Release status:** tested locally; final independent review and production activation pending. Production results must be appended separately, not inferred from these tests.

## Why the screenshot was wrong

The banner used an extraction-era campaign label, `CZSK | GRAVEYARD | CBO`. A read-only current Meta object lookup verified the same immutable campaign ID is now named `TUC_037_CZSK_CBO_GRAVEYARD`. V2 reuses native daily history and same-cutoff publications; performance freshness did not imply campaign-label freshness. V1 and V2 could therefore execute equivalent reporting rules against different names.

The repair publishes a separately verified current campaign-name mapping, scoped by account ID plus campaign ID. Both APIs apply it when serving retained history. It does not match campaigns by the reused number `037`, suppress genuine naming warnings, re-fetch all historical insights, change performance timestamps, or mutate Meta campaigns. Metadata identity is included in the served bundle identity so mixed metadata generations trigger the existing coherent-bundle retry.

## Confirmed defects and corrections

| Finding | Correction in candidate | Verification |
|---|---|---|
| Current campaign rename absent from retained V2 data | Shared current-name overlay for both readers, including daily, aggregate, ads and Promo history; normal owner refreshes names even when performance is already verified | Exact stale-Graveyard regression; immutable IDs/metrics/timestamps; account collision and generation tests |
| Currency/account changes reset independent dates and tab controls | Versioned account-scoped state restoration; incompatible campaign IDs are removed without turning explicit None into All | Nine real Chromium reload transitions across independent WL dates, all tab selects, sorts, grains, modes, toggles and selection reconciliation |
| Mixed-account WL creative rows look like duplicate unlabeled rows | Account provenance appears for All/mixed scopes while keeping account-isolated totals | TUC/TGLV same-creative fixture and visible label tests |
| Valid ad-name attribution with a conflicting parent is described as unresolved | Both WL UIs separate retained parent-name advisories from genuinely unresolved attribution | Advisory versus unresolved regression tests |
| Supported legacy `WL_befit_over40` naming exception gets a V2 prefix warning | V2 uses the same narrowly bounded, case-sensitive-leading `WL_` exception as V1, only for TUC | Accepted and rejected lookalikes plus TGLV negative control |
| V1 custom campaign requests silently turn absent required facts into zeros | Validate raw spend, impressions, reach, dates and identity before normalization using the existing shared campaign validator | Aggregate and daily requests: absent, null, blank, invalid, negative and actual zero inputs |

Independent review also found an initial repair implementation ran a costly full consumer audit after every ordinary cron. That release blocker was corrected: full readback is operator-only, exceptions become bounded diagnostics, and exhausted audit budgets stop before additional reads. Normal daily performance refresh remains under one shared owner; no new scheduler was added.

## Tab-by-tab comparison

Baseline: same synthetic facts, same actual dates, **V2 TUC-only / CZK**, real V2 rendering and independent V1 rollup. Added TGLV and FX behavior are tested separately, not mixed into the baseline.

| Tab | Compared | Result / qualification |
|---|---|---|
| CZSK | KPI calculations, campaign grouping, daily facts, charts, creative rows, controls | Compared numeric facts match; secondary USD card text and campaign labels still differ |
| Triage | Market, grain, grouping, table calculations, control changes | Compared same-input behavior matches; reload-state defect repaired |
| Promo | Cohort membership, active-spend behavior, grouping and table modes | Compared same-input behavior matches; no missing V1 Promo rule found |
| Promo Creative | Real V2 Promo conversion, format/concept outputs, signed residuals, thresholds and cancellation | Compared same-input behavior matches; visibility does not alter authoritative totals |
| Leadgen | Grouping, metrics, table modes and select changes | Compared same-input behavior matches; two hidden controls were not directly clicked in the broad baseline harness |
| US | KPI calculations, BAU/advertorial grouping, creative rows | Compared TUC numeric facts match; secondary USD text and campaign labels still differ; controlled TGLV addition affects US only |
| WL | Independent dates, partnership eligibility, ad-name-first creator rules, mixed creators, residuals, creator/market/campaign filters | Compared same-input reporting rules match; reload state, account labels and advisory wording repaired |

## Differences left visible in the audit

1. **Visual design:** V2 has a separate `quiet-precision.css`, different legend positions, mobile navigation/layout and introductory text. These are not necessary consequences of adding TGLV. No silent redesign rollback was included in the repair.
2. **KPI card text:** V1 displays secondary USD equivalents while V2 CZK does not. Literal equality fails even when primary financial metrics match. Restoring secondary numbers requires an explicit FX-display contract rather than copying an approximation into a daily-FX dashboard.
3. **Creative campaign labels:** V1 shows labels such as `002`; V2 shows `TUC_002`. Account-qualified labels are necessary for ambiguous mixed-account scopes, but also appear under TUC-only.
4. **Custom-range limits:** V2 rejects ranges wider than 366 days and incomplete/future common-account dates. V1's custom handler does not enforce precisely the same bounds. The multi-timezone completed-date restriction supports the merge; acceptance of the separate maximum-width policy was not established by this audit.
5. **Data-production architecture:** V1 period totals use direct-period insights; V2 additive period totals derive from daily facts with separately queried exact-period reach. Synthetic equality is not evidence that independently extracted live snapshots are numerically identical. Live published readbacks are a separate acceptance step.

## Executed evidence

- Full Node suite: **475 passed, zero failed** on the repair candidate.
- Release verifier and `git diff --check`: passed.
- Differential browser run: **221 checks, 175 passed, 46 failed, zero page errors**. The failures remain recorded and are repetitions of the two textual presentation differences above, not 46 distinct metric defects.
- Real Chromium reload regression: **nine transitions passed**.
- Broad browser scope: seven tabs, six standard presets plus custom dates; 49 select-control changes; explicit campaign None/All; normal, zero, missing-ads, creator-name migration and residual scenarios; representative desktop/mobile and dark/light states.
- Browser dependencies: real locally vendored Chart.js/GridJS, with external transport blocked and synthetic test data explicitly labeled. No fabricated live API responses were used as production evidence.
- Controlled TGLV fixture: correct US-only increment, unchanged CZSK figures, unique account-namespaced IDs.

Re-run:

```sh
npm test
npm run verify:glv-release
NODE_PATH=/home/tom/.openclaw/workspace/dashboard/glv/node_modules node qa/mad-parity-controls.cjs
NODE_PATH=/home/tom/.openclaw/workspace/dashboard/glv/node_modules node qa/mad-full-parity.cjs
```

The last command intentionally exits nonzero while the documented presentation differences remain. Do not describe it as an all-green parity run.

## Production acceptance and remaining limits

- Protected metadata-only refresh: existing bearer-authenticated cron, `names_only=1`, optionally the exact campaign ID. It uses the same owner lease and must not trigger historical performance extraction.
- Verify actual served/readback names in both versions and all relevant presets, not only the metadata publication or raw native snapshot labels. Native snapshots intentionally retain extraction-era labels.
- Operator audit exposes original-account CZK additive totals for paired live preset/type comparisons. Do not sum daily reach or combine unique reach across accounts as if it were additive.
- Verify the canonical deployment SHA, current assets, existing login protection and both-version normal refresh receipt separately.
- Authenticated production-browser visuals, every possible filter combination, pixel-identical rendering and arbitrary live attribution changes are **not** established by synthetic browser tests.

This report is an inventory of evidence and differences, not a declaration of universal parity.
