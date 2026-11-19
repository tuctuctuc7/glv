# V2 invocation-scoped Redis bandwidth optimization

Local candidate based on origin/main `2bd2553a97a25b44c39b14fc3b0f5a374b7d100f`. No deployment, production refresh/audit, storage migration, deletion, commit or push performed.

## Scope and safety

`refresh()` creates a fresh transport wrapper per invocation. Only isolated V2 immutable `:piece:<type>:<sha256>` GETs qualify. Successful values must decode and match their content-addressed SHA-256 before retention. The wrapper keeps raw encoded strings, not mutable decoded objects. Existing publication digest, reference, bundle, account, range and currency validations still run unchanged at each consumer.

Manifests/current/previous pointers, work, checkpoints, intents and leases are never memoized. Missing, malformed, hash-mismatched and failed results are not retained. Exact pending GETs coalesce. Retained encoded values are limited to 32 MiB per invocation; over-budget values simply bypass retention. This is a retained-value budget, not a bound on total process memory or concurrent in-flight transport responses.

SET invalidates its key both before and after completion, including failure. This preserves actual remote SET→GET→TTL verification and fences delayed GETs racing writes. Other commands except read-only TTL conservatively clear the scope before and after execution; this includes lease-release/retirement scripts. No scope survives a refresh, and no process-wide/browser/API-request cache was introduced.

## Deterministic regression

`tests/mad-v2-bandwidth.test.cjs` exercises the real isolated refresh, publication, compression and readback path against instrumented in-memory Redis. It fixes time and intent IDs, seeds both accounts, then repeats the same warm last_7d refresh and asserts unchanged publication data. Snapshot rows are empty with a large synthetic padding field to exercise gzip transport; this is a transfer-amplification fixture, not a production-size or source-extraction benchmark. Existing nonzero direct-observation/source/handler tests cover reporting semantics.

The regression was run and failed before implementation at **48 immutable GETs**, versus its limit of 24. After implementation:

| Measured transport values | Baseline | Candidate |
|---|---:|---:|
| Immutable piece GET count | 48 | 24 |
| Immutable piece GET value bytes | 62,836 | 31,418 |
| All GET value bytes | 83,514 | 52,096 |
| All SET value bytes | 14,903 | 14,903 |

Immutable-read traffic decreases 50%; all GET value bytes decrease 37.62%; GET+SET value bytes decrease 31.92%. Values exclude command keys, HTTP/JSON framing, TLS and Redis-internal script traffic. These are not provider-billing measurements or a prediction of monthly savings. An offline identity-wrapper control reproduces the original counts and fails the regression; the ordinary wrapper passes.

Safety regressions exercise concurrent coalescing, independent scopes, decoded-object mutation, mutable-key bypass, negative/error retry, byte-cap bypass, pre-write/in-flight SET races, fresh manifest switches, previous-generation fallback after corruption, foreign-account references and schema validation on every reuse.

## Verification and remaining work

- Focused integration suite passed (40 tests before the additional write-race regression); all seven new tests pass in the final candidate.
- Full `npm test`: 623 passed, one skipped, zero failed.
- `npm run verify:glv-release`: passed.
- `git diff --check`: passed.
- Installed declared dependencies using `npm ci --ignore-scripts`; the initial focused run's missing playwright-core setup failure was resolved.

No live Redis, browser QA, production packaging or independent review was performed. Deployment and recovery remain with the parent. V1, normal reader HTTP traffic, cross-request triplet reuse, standalone operator readback, write-volume reduction and storage-retirement policy are deliberately unchanged. The existing three-reader/full-bundle amplification remains a separate optimization opportunity. This change reduces bandwidth, not retained Redis storage size.
