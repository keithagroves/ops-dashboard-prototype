import { Pool } from "pg";
import {
  EFT_VENDORS,
  MESSAGE_TYPES,
  OUTCOME_CODES,
  TX_FAMILIES,
  tenantIds,
  type DrilldownRow,
  type QueryFilters,
  type QueryResult,
  type TenantHealthPoint,
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
  validateEnumSet("eftVendor", filters.eftVendor, EFT_VENDORS);
  validateEnumSet("messageType", filters.messageType, MESSAGE_TYPES);
  validateEnumSet("txFamily", filters.txFamily, TX_FAMILIES);
  validateEnumSet("outcomeCode", filters.outcomeCode, OUTCOME_CODES);
}

// An empty array is rejected rather than ignored. `?eftVendor=` with no value
// is far more likely to be a client bug than a request to match everything,
// and treating it as "no constraint" would silently widen the result set.
function validateEnumSet(name: string, values: readonly string[] | undefined, allowed: readonly string[]): void {
  if (values === undefined) return;
  if (!Array.isArray(values) || values.length === 0) {
    throw new ValidationError(`${name} must list at least one of ${allowed.join(", ")}`);
  }
  for (const value of values) {
    if (!allowed.includes(value)) {
      throw new ValidationError(`${name} must be one of ${allowed.join(", ")}`);
    }
  }
}

