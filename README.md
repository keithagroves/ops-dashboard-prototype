# Nymbus Real-Time Ops Dashboard — Prototype

Thin vertical slice for the Architect take-home exercise. Simulates ISO 8583-style
transaction traffic, captures metrics from it without touching the (simulated)
authorization hot path, and drives a near-real-time, filterable, multi-tenant
operations dashboard. See `Architect - Take-Home Exercise Final.pdf` for the spec
and `notes.md` for the design journey/decisions.

## Architecture

```
generator (connector simulator)
  --fire-and-forget produce-->  Kafka (tx-events)
                                    |
                                    v
                          consumer (eachBatch, batched insert)
                                    |
                          +---------+---------+
                          v                   v
                    Postgres (tx_events)   Redis (pub/sub: "new data")
                          ^                   |
                          |                   v
                    API (Fastify) <---- re-query on publish ----+
                          |
                          v  SSE
                    Next.js dashboard
```

- **generator** never awaits its Kafka produce call — a failed/slow produce is
  dropped and counted, never blocks. This is the literal stand-in for "metrics
  capture must not slow down or backpressure the auth path."
- **consumer** batches Kafka messages into multi-row Postgres inserts and
  publishes a lightweight "new data" notice to Redis after each write.
- **Postgres** is the only data store — source of truth for both trend
  aggregation (GROUP BY/time-bucketing on read) and raw drill-down. At this
  volume (2-3M rows/day in production, far less in the demo) a second store
  isn't earning its complexity.
- **Redis** is used narrowly as a cross-instance pub/sub fan-out signal so
  every horizontally-scaled API instance knows to re-query and push to its
  own connected dashboard clients — not as a second copy of the data.
- **API** streams updates over SSE (one-way push is all a read-only dashboard
  needs); filter changes just reopen the EventSource with new query params.
- **Multi-tenancy**: every row carries `tenant_id`; the API enforces
  tenant-scoping server-side. The prototype takes `role`/`tenantId` as request
  params standing in for a verified JWT claim in production.

## Running it

Prereqs: Docker Desktop running, Node 20+.

```bash
npm install
npm run infra:up        # postgres (5433), kafka (9092), redis (6379)

npm run dev:generator   # terminal 1 — simulated connector traffic
npm run dev:consumer    # terminal 2 — Kafka -> Postgres, + Redis publish
npm run dev:api         # terminal 3 — Fastify API on :4000
npm run dev:dashboard   # terminal 4 — Next.js on :3000 (or next free port)
```

Then open the dashboard URL Next.js prints.

### Demo knobs (env vars on the generator)

- `TPS` (default 30) — event rate. Real platform peak is 100-150 TPS; kept
  lower here to stay laptop-friendly. The pipeline's per-message cost doesn't
  change with volume, only batch sizes/timers would be tuned.
- `INCIDENT_MODE=true INCIDENT_TENANT_INDEX=1 INCIDENT_INTERVAL_SEC=15 INCIDENT_DURATION_SEC=8`
  — periodically spikes a specific outcome code for a specific tenant, so the
  "approval rate dips, filter into it, see why" drill-down story has something
  real to find. Verified live: filtering to the affected tenant + outcome code
  shows a clear spike in the trend chart and the exact matching rows.

### Two-instance fan-out demo

To make the Redis pub/sub cross-instance story concrete rather than asserted,
start a second API instance and point a second browser tab at it via a
`?api=<port>` override (`lib/queryUrl.ts`):

```bash
PORT=4001 npm run dev:api    # second Fastify instance, same Postgres/Redis
```

Then open `http://localhost:3000` (instance 1, default) and
`http://localhost:3000/?api=4001` (instance 2) side by side. Both update live
and in sync from the same underlying data — two independent processes, each
with its own Redis subscriber, each reacting to the same publish from the
consumer. This is exactly the mechanism that makes it correct when the API is
horizontally scaled across EKS pods.

### Verifying resilience

Kill the consumer process (`Ctrl+C` or `pkill -f services/consumer`) while the
generator keeps running, then restart it. Postgres row count stalls while it's
down and resumes from the last committed Kafka offset with no gap or
duplication — confirmed during build (`docker exec ... kafka-consumer-groups.sh
--describe --group tx-consumer-group` shows lag return to ~0).

## Known simplifications (stated on purpose, not gaps)

- No real ISO 8583 parsing — synthetic event generation stands in, per the
  exercise's own instructions.
- No authentication — tenant scoping is enforced against a request parameter
  instead of a verified JWT claim.
- Demo window is compressed to minutes, not a literal rolling 24h — same
  bucketing/query mechanics apply at either scale (see the caption on the
  dashboard itself).
- Single unpartitioned Postgres table with a periodic `DELETE` for retention,
  instead of production's hourly partitions dropped for O(1) cleanup — not
  worth the setup cost for a table that never gets big during a demo.
- `generator`/`consumer`/`api` run as local Node processes against dockerized
  infra, not as containers — faster iteration loop; production runs these as
  independently deployed/scaled EKS containers.
- Filter changes reopen the SSE connection rather than tracking per-connection
  filter state server-side — simpler, same user-visible behavior.
