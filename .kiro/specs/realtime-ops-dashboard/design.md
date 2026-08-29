# Design Document

## Overview

This document describes the design of the prototype that satisfies `requirements.md`. It covers the architecture, the components and their interfaces, the data model, error-handling behavior, the rationale behind the major design decisions, and an honest ledger of where the running prototype's behavior differs from the letter of a requirement (and why that's an acceptable prototype-scope tradeoff rather than an oversight).

## Architecture

```mermaid
flowchart LR
    Generator[Generator] -->|fire-and-forget produce| Kafka[(Kafka: tx-events)]
    Kafka --> Consumer[Consumer]
    Consumer -->|multi-row INSERT| Postgres[(Postgres: tx_events)]
    Consumer -->|PUBLISH| Redis[(Redis: tx:updates)]
    Redis -->|subscribe| API[API]
    Postgres -->|query| API
    API -->|SSE| Dashboard[Dashboard]
```

Two properties drive every choice below:

1. **The Generator never awaits Kafka.** A failed or slow produce is dropped and counted, never blocking. This is the entire mechanism behind Requirement 1 and, transitively, Requirement 19 (nothing here calls out to external infrastructure at all).
2. **Postgres is the only durable store.** Kafka exists solely to decouple the Generator from write load; Redis exists solely to fan out a "something changed" signal across horizontally-scaled API instances. Neither is a second copy of the data. This is why Requirements 2–9 all describe one query surface (`tx_events` via the API's filter-builder) rather than a store-per-read-pattern.

## Components and Interfaces

### Generator (`services/generator`)
- `config.ts` reads `TPS`, `TENANT_COUNT`, `HOT_TENANT_RATIO`, `HOT_TENANT_FRACTION`, `LATENCY_MEAN_MS`, `LATENCY_P99_MS`, and the `INCIDENT_*` variables from the environment.
- `index.ts` runs a `setInterval` loop at the configured TPS, builds a `TxEvent` (shared type), and calls the kafkajs producer's `send()` without `await`-ing it on the loop — `.then()`/`.catch()` update `sent`/`dropped` counters logged every 5s. Satisfies Requirement 1.
- Traffic shaping satisfies Requirement 1.7/1.8 directly: `hotTenantFraction` (default 0.1) and `hotTenantRatio` (default 0.6) implement the "hottest 10% of tenants get ~60% of traffic" distribution; `TPS` is operator-configurable up to and beyond 150.
- Incident mode (`maybeStartIncident`) implements Requirement 18 by tracking one active `{ tenantId, endsAt }` window and re-weighting outcome-code selection for that tenant while active.

### Consumer (`services/consumer`)
- `index.ts` subscribes to `tx-events` via kafkajs's `eachBatch`, buffers parsed events per batch, calls `insertBatch` (a single multi-row `INSERT`), then resolves offsets and commits only after the insert succeeds. Satisfies Requirement 3.
- After a successful insert, publishes to `tx:updates` via `ioredis`. Satisfies Requirement 4.1.
- A separate `setInterval` runs the retention `DELETE` every 30s (Requirement 16.2) using `RETENTION_MINUTES`.

### API (`services/api`)
- `filters.ts` — `filtersFromQuery` is the single parser both routes call, satisfying Requirement 5.5's "same filter-building logic" for both routes.
- `db.ts` — `buildWhere` enforces tenant scoping (`role=tenant` forces `tenant_id` into every query regardless of other input) and `runQuery` issues the five parallel queries (trend, outcomes, latency, rows, count) that make up `QueryResult`. Satisfies Requirements 5–7.
- `routes/query.ts` — `/api/query`, satisfies Requirement 9.
- `routes/stream.ts` — `/api/stream`, sends an initial snapshot then subscribes to `onUpdate` (from `redisSub.ts`), throttled to one push per 500ms per connection. Satisfies Requirement 8.
- `redisSub.ts` — one `ioredis` subscriber per process, fanning out to all local SSE connections via an in-process listener `Set`. Satisfies Requirement 4.3 and Requirement 17.

### Dashboard (`apps/dashboard`)
- `lib/useSse.ts` — opens an `EventSource` against `/api/stream` with the current filters serialized as query params; reopens on filter change. Satisfies Requirement 10.
- `components/FilterBar.tsx` — audience toggle, all filter selectors, connection indicator. Satisfies Requirement 11.
- `components/TrendChart.tsx`, `OutcomeBreakdown.tsx`, `LatencyPanel.tsx`, `DrilldownTable.tsx` — satisfy Requirements 12–15 respectively. `OutcomeBreakdown`'s bar-click handler toggles `outcomeCode` in the shared filter state, satisfying 13.2/13.3.

## Data Models

`tx_events` (see `db/init.sql`) is the single source of truth described in Requirement 2. `packages/shared/src/types.ts` is the TypeScript mirror of that contract (`TxEvent`, `QueryFilters`, `QueryResult`, and the enums for message type / tx family / outcome code / EFT vendor) — every service imports from this package rather than redeclaring the shape, so the three independent processes (Generator, Consumer, API) can't drift apart on what an event looks like.

## Design Decisions and Rationale

- **Single Postgres store, not a Redis/Postgres hybrid.** At the stated volume (2–3M events/day in production; far less in the demo), one indexed table serves both trend aggregation (`GROUP BY`/time-bucketing computed on read) and drill-down. A second store would mean two write paths and two things that can drift, for no query-latency benefit at this scale.
- **Kafka as a decoupling buffer, not a general message bus.** It exists to give the Generator's producer client-side batching/buffering so a slow or unreachable broker never blocks the (simulated) hot path — the one property Requirement 1 depends on.
- **Redis narrowed to pub/sub fan-out.** `tx:updates` is a signal, not a payload; every API instance re-queries Postgres itself on receipt. This is what makes Requirement 17 (horizontal scalability) true by construction rather than by extra coordination logic.
- **SSE over WebSocket or polling.** The dashboard never sends data back over the stream — filter changes reopen the connection with new query params instead. A bidirectional protocol would add reconnect/state complexity for a channel that only ever needs to push.
- **Compressed demo window (5/15/30 min) instead of a literal 24h window.** Stated explicitly in `requirements.md`'s Introduction and Requirement 6.5 — the bucketing/query mechanics are identical at either scale, so this is a demo-visibility choice, not an architectural limitation.

## Correctness Properties

Properties the running system guarantees, and the mechanism each rests on.

### Property 1: Capture never blocks or backpressures transaction processing

**Validates: Requirements 1**

The Generator's Kafka produce call is never awaited on the generation loop; a failed or slow produce is dropped and counted instead of retried inline. In-flight sends are bounded (`MAX_IN_FLIGHT`), so a degraded broker can't turn "never block" into "silently accumulate unbounded memory" instead.

### Property 2: A crash anywhere in the pipeline loses at most the in-flight batch, and never duplicates data

**Validates: Requirements 3**

Kafka offsets commit only after a successful Postgres write, so a crash before commit replays the batch on restart — and `UNIQUE (kafka_partition, kafka_offset)` plus `ON CONFLICT DO NOTHING` makes that replay idempotent rather than duplicating rows. Verified by forcing repeated consumer crashes mid-write.

### Property 3: A structurally invalid message cannot stop ingestion

**Validates: Requirements 3.5**

Every parsed message is validated against the `TxEvent` contract before it's allowed into an insert batch; invalid messages are logged with their Kafka coordinates and skipped, not retried forever.

### Property 4: Tenant isolation is enforced by the server, not requested by the client

**Validates: Requirements 5**

`role=tenant` forces `tenant_id` into every query's `WHERE` clause in one shared filter-builder used by both the snapshot and streaming routes — there is no code path where a tenant-scoped request executes without that filter.

### Property 5: No single dependency outage takes down a whole API or consumer instance

**Validates: Requirements 1, 17**

`pg.Pool` and both `ioredis` clients have `error` listeners; a lost Postgres or Redis connection is logged and recovered from on the next call, not an unhandled crash. `/ready` reports the outage; `/health` (liveness) does not conflate "a dependency is down" with "this process needs to be restarted."

### Property 6: Query load scales with distinct filter combinations, not connected client count

**Validates: Requirements 4, 17**

A 400ms result cache keyed by filter signature collapses concurrent identical requests into one Postgres query, regardless of how many SSE clients share those filters.

## Error Handling

| Failure | Behavior | Requirement |
|---|---|---|
| Kafka produce fails or broker unreachable | Generator drops the event, increments a counter, does not block | 1.2, 1.5 |
| Kafka message fails to parse | Consumer skips it, logs a warning, continues the batch | 3.5 |
| Consumer process crashes mid-batch | Restart resumes from last committed offset; the failed batch replays | 3.3 |
| Postgres insert fails | Exception propagates out of `eachBatch`; kafkajs will not have committed offsets for that batch, so it replays on the next poll | 3 (partial — see Known Deviations) |
| Redis publish fails | Logged; does not affect the already-committed Postgres write | 4.2 (partial — see Known Deviations) |
| API re-query fails during an SSE push | `event: error` frame sent to that client; connection stays open | 8.8, 17.5 |
| SSE client disconnects | Redis listener unsubscribed synchronously in the `close` handler | 8.7 |
| Tenant role with missing/empty `tenantId` | `/api/query` returns 400; `/api/stream` emits `event: error` | 5.2, 9.2 |

## Known Deviations from Requirements (Prototype Scope)

The exercise this prototype was built for explicitly does not require production-hardening or full test coverage. The items below are acceptance criteria in `requirements.md` that describe a level of hardening the current code does not implement — listed here rather than silently left inconsistent, so `tasks.md` can accurately reflect what's actually built.

| Requirement | Written behavior | Actual behavior | Why acceptable for now |
|---|---|---|---|
| 4.2 | Retry Redis publish 3 times before giving up | Single publish attempt, now wrapped so failure is logged and discarded without affecting the already-committed insert | An external audit flagged the un-wrapped version as a crash risk (see Audit Remediation below); the specific "3 attempts" figure remains unimplemented, but the actual requirement intent — a failed publish must never take down the write path — is now met |
| 3.2 | Cap batches at 1000 messages | No explicit cap set; batch size follows kafkajs's own fetch-size defaults | At demo/prototype throughput, batches never approach 1000; worth adding a real `maxBytes`/count guard before production |
| 7.2 | Empty trend buckets appear with `count: 0` | Only buckets with ≥1 matching row are returned | Minor chart-continuity gap (a flat line reads as "no data" instead of an explicit zero); straightforward to add with a `generate_series` join |
| 7.4 | Tie-break equal outcome counts by code, ascending | Ordered by count only | Cosmetic; only visible when two outcome codes have exactly equal counts |
| 8.3 | Close the SSE connection on invalid filters | Filters are now validated *before* the stream opens (400 JSON response, no SSE headers sent) rather than after | Resolved during audit remediation — this was originally a deviation, now matches the requirement more closely than the original "emit error, stay open" behavior did |
| 10.5 | Show an explicit error indicator on an unparseable SSE frame | Malformed frame is silently ignored | Low risk — the API only ever emits frames it generated itself; this matters more if the API's payload shape changes independently of the dashboard |
| 12.3, 13.4, 15.3 | Explicit "no data" empty states | Panels render an empty chart/table instead of a message | Cosmetic polish item, not a correctness gap |
| 16.3, 16.4 | Log zero-row retention cleanups; retry on cleanup failure | Fixed during audit remediation: now logs `0` explicitly and the cleanup query is wrapped in try/catch | Resolved |
| 18.5 | Missing/invalid incident env vars cause the Generator to log an error and exit | Falls back to documented defaults instead | Friendlier for demo use (a typo'd env var shouldn't kill the whole traffic generator); the stricter behavior matters more once this drives anything beyond a live demo |
| 1.6 | Dropped-event counter exposed via "existing metrics interface" | Logged to stdout every 5s; no queryable metrics endpoint | There is no real metrics interface in the prototype to attach to — this is the one criterion that's aspirational until the Generator has an actual `/metrics` surface |

`9.3` (HTTP 500 for server errors, distinct from 400) is no longer a deviation — see Audit Remediation.

None of the remaining rows affect the properties the exercise is actually evaluated on — the hot path never blocks, tenant isolation is enforced server-side, and the pipeline recovers from a mid-stream crash without data loss or duplication. All were verified live, not just asserted (see Testing Strategy).

## Audit Remediation

An external code-review pass (run against the working prototype, not against this design doc) found six real defects, all reproduced and fixed:

1. **Duplicate rows on Kafka replay** — offsets commit after the Postgres write, so a crash between "insert succeeded" and "offset committed" replays the batch; with no uniqueness constraint, replay duplicated rows (199 duplicate groups found live). Fixed with `UNIQUE (kafka_partition, kafka_offset)` on `tx_events` and `ON CONFLICT DO NOTHING` on the insert. Re-verified by forcing 5 consumer crashes mid-write: zero duplicates.
2. **Unbounded in-flight Generator sends** — a new Kafka produce started every tick with no concurrency cap, risking unbounded memory growth under broker degradation. Fixed with a `MAX_IN_FLIGHT` guard that drops immediately once hit.
3. **SSE query amplification** — every Redis notification triggered an independent 5-query Postgres round-trip per connected client, and a bug let those overlap per connection (the "in-flight" flag cleared before the query actually finished). Fixed by not clearing that flag until the query resolves, and by caching query results for 400ms per unique filter signature so clients sharing filters share one query.
4. **Poison-message halt** — a structurally invalid but JSON-parseable message (e.g. `{}`) would fail the insert, throw before any offset resolved, and repeat forever. Fixed with `validate.ts`, which checks every field against the `TxEvent` contract before a record is allowed into the insert batch; invalid messages are logged (with topic/partition/offset) and skipped instead.
5. **`/health` couldn't detect an outage; every error was a 400** — fixed with a real `/ready` check (pings Postgres and Redis, 503 if either fails) and a `ValidationError` type so genuine server errors return 500.
6. **Unhandled `error` events could crash the whole process** — found while re-testing #5: `pg.Pool` and the `ioredis` clients are `EventEmitter`s that throw and crash the process on an unhandled `'error'` event. Neither the API's nor the consumer's Postgres pool, nor either service's Redis client, had a listener. Discovered by actually stopping Postgres under a live API instance (it died) rather than by code inspection. All four now have listeners; re-verified by restarting Postgres under both live processes with no crash.

None of this was found by reading the code more carefully — it came from adversarial testing against the running system (crash loops, killing dependencies mid-request, feeding it malformed input), which is the same verification philosophy the Testing Strategy section describes.

## Testing Strategy

This prototype was verified by driving the running system rather than by an automated test suite (consistent with the exercise's "thin vertical slice" framing). What was actually exercised:

- **Fire-and-forget capture (Req 1):** confirmed via the Generator's `sent`/`dropped` log line under normal operation (0 dropped at steady TPS).
- **Batched ingestion and crash recovery (Req 3):** killed the Consumer process mid-stream, confirmed the Postgres row count stalled, restarted it, confirmed `kafka-consumer-groups.sh --describe` showed lag return to 0 with no gap or duplicate rows.
- **Tenant-scoped enforcement (Req 5):** `curl` against `/api/query?role=tenant` with no `tenantId` returned 400; scoped to a specific tenant returned only that tenant's rows.
- **Multi-instance fan-out (Req 4, 17):** ran two API instances on different ports against the same Postgres/Redis; confirmed both independently pushed live, identical-shape updates to two separate SSE connections from one Consumer publish.
- **Incident mode and drill-down (Req 18, 13, 15):** enabled `INCIDENT_MODE`, watched the injected outcome spike appear in the browser's trend chart when filtered to the affected tenant, and confirmed the exact matching rows appeared in the drill-down table.
- **Filter/drill-down UI (Req 11–15):** exercised the audience toggle, tenant/vendor/outcome selectors, and outcome-bar click-to-filter live in a browser via the FilterBar and OutcomeBreakdown components.

Not yet verified at production-representative scale: sustained write throughput at the full 100–150 TPS peak, and query latency across a genuinely full 24-hour window rather than the compressed demo window.