// Exported for tests: the tenant-scoping rules below are the security
// boundary of this service, and asserting them directly is worth more than
// inferring them from a query result.
export function buildWhere(
  filters: QueryFilters,
  opts: { window?: "current" | "previous" } = {},
): { clause: string; params: unknown[] } {
  validateFilters(filters);
  // windowMinutes is validated against a fixed allow-list above, so it is
  // safe to interpolate into the interval literal here.
  const windowMinutes = filters.windowMinutes ?? 15;
  const conditions: string[] =
    opts.window === "previous"
      ? [
          `event_ts > now() - interval '${windowMinutes * 2} minutes'`,
          `event_ts <= now() - interval '${windowMinutes} minutes'`,
        ]
      : [`event_ts > now() - interval '${windowMinutes} minutes'`];
  const params: unknown[] = [];

  // Server-side tenant scoping: a tenant-role caller is always constrained
  // to the tenant in its verified JWT, regardless of any other value in the
  // request. The prototype's identity directory is synthetic, but the claim
  // verification and query enforcement are real.
  if (filters.role === "tenant") {
    params.push(filters.tenantId);
    conditions.push(`tenant_id = $${params.length}`);
  } else if (filters.tenantId) {
    params.push(filters.tenantId);
    conditions.push(`tenant_id = $${params.length}`);
  }

  // `= ANY($n::text[])` rather than an expanded `IN ($1,$2,...)`: one
  // placeholder per filter regardless of how many values it carries, so the
  // parameter numbering stays trivially correct as filters come and go, and
  // the plan is not recompiled for every distinct selection size.
  const anyOf = (column: string, values: readonly string[] | undefined) => {
    if (!values || values.length === 0) return;
    params.push([...values]);
    conditions.push(`${column} = ANY($${params.length}::text[])`);
  };

  anyOf("eft_vendor", filters.eftVendor);
  anyOf("message_type", filters.messageType);
  anyOf("tx_family", filters.txFamily);
  anyOf("outcome_code", filters.outcomeCode);

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

// The tenant navigator answers a platform question ("which institution needs
// attention?") rather than a detail-panel question ("show vendor-a rows").
// Keying this small cache only by window keeps vendor/type/outcome changes
// from re-running and reordering the navigator, while still refreshing it on
// a short independent cadence.
const TENANT_HEALTH_CACHE_TTL_MS = 2_000;
interface TenantHealthCacheEntry {
  promise: Promise<TenantHealthPoint[]>;
  settledAt: number | null;
}
const tenantHealthCache = new Map<number, TenantHealthCacheEntry>();

const nullableNumber = (value: unknown): number | null => (value != null ? Number(value) : null);
const approvalRate = (approved: unknown, total: unknown): number | null => {
  const count = Number(total);
  return count > 0 ? Number(approved) / count : null;
};

async function queryTenantHealth(windowMinutes: number): Promise<TenantHealthPoint[]> {
  const result = await pool.query(`
    SELECT tenant_id,
           count(*) AS total,
           count(*) FILTER (WHERE outcome_code = 'approved') AS approved,
           percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95
    FROM tx_events
    WHERE event_ts > now() - interval '${windowMinutes} minutes'
    GROUP BY tenant_id
  `);
  const byTenant = new Map(
    result.rows.map((row) => [
      String(row.tenant_id),
      {
        tenantId: String(row.tenant_id),
        count: Number(row.total),
        approvalRate: approvalRate(row.approved, row.total),
        p95: nullableNumber(row.p95),
      },
    ]),
  );
  return tenantIds(50).map(
    (tenantId) => byTenant.get(tenantId) ?? { tenantId, count: 0, approvalRate: null, p95: null },
  );
}

function runTenantHealth(windowMinutes: number): Promise<TenantHealthPoint[]> {
  const cached = tenantHealthCache.get(windowMinutes);
  if (cached && (cached.settledAt === null || Date.now() - cached.settledAt < TENANT_HEALTH_CACHE_TTL_MS)) {
    return cached.promise;
  }
  if (cached) tenantHealthCache.delete(windowMinutes);

  const entry: TenantHealthCacheEntry = { promise: undefined as unknown as Promise<TenantHealthPoint[]>, settledAt: null };
  entry.promise = queryTenantHealth(windowMinutes);
  entry.promise.then(
    () => {
      entry.settledAt = Date.now();
    },
    () => tenantHealthCache.delete(windowMinutes),
  );
  tenantHealthCache.set(windowMinutes, entry);
  return entry.promise;
}

export async function runQuery(filters: QueryFilters): Promise<QueryResult> {
  // Validate before computing a cache key. Besides failing fast, this avoids
  // malformed numeric values such as NaN being normalized to `null` by
  // JSON.stringify and sharing a cache entry with a different request.
  validateFilters(filters);
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
           count(*) AS count,
           percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95
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
    ORDER BY count DESC, outcome_code ASC
  `;

  const rowsSql = `
    SELECT id, event_ts, tenant_id, eft_vendor, message_type, tx_family,
           outcome_code, source_system, amount_cents, latency_ms
    FROM tx_events
    WHERE ${clause}
    ORDER BY event_ts DESC
    LIMIT 50
  `;

  // Current and previous aggregates share one statement. This replaces the
  // former latency, count and previous-window queries, reducing a global
  // refresh from seven pool acquisitions to five while keeping the response
  // shape and period comparison exact.
  const prev = buildWhere(filters, { window: "previous" });
  const shiftPlaceholders = (sql: string, offset: number) =>
    sql.replace(/\$(\d+)/g, (_match, n: string) => `$${Number(n) + offset}`);
  const shiftedPrevClause = shiftPlaceholders(prev.clause, params.length);
  const statsSql = `
    SELECT 'current'::text AS period,
           count(*) AS total,
           count(*) FILTER (WHERE outcome_code = 'approved') AS approved,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50,
           percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95
    FROM tx_events
    WHERE ${clause}
    UNION ALL
    SELECT 'previous'::text AS period,
           count(*) AS total,
           count(*) FILTER (WHERE outcome_code = 'approved') AS approved,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50,
           percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95
    FROM tx_events
    WHERE ${shiftedPrevClause}
  `;

  // Cross-tenant health is platform navigation context. It intentionally
  // follows only the selected time window, not detail filters or the current
  // tenant drill-down; otherwise changing vendor makes the tenant navigator
  // disappear, reorder, and run another aggregate query. Tenant callers never
  // receive it, so this cannot widen a tenant-scoped session.
  const wantTenants = filters.role === "global";

  const [trendRes, outcomesRes, rowsRes, statsRes, tenants] = await Promise.all([
    pool.query(trendSql, params),
    pool.query(outcomesSql, params),
    pool.query(rowsSql, params),
    pool.query(statsSql, [...params, ...prev.params]),
    wantTenants ? runTenantHealth(windowMinutes) : Promise.resolve([] as TenantHealthPoint[]),
  ]);

  const currentRow = statsRes.rows.find((r) => r.period === "current") ?? {};
  const prevRow = statsRes.rows.find((r) => r.period === "previous") ?? {};

  return {
    trend: trendRes.rows.map((r) => ({ bucket: r.bucket, count: Number(r.count), p95: nullableNumber(r.p95) })),
    previous: {
      totalCount: Number(prevRow.total ?? 0),
      p50: nullableNumber(prevRow.p50),
      p95: nullableNumber(prevRow.p95),
      approvalRate: approvalRate(prevRow.approved, prevRow.total),
    },
    tenants,
    generatedAt: new Date().toISOString(),
    outcomes: outcomesRes.rows.map((r) => ({ outcomeCode: r.outcome_code, count: Number(r.count) })),
    latency: {
      p50: nullableNumber(currentRow.p50),
      p95: nullableNumber(currentRow.p95),
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
    totalCount: Number(currentRow.total ?? 0),
  };
}
