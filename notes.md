# Take-Home Exercise Notes

## What's Being Asked

Three deliverables for a 1-hour live presentation:

1. **Executive summary** — proposed solution, alternatives considered, tradeoffs, key assumptions. Audience includes both technical and non-technical stakeholders.
2. **Working prototype** — built in an AI-powered IDE, simulates transaction traffic, demonstrates the near real-time dashboard with filtering/drill-down.
3. **Approach narrative** — how you tackled it, what AI tools you used, key decisions made. A story, not a log.

Target effort: ~5–6 hours over 2–3 days. Prototype is a thin vertical slice, not production-ready.

---

## The Business Problem

Nymbus runs a **multi-tenant payment processing platform** that authorizes debit card transactions in real time (<500ms). External EFT vendors send **ISO 8583 messages** over persistent TCP connections.

**Gap today:** Operations teams have almost no real-time insight. Metrics are point-in-time counters — no time-series view, no trend watching, no ability to slice by meaningful attributes.

**Goal:** A near real-time operational dashboard inside the existing operations console showing a **rolling 24-hour view**, refreshing a few seconds behind live, with filtering and drill-down capability.

---

## Two Audiences (Multi-Tenancy)

| Audience | What they see |
|---|---|
| Tenant admin/ops team | Activity for their institution only |
| Nymbus global ops | Platform-wide view across all tenants |

Designing the data capture and serving model for both is explicitly part of the exercise.

---

## Domain: What Flows Through the System

Each transaction is an ISO 8583 message. Key attributes to capture:

- **Message type** — auth request, reversal, advice, network-management/heartbeat
- **Transaction family** — purchase, withdrawal, deposit, transfer, payment
- **Outcome/response code** — approved, insufficient funds, exceeds limit, system/format conditions
- **Tenant (BIN)** — identifies the issuing bank/client
- **EFT Vendor / source system**
- **Amount**
- **End-to-end processing latency**
- **Timestamp**

The **connector component** (interfaces with EFT vendors, drives processing, returns responses) is the natural instrumentation point — every transaction passes through it.

---

## Technical Constraints (Hard)

- **Language/Runtime:** TypeScript on Node.js; frontend is Next.js + React
- **Data/Infra already in place:**
  - PostgreSQL (AWS Aurora)
  - Redis/Valkey cluster (ElastiCache) — already used for shared state
  - Kafka (MSK)
  - OpenTelemetry collector → Grafana (for long-term observability)
- **Deployment:** Multi-instance containers on AWS EKS, horizontal scaling; instances restart on deploy/scale/crash
- **Critical constraint:** Authorization path is latency-sensitive (<500ms). Metrics capture **must not slow it down** or create back-pressure. If metrics fail, transaction processing must be unaffected.
- **Data residency:** Transaction data must NOT go to any external or third-party SaaS for the real-time view.
- **Scope:** Rolling 24-hour view in the existing ops console. Long-term (>24h) can go to OpenTelemetry/Grafana.

---

## Volume

- Up to 50 client tenants
- Each EFT Vendor averages ~2 TPS per client bank; most active clients ~15 TPS
- Typical peak: **100–150 TPS** across all sources
- Total daily volume: **~2–3 million transactions**

---

## Architecture Thinking

### The Core Design Problem

- Fire-and-forget metrics emission from the hot path (sub-500ms auth) — can't block
- Aggregate and store time-series data efficiently for a rolling 24-hour window
- Serve filtered queries fast enough for a dashboard refreshing every few seconds
- Enforce tenant isolation at query time
- Work inside an existing TypeScript/Node.js + Postgres + Redis + Kafka stack

### Natural Architecture: Kafka-Backed Pipeline

The stack already has Kafka (MSK). This is the obvious fit:

```
Connector (hot path)
  → emit event to Kafka (async, fire-and-forget)
    → consumer service aggregates/writes to storage
      → dashboard queries storage via API
        → frontend polls or subscribes (SSE/WebSocket)
```

**Why Kafka works here:**
- Decouples the authorization path entirely — publish is non-blocking
- Handles bursts (100–150 TPS is light for Kafka)
- Already deployed; no new infrastructure needed
- Consumer can fail and recover without losing events (offset-based)

### Storage for the Rolling 24-Hour Window

Options for the read store:

**Option A: Redis (time-series with sorted sets or Redis TimeSeries)**
- Already deployed
- Very fast for pre-aggregated counters (TPS, approval rate, latency p95 per tenant)
- TTL-based expiry fits the 24-hour window naturally
- Limited query flexibility for ad-hoc drill-down
- Good fit for the "top of dashboard" summary metrics

**Option B: PostgreSQL (Aurora) with time-bucketed rows**
- Already deployed
- More flexible for filtered queries (by tenant, message type, outcome, vendor)
- Can keep 24h of data with a simple `WHERE timestamp > now() - interval '24 hours'`
- Indexed on (tenant_id, timestamp, message_type, outcome_code) supports the drill-down queries
- Write volume: 100–150 TPS sustained is fine for Postgres; aggregating into 5-second or 1-minute buckets keeps it manageable
- Better for the drill-down / filter use case

**Likely answer: both**
- Redis for the fast-path aggregates (per-tenant TPS, approval rate, latency percentiles) — serves the summary tiles on the dashboard
- Postgres for the queryable event records or minute-level aggregates — serves the filtered charts and drill-down

### Tenant Isolation

- Every event written to Kafka is tagged with `tenant_id`
- Consumer writes with `tenant_id` on every row
- API enforces tenant scoping: tenant admins get a JWT with their `tenant_id`; queries always include `WHERE tenant_id = $1`
- Global ops role can query across all tenants

