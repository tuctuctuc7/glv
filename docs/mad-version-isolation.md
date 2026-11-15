# MAD version isolation repair

Status: implementation candidate, not production-verified. Do not treat tests or this document as deployment evidence.

## Cause and baseline

- Last pre-V2 commit: `db42aa7e6d27b932c5c02853f010919cefe77e9f`.
- Initial V2 `e479f61` shared refresh execution/budget with V1. Later `e2c7eb2` routed V1 reads and date policy through the combined V2 publication.
- The same parity change removed V2's `quiet-precision.css` link and changed its chart palette. The original stylesheet survived; the repair reconnects it without rolling back newer functional controls.
- At the November 15 pre-Los-Angeles-midnight production probe, the owner reported target November 14 and `already_verified`, while its actual shared preset ranges and V2 coverage ended November 13. Completion messages did not establish requested-day availability.

## Required contracts

1. V1 owns its native published data, Prague completed-day policy, refresh receipt and budget. Enabling or failing V2 must not alter V1 availability. Preserve durable last-good history and current migrated ad-name-first creator attribution; a blind historical resolver rollback would misidentify migrated names.
2. V2 owns independent account source checkpoints/publications. Morning targets Prague yesterday and includes available TGLV data, explicitly partial before LA closes that date. Late refreshes TGLV only through LA yesterday and reuses TUC facts. No late TUC account lookup, insights, metadata, ad, or Promo extraction.
3. V2 responses disclose each account's actual range, complete-through date, extraction timestamp and partial/missing status. Never manufacture zero days, slice direct-period reach, or relabel incompatible period totals.
4. V1 and V2 retain password gates. Operator diagnostics require existing cron bearer authorization and must remain read-only; payload replay is private evidence, not authenticated live-browser evidence.
5. V2 keeps its distinct Quiet Glass design. Shared data rules do not authorize presentation rollback.

## Scheduled paths (UTC)

| Owner | Path | Primary and continuation opportunities |
|---|---|---|
| V1 | `/api/glv-meta-ads/cron` | 00:00, 01:00, 02:00, 04:00, 08:00, 12:00, 16:00, 20:00 |
| V2 morning | `/api/glv-meta-ads-v2/cron?mode=morning` | 00:05, 01:05, 02:05, 04:05 |
| V2 LA completion | `/api/glv-meta-ads-v2/cron?mode=late` | 09:05, 12:05, 16:05, 20:05 |

The later opportunities resume bounded interrupted work; they are not permission to re-extract verified account days. The LA primary completion runs after LA midnight in both DST states. Actual range calculation uses IANA zones. V1 retains its existing opportunities but verifies only its own data.

## Release gates

- Final integrated `npm test`, `npm run verify:glv-release`, browser coverage/creator/design checks, and independent exact-tree review.
- Deploy an unaliased candidate to verified `tucmedia/agenthic-lab`; retain canonical traffic until V1 and V2 readable publications are warm and verified.
- Read back all required preset/types, Promo consumers, creator completeness, source dates and account-specific hashes. Exercise normal continuation and verified reuse. Demonstrate late pass performs zero TUC source calls and preserves TUC publication hashes.
- Preserve sibling routes. After authorized canonical source publication, verify actual Vercel source/alias and registered schedules. A deployment-only repair is not durable because the daily exporter deploys canonical Git source.
- Report production execution, synthetic rollover, real-data replay and authenticated live-browser checks separately. Future scheduled execution cannot be claimed from a simulated clock.
