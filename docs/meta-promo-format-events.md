# Promo Format Mix event grouping

## Scope and data flow

Only the independent Creative tab's Promo Format Mix changes. The protected
`promo_formats&date_preset=promo_history` API still returns reconciled ad/day
facts from March 2026 through the latest completed day. Current CZSK `_Promo`
campaign eligibility, format classification, attribution, inventory revisions,
cache freshness and the scheduled refresh remain unchanged.

`promoFormatRows` → `PromoFormat.promoMix` → both stacked share charts and the
accessible totals/format table. There are no Format Mix date/campaign/grain
filters or CSV export in this route. Global and other-tab filters remain
independent; the Concept Evaluation table retains its campaign selection and
whole-history aggregation. `monthlyMix` remains backward compatible for the
cron inventory readback and offline monthly diagnostic scripts; those are not
exports of the event view. The underlying API facts are unchanged.

## Explicit reporting policy

This is a **reporting-date partition**, not a campaign-cohort attribution model.
All eligible Meta Promo facts on a named window's dates contribute once to that
window, regardless of originating campaign. It is not Business Phases' all-CZSK
revenue scope, and does not restrict Meta to campaign 036. Carryover outcomes
retain their reporting date and are never reassigned to an inferred launch.

- Ordinary periods retain short month/year labels.
- 2026-10-07–2026-10-14 inclusive: **Oct Menopause**.
- 2026-10-28–2026-11-04 inclusive: **Oct/Nov VB2**, one categorical slot between
  October and November, even if only one side currently has facts.
- June 15–17 / 18–23 and August 18–19 / 20–26, 2026, remain distinct
  **Jun Private / Jun Public** and **Aug Private / Aug Public** stages. June's
  source retention/acquisition labels use the already-approved Private/Public
  display names from the business dashboard; no campaign identity is inferred.
- Out-of-window rows remain in their reporting month. A residual `Oct 2026`
  or `Nov 2026` slot excludes every row assigned to a named event; it is not a
  repeated month total. Removing it would lose carryover/out-of-window metrics.
- Empty/zero-only periods are not generated. Actual carryover-only outcomes are
  retained. Windows are explicitly 2026, not a recurring annual schedule.
- Ratios derive from summed inputs; Unknown stays in denominators. Assets are
  the unique configured-source union across the entire event's delivery-positive
  rows, including both months, not the sum of monthly unique counts. Existing
  partial/unavailable semantics and current-configuration caveats remain intact.

## Deferred future promotions

BFCM is intentionally ignored for this release, as confirmed by Tom. The
read-only authoritative calendar (`Sheet1`, gid 0, linked in README), retrieved
on 2026-10-29, contains no BFCM interval. No dates, campaign-name fallback,
future/empty slot or performance is invented. New facts outside the confirmed
windows retain their reporting month. BFCM-specific grouping is deferred until
real source data and an approved identity are available. No live private
performance was fetched or committed.

## Verification

- `node --test tests/meta-format-events.test.cjs`
- `npm test`
- `PROMO_FORMAT_QA_DIR=/tmp/glv-format-event-browser node qa/promo-creative-tab.cjs`
- Optional focused widths: `PROMO_FORMAT_QA_WIDTHS=1440,390,320`.
- `npm run verify:glv-release`

Browser fixtures are synthetic. QA covers both themes, independent history
refresh, unrelated-tab filters, schema failures/recovery, chart/table parity,
October/November boundaries, all historical stages, ordinary November data
arrival, absence of speculative BFCM slots, and narrow-screen event labels. Dependencies are cache-busted
with `promo-events-20261029`. No backend refresh or deployment is required for
local verification; production authentication remains enforced.
