import { Pool } from "pg";
import type { DrilldownRow, QueryFilters, QueryResult } from "@nymbus/shared";
import { ValidationError } from "./errors";

const PG_URL = process.env.DATABASE_URL || "postgres://nymbus:nymbus@localhost:5433/ops_dashboard";

export const pool = new Pool({ connectionString: PG_URL });

// node-postgres emits 'error' on the pool when an idle client hits a
// connection-level error (e.g. Postgres restarts or becomes unreachable).
// Without a listener here, that's an unhandled event that crashes the
// entire process - discovered by actually stopping Postgres under a live
// API instance rather than assuming query-level try/catch was sufficient.
pool.on("error", (err) => {
  console.error("[api] postgres pool error (connection will be retried on next query):", err.message);
});

function bucketSecondsFor(windowMinutes: number): number {
  if (windowMinutes <= 5) return 5;
  if (windowMinutes <= 30) return 15;
  return 60;
}

// Cheap enough to call before opening an SSE stream (or from the snapshot
// route) so an invalid request is rejected with a normal error response
// instead of getting a 200 + `event: error` frame after the fact.
export function validateFilters(filters: QueryFilters): void {
  if (filters.role === "tenant" && !filters.tenantId) {
    throw new ValidationError("tenantId is required for role=tenant");
  }
}

function buildWhere(filters: QueryFilters): { clause: string; params: unknown[] } {
  validateFilters(filters);
  const windowMinutes = filters.windowMinutes ?? 15;
  const conditions: string[] = [`event_ts > now() - interval '${windowMinutes} minutes'`];
  const params: unknown[] = [];

  // Server-side tenant scoping: a tenant-role caller is always constrained
  // to their own tenant regardless of any other value in the request. In
  // production this comes from a verified JWT claim, not a request field -
  // the prototype takes tenantId as a plain param to stand in for that claim.
  if (filters.role === "tenant") {
    params.push(filters.tenantId);
    conditions.push(`tenant_id = $${params.length}`);
  } else if (filters.tenantId) {
    params.push(filters.tenantId);
    conditions.push(`tenant_id = $${params.length}`);
  }

  if (filters.eftVendor) {
    params.push(filters.eftVendor);
    conditions.push(`eft_vendor = $${params.length}`);
  }
  if (filters.messageType) {
    params.push(filters.messageType);
    conditions.push(`message_type = $${params.length}`);
  }
  if (filters.txFamily) {
    params.push(filters.txFamily);
    conditions.push(`tx_family = $${params.length}`);
  }
  if (filters.outcomeCode) {
    params.push(filters.outcomeCode);
    conditions.push(`outcome_code = $${params.length}`);
  }
  if (filters.sourceSystem) {
    params.push(filters.sourceSystem);
    conditions.push(`source_system = $${params.length}`);
  }

  return { clause: conditions.join(" AND "), params };
}

// Every connected SSE client re-queries independently on each Redis
// notification. Without this, N clients sharing the same filters (the
// common case - most global-ops viewers have no extra filters applied)
// means N redundant round-trips to Postgres per push, every ~500ms. This
// collapses concurrent/rapid calls with an identical filter signature into
// one shared query, so DB load scales with distinct filter combinations in
// use, not with connected client count.
const QUERY_CACHE_MS = 400;
const queryCache = new Map<string, { at: number; promise: Promise<QueryResult> }>();

export async function runQuery(filters: QueryFilters): Promise<QueryResult> {
  const key = JSON.stringify(filters);
  const cached = queryCache.get(key);
  if (cached && Date.now() - cached.at < QUERY_CACHE_MS) {
    return cached.promise;
  }
  const promise = runQueryUncached(filters);
  queryCache.set(key, { at: Date.now(), promise });
  promise.catch(() => queryCache.delete(key));
  return promise;
}

async function runQueryUncached(filters: QueryFilters): Promise<QueryResult> {
  const windowMinutes = filters.windowMinutes ?? 15;
  const bucketSeconds = bucketSecondsFor(windowMinutes);
  const { clause, params } = buildWhere(filters);

  const trendSql = `
    SELECT to_timestamp(floor(extract(epoch from event_ts) / ${bucketSeconds}) * ${bucketSeconds}) AS bucket,
           count(*) AS count
    FROM tx_events
    WHERE ${clause}
    GROUP BY bucket
    ORDER BY bucket
  `;

  const outcomesSql = `
    SELECT outcome_code, count(*) AS count
    FROM tx_events
    WHERE ${clause}
    GROUP BY outcome_code
    ORDER BY count DESC
  `;

  const latencySql = `
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50,
           percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95
    FROM tx_events
    WHERE ${clause}
  `;

  const rowsSql = `
    SELECT id, event_ts, tenant_id, eft_vendor, message_type, tx_family,
           outcome_code, source_system, amount_cents, latency_ms
    FROM tx_events
    WHERE ${clause}
    ORDER BY event_ts DESC
    LIMIT 50
  `;

  const countSql = `SELECT count(*) FROM tx_events WHERE ${clause}`;

  const [trendRes, outcomesRes, latencyRes, rowsRes, countRes] = await Promise.all([
    pool.query(trendSql, params),
    pool.query(outcomesSql, params),
    pool.query(latencySql, params),
    pool.query(rowsSql, params),
    pool.query(countSql, params),
  ]);

  return {
    trend: trendRes.rows.map((r) => ({ bucket: r.bucket, count: Number(r.count) })),
    outcomes: outcomesRes.rows.map((r) => ({ outcomeCode: r.outcome_code, count: Number(r.count) })),
    latency: {
      p50: latencyRes.rows[0]?.p50 != null ? Number(latencyRes.rows[0].p50) : null,
      p95: latencyRes.rows[0]?.p95 != null ? Number(latencyRes.rows[0].p95) : null,
    },
    rows: rowsRes.rows.map(
      (r): DrilldownRow => ({
        id: Number(r.id),
        eventTs: r.event_ts,
        tenantId: r.tenant_id,
        eftVendor: r.eft_vendor,
        messageType: r.message_type,
        txFamily: r.tx_family,
        outcomeCode: r.outcome_code,
        sourceSystem: r.source_system,
        amountCents: r.amount_cents != null ? Number(r.amount_cents) : null,
        latencyMs: Number(r.latency_ms),
      }),
    ),
    totalCount: Number(countRes.rows[0]?.count ?? 0),
  };
}
