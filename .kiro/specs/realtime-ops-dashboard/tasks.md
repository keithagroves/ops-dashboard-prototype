# Implementation Plan

This is a retroactive task record: the prototype was built before this spec workflow was started, so every task below reflects code that already exists rather than work still to do. Each task links to the requirement(s) it satisfies and, where relevant, notes the one open gap called out in `design.md`'s Known Deviations table.

- [x] 1. Scaffold the workspace and shared event contract
  - npm workspaces monorepo (`packages/*`, `services/*`, `apps/*`) with a shared `tsconfig.base.json`.
  - `packages/shared/src/types.ts` defines `TxEvent`, `QueryFilters`, `QueryResult`, and the domain enums, imported by every other package.
  - _Requirements: 2_

- [x] 2. Provision local infrastructure
  - `docker-compose.yml`: Postgres, Kafka (KRaft mode, no Zookeeper), Redis — real infrastructure rather than in-memory stand-ins.
  - `db/init.sql`: `tx_events` table and the five indexes covering every filter dimension.
  - _Requirements: 2_

- [x] 3. Build the connector traffic generator
  - [x] 3.1 Fire-and-forget Kafka produce, never awaited on the generation loop; failed/unreachable-broker produces drop and increment a counter instead of blocking.
    - _Requirements: 1_
  - [x] 3.2 Weighted traffic distribution: hot-tenant skew (10% of tenants / 60% of traffic), message-type/tx-family/outcome-code weighting, latency distribution with occasional outliers.
    - _Requirements: 1.7, 1.8_
  - [x] 3.3 Incident-mode simulation: periodic outcome-code spike for a configured tenant, with start/clear logging.
    - _Requirements: 18_

- [x] 4. Build the Kafka-to-Postgres consumer
  - [x] 4.1 Batch consumption via `eachBatch`, multi-row insert per batch, offset commit only after a successful write.
    - _Requirements: 3_
  - [x] 4.2 Redis publish to `tx:updates` after each successful batch write.
    - _Requirements: 4.1 (partial — see design.md: no retry loop on publish failure)_
  - [x] 4.3 Periodic retention cleanup (`DELETE` on an interval ≤30s).
    - _Requirements: 16 (partial — see design.md: no zero-row logging or failure retry handling)_

- [x] 5. Build the Fastify API
  - [x] 5.1 Shared filter-builder (`filters.ts`, `db.ts`) enforcing server-side tenant scoping identically on both routes.
    - _Requirements: 5, 6_
  - [x] 5.2 `/api/query` snapshot route returning the full `QueryResult` shape.
    - _Requirements: 7, 9_
  - [x] 5.3 `/api/stream` SSE route: initial snapshot, Redis-subscription-driven push, 500ms minimum push interval, 15s keep-alive.
    - _Requirements: 8_
  - [x] 5.4 Single shared Redis subscriber per process, fanning out to all local SSE connections.
    - _Requirements: 4.3, 4.4, 17_

- [x] 6. Build the Next.js dashboard
  - [x] 6.1 `useSse` hook: opens/reopens `EventSource` on filter change, exposes connection state.
    - _Requirements: 10_
  - [x] 6.2 `FilterBar`: audience toggle, all filter selectors, tenant list, window selector, connection indicator.
    - _Requirements: 11_
  - [x] 6.3 `TrendChart`: live time-bucketed volume chart.
    - _Requirements: 12_
  - [x] 6.4 `OutcomeBreakdown`: outcome distribution with click-to-filter / click-to-toggle-off.
    - _Requirements: 13_
  - [x] 6.5 `LatencyPanel`: p50/p95/total count with null placeholders.
    - _Requirements: 14_
  - [x] 6.6 `DrilldownTable`: recent matching rows, formatted amount/latency/outcome cells.
    - _Requirements: 15_

- [x] 7. Verify end-to-end behavior against a running system
  - [x] 7.1 Confirm fire-and-forget capture: 0 dropped events at steady-state TPS.
    - _Requirements: 1_
  - [x] 7.2 Kill and restart the Consumer mid-stream; confirm resume from committed offset with no gap or duplication.
    - _Requirements: 3.3_
  - [x] 7.3 Confirm tenant-scoped enforcement via direct API calls (missing `tenantId` → 400; scoped query → only that tenant's rows).
    - _Requirements: 5_
  - [x] 7.4 Run two API instances against the same Postgres/Redis; confirm both push identical live updates from one Consumer publish.
    - _Requirements: 4, 17_
  - [x] 7.5 Enable incident mode and confirm the outcome spike is visible and drillable end-to-end in the browser.
    - _Requirements: 13, 15, 18_

- [x] 8. Document the architecture and run instructions
  - `README.md`: run instructions, demo knobs, two-instance fan-out demo, stated simplifications.
  - `notes.md`: design journey and decisions, closed-out open questions.
  - `overview.md`: generated architecture map with a source-linked diagram.
  - _Requirements: 19 (documented, not a code task — satisfied by the architecture itself never routing through external infrastructure)_

## Not started

- [ ] 9. Close the gaps listed in `design.md`'s Known Deviations table (batch-size cap, zero-fill trend buckets, outcome tie-break ordering, distinct 500-vs-400 error handling, retention failure handling, empty-state UI messages) before treating this as production-track code rather than a prototype.
- [ ] 10. Validate at production-representative scale: sustained 100–150 TPS write throughput and query latency across a full 24-hour window.
