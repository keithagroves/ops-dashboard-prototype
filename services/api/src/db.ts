import { Pool } from "pg";
import {
  EFT_VENDORS,
  MESSAGE_TYPES,
  OUTCOME_CODES,
  TX_FAMILIES,
  type DrilldownRow,
  type QueryFilters,
  type QueryResult,
} from "@nymbus/shared";
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

const VALID_WINDOW_MINUTES = [5, 15, 30];

// Cheap enough to call before opening an SSE stream (or from the snapshot
// route) so an invalid request is rejected with a normal error response
// instead of getting a 200 + `event: error` frame after the fact.
//
// This originally only checked tenantId. Everything else - windowMinutes,
// eftVendor, messageType, txFamily, outcomeCode - is cast to its enum type
// in filtersFromQuery without ever being checked against the actual enum,
// so an arbitrary query string reached the SQL layer unvalidated: an
// out-of-range windowMinutes (e.g. 1e308) hit Postgres's `interval`
// arithmetic and surfaced as a 500, and an unrecognized eftVendor silently
// matched zero rows and returned 200 instead of being rejected.
export function validateFilters(filters: QueryFilters): void {
  if (filters.role === "tenant" && !filters.tenantId) {
    throw new ValidationError("tenantId is required for role=tenant");
  }
  if (filters.windowMinutes !== undefined && !VALID_WINDOW_MINUTES.includes(filters.windowMinutes)) {
    throw new ValidationError(`windowMinutes must be one of ${VALID_WINDOW_MINUTES.join(", ")}`);
  }
  if (filters.eftVendor !== undefined && !(EFT_VENDORS as readonly string[]).includes(filters.eftVendor)) {
    throw new ValidationError(`eftVendor must be one of ${EFT_VENDORS.join(", ")}`);
  }
  if (filters.messageType !== undefined && !(MESSAGE_TYPES as readonly string[]).includes(filters.messageType)) {
    throw new ValidationError(`messageType must be one of ${MESSAGE_TYPES.join(", ")}`);
  }
  if (filters.txFamily !== undefined && !(TX_FAMILIES as readonly string[]).includes(filters.txFamily)) {
    throw new ValidationError(`txFamily must be one of ${TX_FAMILIES.join(", ")}`);
  }
  if (filters.outcomeCode !== undefined && !(OUTCOME_CODES as readonly string[]).includes(filters.outcomeCode)) {
    throw new ValidationError(`outcomeCode must be one of ${OUTCOME_CODES.join(", ")}`);
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
//
// Two things the first version of this got wrong:
// - TTL was measured from when the query *started*, not when it settled.
//   A slow query (e.g. 800ms) plus a second identical call 450ms later,
//   with a 400ms TTL, saw the entry as "expired" while the first query was
//   still running - producing two concurrent queries instead of sharing
//   one. TTL now only applies to *settled* entries; a still-pending promise
//   is always shared regardless of its age.
// - The cache had no eviction, so every distinct filter combination a
//   client could construct grew the Map forever. It's now bounded with
//   simple LRU eviction (Map iteration order + re-insert-on-hit).
const QUERY_CACHE_TTL_MS = 400;
const QUERY_CACHE_MAX_ENTRIES = 200;

interface CacheEntry {
  promise: Promise<QueryResult>;
  settledAt: number | null;
}

const queryCache = new Map<string, CacheEntry>();

export async function runQuery(filters: QueryFilters): Promise<QueryResult> {
  const key = JSON.stringify(filters);
  const cached = queryCache.get(key);

  if (cached) {
    const stillFresh = cached.settledAt === null || Date.now() - cached.settledAt < QUERY_CACHE_TTL_MS;
    if (stillFresh) {
      // Move to most-recently-used position.
      queryCache.delete(key);
      queryCache.set(key, cached);
      return cached.promise;
    }
    queryCache.delete(key);
  }

  const entry: CacheEntry = { promise: undefined as unknown as Promise<QueryResult>, settledAt: null };
  entry.promise = runQueryUncached(filters);
  entry.promise.then(
    () => {
      entry.settledAt = Date.now();
    },
    () => {
      // A failed query is never worth reusing - drop it immediately so the
      // next call retries fresh instead of waiting out a TTL on a rejection.
      queryCache.delete(key);
    },
  );

  if (queryCache.size >= QUERY_CACHE_MAX_ENTRIES) {
    const oldestKey = queryCache.keys().next().value;
    if (oldestKey !== undefined) queryCache.delete(oldestKey);
  }
  queryCache.set(key, entry);

  return entry.promise;
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
