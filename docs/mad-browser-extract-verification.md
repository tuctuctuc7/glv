# Browser extract-first verification (local synthetic)

Candidate based on `b0d72da`; no commit, push, refresh of live sources, or deployment performed.

## RED before implementation

`qa/mad-browser-extract.cjs` exercised actual authenticated handler code over seeded immutable publications, with all upstream Meta/FX blocked. Last30 → November 19–24 made **5 data requests and showed the full loading overlay in all four V1/V2 × 1440/390 cases**. Baseline evidence: `/home/tom/.hermes/cache/scratch/mad-extract-baseline.log`.

A second RED held optional ads for 2.5 seconds and failed `campaigns must paint before delayed ads`. Additional unit REDs covered absent native creative daily facts, null coverage accidentally promoted to complete, null reach becoming zero in Leadgen aggregation, distinct creative Ghost identity, and generationless extract admission.

## Final verification

- `npm test`: **659 tests, 658 passed, 1 existing skip, 0 failures**.
- `npm run verify:glv-release`: PASS.
- `MAD_SCALE=100 node qa/mad-browser-extract.cjs`: PASS.
- `HOLD_ADS=1 node qa/mad-browser-extract.cjs`: PASS.
- `node qa/mad-custom-range.cjs`: PASS (existing actual-handler cold/reload/transition acceptance).
- `git diff --check`: PASS.

The worktree uses the already installed test dependencies via `NODE_PATH=/home/tom/glv-mad-custom-range-fix/node_modules`; no new dependency was installed. One intermediate broad run hit the preexisting one-millisecond deadline-sensitive Promo test (`0` rather than `1` initial calls); unchanged final broad runs passed.

## Scaled measurements

100 campaigns per account, 30 initial days: V1 has 3,000 campaign/day facts and V2 has 6,000 across accounts. The selected CZSK six-day range contains 600 facts and exactly 1,200 leads. Tests also assert painted orange chart pixels, source warnings, null period reach/frequency, exact reach restoration, explicit None preservation, and zero upstream calls/writes. Browser clock advances six minutes beyond initial load before interactions.

Filter-to-render measurements include two animation frames after applying the range, not Playwright click setup. All warm/exact/reuse selections made **zero data requests**; no full loading overlay appeared.

| Version | Viewport | Exact return | Warm six days | Back after outside | Outside reuse |
|---|---:|---:|---:|---:|---:|
| V1 | 1440 | 50 ms | 41 ms | 41 ms | 30 ms |
| V1 | 390 | 58 ms | 30 ms | 41 ms | 40 ms |
| V2 | 1440 | 97 ms | 54 ms | 65 ms | 53 ms |
| V2 | 390 | 83 ms | 55 ms | 55 ms | 61 ms |

First outside coverage requests made five data requests including optional sources. V1 took 286/251 ms; V2 took 6,757/6,366 ms because its existing cold projection reader validates wider publications. Returning to those outside ranges made zero requests. These numbers are local synthetic timings, not production promises.

Final parent-run reports: `/home/tom/.hermes/cache/scratch/glv-extract-final-scaled.log`, `glv-extract-final-delay.log`, `glv-extract-final-custom.log`, and `glv-extract-final-suite.log`. Delayed-detail screenshots: `.extract-browser/`; existing custom acceptance: `.custom-range-browser/`. Generated evidence directories are not source files and must not be staged accidentally.

## Review corrections verified

- Actual scheduled/custom handlers now omit all daily creative rows above the combined size cap, never retain the first account's rows under All-account coverage. Tested two individually small accounts exceeding the combined cap, and individually oversized accounts. Scaled browser expects unavailable derived creative detail rather than accepting partial TUC-only data.
- Manual refresh does not join old-generation creatives to new campaigns; both fallback paths explicitly require generation equality and strict range validation.
- Deferred completion rebuilds only creative filter options and labels, preserving explicit None and existing selections. Browser fixture includes Leadgen to make the dropdown population observable.
- Valid superseded detail may attach only to its existing original-generation window, without replacing the visible selection. Refresh epochs fence old pending completions, and late attachments cannot resurrect evicted windows.
- A successful oversized replacement invalidates old extract windows instead of allowing subsequent zooms to revert to stale data. Rejected/failed refreshes still preserve valid prior availability.

Parent observed failing regressions before these corrections, then passing full suite, scaled browser, delayed-detail browser, existing custom browser and production build. No authenticated live evidence is implied.

## Explicit boundaries

- Session data is bounded to four coherent windows and 64 MiB of serialized UTF-16 size; this is not a total browser heap cap. Oversized facts or eviction can require later requests.
- Optional V2 daily creative attachment is omitted above 2 MiB. Exact creatives remain available; derived creatives honestly report unavailable when daily facts were not retained. V1 period-only creatives are never sliced.
- Global date controls use the extract. Independent WL date/report loading and Promo history remain separate products. Account/currency changes retain existing isolated-document navigation; the extract does not perform FX conversion or survive reload.
- New measured browser matrix is All/CZK at 1440/390. Existing account/currency, coverage, freshness, creator, and generation tests pass; this is not a new exhaustive six-scope live-browser parity certification.
- All campaign panels are rerendered from current arrays; no lazy panel architecture was introduced.
- Protected live browser access was unavailable and was not simulated as live evidence. Production source packaging, protected API/browser readback, and deployment remain release-owner gates.