### Dashboard Refresh

- Frontend polls an HTTP API every 3–5 seconds (simplest, works well at this volume)
- Or use Server-Sent Events (SSE) for push-style updates — more responsive, lower overhead than WebSocket for one-way data
- Next.js API routes serve as the BFF (Backend for Frontend)

---

## Prototype Plan

Simulate the pipeline end-to-end without real ISO 8583 parsing:

1. **Transaction simulator** — Node.js script that generates fake ISO 8583-like events at ~100 TPS, with randomized tenant, message type, outcome code, amount, latency
2. **Kafka producer** — emits events to a local Kafka topic (use Docker Compose for local dev: Kafka + Zookeeper, or Redpanda as a lightweight alternative)
3. **Consumer service** — reads from Kafka, writes aggregated metrics to Redis and/or Postgres
4. **API layer** — Next.js API routes that query the store and return filtered metrics
5. **Dashboard UI** — React components showing:
   - Rolling TPS chart (line chart, last 24h)
   - Approval rate by outcome code (bar/donut)
   - Latency distribution (p50/p95)
   - Filter controls: tenant, message type, EFT vendor, time range
   - Tenant selector for global ops view

For the prototype demo, Redpanda (single binary, Kafka-compatible) + a local Postgres or even SQLite might be the simplest local stack to avoid fighting Docker Compose complexity.

---

## Key Assumptions to State

- Metrics capture is best-effort (fire-and-forget from the auth path); a small number of events may be lost under extreme failure conditions — acceptable for operational visibility, not a source-of-truth for financial reconciliation
- Aggregation granularity: 5-second buckets for the last hour, 1-minute buckets for hours 1–24 — balances resolution and storage
- Tenant isolation is enforced server-side via JWT claims, not just by convention
- The 24-hour rolling window is the full scope; anything older flows to the existing OTel/Grafana pipeline (already there)
- The dashboard is read-only for operators — no action/approval flows in scope
- ISO 8583 field mapping to domain attributes (message type, transaction family, outcome) is a well-known problem; stub it in the prototype

---

## Alternatives to Discuss

| Approach | Why not chosen |
|---|---|
| Write directly from connector to Postgres | Synchronous write on the auth hot path; creates back-pressure and latency risk |
| OpenTelemetry metrics for the real-time view | OTel/Grafana is already used for long-term; pulling it into the product console means embedding Grafana or building a proxy — doesn't fit the "inside the ops console" requirement cleanly. Also OTel aggregation windows are typically minutes, not seconds |
| Third-party SaaS (Datadog, Mixpanel, etc.) | Explicitly excluded by constraint — banking data can't go to external SaaS |
| ClickHouse or TimescaleDB | Better fit for pure time-series at scale, but adding new infrastructure when Postgres + Redis already exist is harder to justify at 100–150 TPS |
| WebSocket for dashboard push | More complex to scale across multiple EKS instances (need sticky sessions or a pub/sub relay); SSE or polling is simpler and sufficient at this refresh rate |

---

## Evaluation Criteria Reminders

- **Design soundness** — use proven patterns, fit the constraints
- **Tradeoff reasoning** — depth and honesty about alternatives
- **AI usage** — how effectively AI was used for research and building
- **Prototype quality** — does it demonstrate and validate the idea?
- **Communication** — clear to both technical and non-technical audiences
- **Handling ambiguity** — quality of assumptions and scope decisions

---

## Decisions Made (closing out the open questions above)

- **Single store, not Redis+Postgres hybrid.** At 2-3M rows/day, Postgres alone
  serves both the trend/aggregate queries (GROUP BY / time-bucketing computed
  on read) and drill-down into raw rows. Redis's role narrowed to one thing:
  cross-instance pub/sub fan-out ("new data available") so every
  horizontally-scaled API instance knows to re-query and push to its own
  connected clients — not a second copy of the data. Reduces moving parts for
  a volume that doesn't need a second datastore.
- **Aggregation granularity: computed on read, not pre-aggregated.** Bucket
  width scales with the requested window (5s buckets under 5min, 15s under
  30min, 60s beyond) via a single parameterized query — no separate rollup
  table for the MVP. Add one later only if a real query-latency problem shows
  up; it hasn't at this volume.
- **SSE, not polling or WebSocket**, for dashboard refresh. One-way push is
  all a read-only dashboard needs; WebSocket's bidirectionality isn't used by
  anything here — filter changes are a normal HTTP-level change (client
  reopens its EventSource with new query params), not a message sent back
  over the stream.
- **Local prototype stack: real Docker Compose (Kafka in KRaft mode, Postgres,
  Redis)**, not Redpanda/SQLite. Chose fidelity to the real MSK/Aurora/
  ElastiCache stack over setup convenience, since proving the architecture
  against the real technologies is stronger evidence than proving it against
  stand-ins.
- **Charts prioritized**: TPS/volume trend, outcome-code breakdown (doubles as
  approval-rate view and the surface where an incident becomes visible),
  latency p50/p95, and a drill-down table — matches what the spec explicitly
  asks the prototype to prove (filter + drill down).
- **Tenant-switching UX**: a role toggle (Tenant view / Global ops view) in
  the filter bar. Tenant view locks the tenant selector to "logged in as
  tenant X"; global view leaves it open as an optional cross-tenant drill-down
  filter. No real auth in the prototype — this stands in for what a verified
  JWT claim would enforce in production.
