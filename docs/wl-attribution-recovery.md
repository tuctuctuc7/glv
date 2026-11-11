# WL attribution recovery

Campaign availability and creator-source completeness are separate contracts. The V1 API `cachedPayloadUsable` and V2 `renderSnapshot` deliberately continue accepting valid campaign metrics with an explicit creator-source issue: making these readers reject gaps would remove available history. The refresh owner must not certify those gaps as complete.

## Causal paths

- `campaignFacts` fetches campaign insights, then separate ad insights. A child failure preserves campaign metrics with `creator_rows: []` and `creator_issue`.
- V1's seven-day replacement previously retained older issue rows indefinitely. V2 has the same retained-history problem, plus same-cutoff per-piece reuse before extraction. The shared owner previously accepted a success receipt without checking creator completeness.
- V1 and V2 do **not** share the same production snapshot: V1 uses exact-range campaign aggregates and its own daily cache; V2 derives aggregates from native account-local daily snapshots, converts daily money, namespaces IDs and reuses independently checkpointed pieces. Consequently a healthy V1 selection is not proof that V2's corresponding snapshot is healthy.
- The browser rules are aligned. Missing source facts previously generated naming instructions in both entrypoints. The synthetic differential browser test injects identical source gaps and repaired mixed-creator facts through both actual normalizers; V2 additionally uses the native source renderer for USD and CZK. This establishes consumer parity, **not** a reproduction of the user's authenticated production screenshot. Internal V1 `creatorIssues` receipts are not evidence of a V1-visible warning.

## Recovery behavior

Normal shared refresh repairs retained missing dates using campaign-filtered child-only insights; it does not re-fetch historical campaign metrics or force all Promo history. Same-scope successful ads can repair V1 aggregate attribution and V2 daily attribution (within each validated account). Period ads never populate daily rows. Existing ad-first resolver and partnership eligibility are unchanged.

A failed repair retains complete previous splits and timestamps rather than relabelling them fresh. Initially incomplete campaign data remains publishable/readable, but produces incomplete refresh status and future recovery opportunities. `creator_completeness_version: 1` invalidates pre-fix success receipts once, without `full_history=1`. V2 summaries expose `creator_complete` and `creator_unavailable_rows`; V1 pieces expose `creator_complete`. Source timestamps are retained, and child-only repairs record `creator_source_generated_at` separately.

Existing immutable publication, previous-bundle retention, completed-day ranges, seven-day metric replacement, signed Ghosts, exact campaign reach, account identity and FX validators remain in force. No Meta mutations or eligibility inference from names are introduced.

## Release verification

Run `npm test`, `npm run verify:glv-release`, and `qa/creator-ghost.cjs` with and without `GLV_QA_V2=1`. The latter now includes source-gap warning versus naming-warning assertions, recovery and a mixed-creator split using identical facts, with V2 USD/CZK conversion. Existing Ghost keyboard/touch and signed residual checks remain.

After an independently reviewed release, invoke the **normal** shared owner; check creator completeness separately for both versions and read the exact authenticated user selection. A subsequent `already_verified` is valid only after completeness was certified. No live deployment or refresh was performed by this implementation task.
