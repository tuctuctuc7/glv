# Shared-parity acceptance protocol

Run from `/home/tom/glv-mad-shared-parity` with `NODE_PATH=/home/tom/.openclaw/workspace/dashboard/glv/node_modules`:

```sh
node --test tests/*.test.cjs tests/mad-shared-acceptance-contracts.cjs
node qa/mad-full-parity.cjs
node tests/mad-shared-ui-browser.cjs
node qa/mad-shared-acceptance.cjs
node qa/mad-production-ownership-repro.cjs
```

The last command is a separate production-boundary regression, not included in a synthetic fixture PASS: actual V1 `normalizeCampaign` must deliver trustworthy account ownership before the actual browser normalizer can retain an unknown-prefix campaign. A failure is a backend contract blocker; never fix it by granting ownership from the disputed campaign name.

## Scope and evidence

- Both real HTML entrypoints must load exactly one common owner for `renderTab`, `renderKPIs`, `refreshChart`, `renderDailyTable`, and `renderLeadgenTable`. Source-extraction tests load shared modules and their real dependencies instead of requiring obsolete inline text.
- The default acceptance HTTP adapter now executes both actual API handlers, including cookie authorization, scope validation and cache routing, against in-memory Redis. Scheduled/custom fixture publications use `shared.compose/save`; Promo uses `shared-promo.save/readRender`, never the legacy response shortcut. Custom fixtures are prepublished into the real bounded custom slots: this is a custom-cache-hit browser test, not cold Meta extraction/lease coverage. Every non-fake-Redis Node network destination is denied. Real Redis, Meta, FX, login issuance and Vercel static-route middleware remain outside this offline test. Publication hashes and handler readbacks are recorded; this is not production freshness proof.
- `tests/mad-review-ui-cutoff.cjs` reproduces the original 01:00 UTC freshness rejection and guards exact requested-range validation, undeclared legacy behavior, historical selection and 90/91-day limits. V1 learns shared mode only from a successfully validated server `shared_generation_id` contract, recomputes canonical timezone dates rather than trusting the returned range, and never reads a browser environment flag.
- `tests/mad-review-ui-browser.cjs` and the expanded acceptance tail run real browser clocks across Prague and Los Angeles midnight, focus-triggered rollover, actual handler stale publications, failed reads, cold stale reload and recovery via the Refresh control. Assert real chart/table data, labels and retained ranges. Both main and WL custom controls accept a historical 90-day range and reject 91 days. Periodic interval timing itself is not simulated; RAF/timers remain real.
- `MAD_SHARED_TRANSPORT=legacy` explicitly selects the independent static fixture transport and labels the report **not shared-publication proof**. `MAD_ACCEPTANCE_PHASE=visual|controls|tail` and optional `MAD_CONTROLS_TAB` / `MAD_VISUAL_TAB` are diagnostic subsets, recorded as partial runs, not full acceptance.
- The original broad harness retains its checks and adds account-owned wrong-prefix retention. Fixture ownership is copied from the actual production account renderer after account validation. A separate negative test rejects unknown-prefix rows without ownership. This verifies the fixture's provenance but does not establish that V1 producers supply the same field; that boundary has its own repro above.
- Currency/account extensions use independent daily monetary conversion expectations and exact entity/nonmonetary population checks. `All` must be the account-qualified union, including colliding raw IDs. Native CZK ghost visibility is checked independently of display currency.

## Browser conditions and allowed differences

1. Freeze Date with `clock.setFixedTime`; do not freeze RAF or timer execution. Wait for document readiness, fonts and Chart.js resize processing.
2. Navigate actual currency/account controls with a URL/navigation wait before inspecting the new document. Nine recorded reloads verify document replacement and persisted date/sort/Leadgen/tab controls. The option matrix exercises both Leadgen inclusion states × both table modes, all enabled visible select options, and sort directions. Select equivalent campaign identities separately in each route; V2 options are account-qualified.
3. Compare panel semantics and computed typography/geometry **before** capture adjustments. Move only the panel's screenshot origin to the same integer document position, keep the original viewport, avoid sticky header occlusion, and rebuild offscreen table paint layers after moving the origin. Restore the margin after capture. Never change font, precision, numeric values or production styles to obtain matching images. Enlarging the viewport changes `vh`-based table geometry and is not equivalent QA.
4. Full headers remain intact and receive separate containment, center hit-testing, account/currency-control visibility, mobile date-disclosure checks and screenshots. Whole-header pixel equality is not asserted because V2 has approved scope controls.
5. The only text substitutions allowed are the exact WL status phrase `Account-local dates` ↔ `Europe/Prague` between unchanged CZK/freshness fields, and the exact methodology sentence describing account-local labels/shared scheduling versus Prague/daily scheduling. The status phrase is aligned only for the corresponding panel screenshot; other content remains untouched. Account-qualified ID prefixes are canonicalized only for TUC-to-TUC comparisons. No numeric tolerance, arbitrary sorting, dropped rows or broad text/style normalization is permitted.
6. After account changes reconcile account-local selections, explicitly establish equal selections before resuming same-population comparisons. A legitimate retained `None` selection is not a numeric parity defect.

## Immutable gates

The frontend lane hashes every asset under both dashboard directories and every `qa/mad-*.cjs` dependency before/after the run; changes fail `candidate-stability`. All backend library/handler hashes are tracked separately as `readerChanged`, because the backend lane may still be working. Any reader change invalidates a **combined final-artifact** claim even if frontend assertions pass. The coordinator must run final acceptance with both lanes frozen.

Evidence directories are configured by `MAD_PARITY_EVIDENCE`, `MAD_UI_EVIDENCE`, and `MAD_SHARED_EVIDENCE`. Integration receipts for this work live under `/home/tom/.hermes/cache/scratch/mad-final-frontend/`. Require zero failed checks, zero harness blockers, zero page errors, no partial phase, 28 exact panel-image comparisons, nine actual reloads, and unchanged frontend hashes. Do not equate a zero exit from a subset or a successful publication adapter with deployed/live acceptance.
