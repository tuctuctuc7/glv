# MAD history continuity (V1 and V2)

Freshness and availability are separate contracts. A failed refresh must not erase
validated older facts, convert unavailable source responses into zero metrics, or
label old totals as belonging to the requested newer interval.

## Publication

- Mutable preset keys remain extraction/continuation state and retain their
  existing names. V1 no longer sets `EX 90000`. Before any shared-run Meta/FX
  extraction, all valid V1 preset keys are `PERSIST`ed and TTL -1 is verified.
- Each preset publishes a small atomic manifest at `glv:published:<preset>` (V1)
  or `glv:mad:v2:native:1:published:<preset>` (V2). Its daily/aggregate/ads refs
  point to immutable, SHA-256-addressed native pieces under that key. Every piece
  is validated, written without expiry, and read back before the manifest moves.
  V2 continues using the bounded integrity-checked compressed transport.
- Before replacing a valid manifest, its refs are retained at `<key>:previous`.
  Readers validate digests and the complete bundle, falling back to this previous
  manifest on an invalid/unavailable current publication. Failed single-piece
  writes never move the manifest. Source timestamps are preserved.
- Existing coherent V2 generations are bootstrapped before FX/force work. V1
  migrates only valid same-range legacy pieces extracted within five minutes;
  mixed ranges or generations are not certified as a bundle. An incomplete
  pre-migration cache cannot reconstruct facts already lost before this release.
- Owner completion receipts additionally require each published manifest's exact
  digest: 25 required keys per version, including Promo (50 with both enabled).
  Individual staging-key success is not sufficient for bundle certification.
- Retirement is bounded to the exact displaced previous refs and this attempt's
  piece refs (at most six candidates per preset). After publication, a small Lua
  operation compares both raw current/previous manifests and assigns a **72-hour
  expiry only to unreferenced candidates**. It never scans or synchronously
  deletes pieces. Existing TTLs are not extended. Current/previous pieces remain
  permanent; normal verified `SET` removes any expiry when content is reused.
  Readers holding a retired manifest therefore retain its bytes throughout grace.
- The same best-effort path handles partial/uncertain writes on failure without
  expiring either retained generation. Cleanup errors never fail a valid publish.
  Publisher serialization remains the existing shared refresh-owner lease; this
  is not an independent concurrent-writer protocol or a new scheduler.
- Limits: pre-existing unreachable keys cannot be discovered without an inventory
  and are not scanned. If Redis retirement fails, those exact candidates may leak
  rather than risk deleting history; no durable retry queue is claimed. A process
  killed before its finally block can also leave orphans. Sustained successful
  operation is bounded by current/previous plus the 72-hour retirement window.

## Reader contract

The existing authenticated routes are unchanged. `range` is always the actual
returned interval. Standard stale responses include `requested_range`,
`cached_range`, `coverage_complete:false` when intervals differ, `stale:true`,
and a warning. V1 adds a shared `generation_id`; V2 keeps its existing generation
manifest. If no publication exists, both preset readers first validate the entire
legacy daily/aggregate/ads triplet. V1 requires identical ranges and extraction
spread at most five minutes, then assigns a shared deterministic content digest;
V2 requires its existing shared generation and matching native campaign facts/FX.
Individual valid pieces from an incoherent triplet are never served as legacy
history. No response clips aggregate totals to a new interval or derives unique
period reach by summing days. Browser consumers must show the actual interval and
warning and must not merge pieces from different generations.

Pending forced generations do not gate access to older published reports.
V1 cached reads do not require an available Meta token; live custom-range reads
still do. V2 account/currency/FX validation remains fail-closed. Redis itself must
be reachable to serve persisted facts; this does not claim availability during a
complete storage outage.

## Routine workload and recovery

Both campaign daily paths previously reloaded historical daily facts at every
cutoff. They now retain validated earlier days and replace the last seven
completed days, expanding backward to cover any missing gap. V2 reuses its widest
updated daily source across narrower presets; its existing ad checkpoint rollover
continues retaining older completed chunks. Source extraction provenance remains
attached to retained days. Bundle generation time is distinct from historical
extraction time. Exact-range campaign reach is still requested from Meta.

V1 still requests exact-period aggregate/ads reports; this patch does not rewrite
that producer into a full ad-day warehouse. Forced V1 refresh intent is persisted
at `glv:history:force` and normal recovery continues full preset extraction until
all V1 preset publications succeed. V2's existing force-generation rules remain
intact. Promo's existing rolling history and seven-day replacement are unchanged.

## Offline verification

`node --test tests/*history-continuity-backend.test.cjs` covers missed completed
days, source/FX/cache failure, failed one-piece replacement, corrupt publication
readback, unchanged prior bytes, same-day/next-day recovery, required manifest
receipts, malformed required metrics, and seven-day/gap replacement without
summed reach. Fixtures are generated synthetic facts only. No live cache writes,
Meta calls, commits, or deployment are performed by this suite.

Release requires integrated frontend regressions, the full repository suite,
release checks, and authorized production readbacks through the existing owner.
