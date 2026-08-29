export const EFT_VENDORS = ["vendor-a", "vendor-b", "vendor-c", "vendor-d", "vendor-e"] as const;
export type EftVendor = (typeof EFT_VENDORS)[number];

export const MESSAGE_TYPES = ["auth_request", "reversal", "advice", "network_management"] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

export const TX_FAMILIES = ["purchase", "withdrawal", "deposit", "transfer", "payment"] as const;
export type TxFamily = (typeof TX_FAMILIES)[number];

export const OUTCOME_CODES = [
  "approved",
  "insufficient_funds",
  "exceeds_limit",
  "do_not_honor",
  "invalid_card",
  "format_error",
  "issuer_unavailable",
] as const;
export type OutcomeCode = (typeof OUTCOME_CODES)[number];

export interface TxEvent {
  eventTs: string; // ISO timestamp
  tenantId: string;
  eftVendor: EftVendor;
  messageType: MessageType;
  txFamily: TxFamily | null;
  outcomeCode: OutcomeCode;
  sourceSystem: string;
  amountCents: number | null;
  latencyMs: number;
}

export function tenantIds(count = 50): string[] {
  return Array.from({ length: count }, (_, i) => `tenant-${String(i + 1).padStart(2, "0")}`);
}

export const KAFKA_TOPIC = "tx-events";
export const REDIS_UPDATE_CHANNEL = "tx:updates";

export type Role = "tenant" | "global";

/**
 * What the API derives a caller's scope from. In production these arrive in a
 * verified JWT issued by the platform's existing identity provider; the
 * prototype issues its own from a hardcoded demo user directory.
 */
export interface AuthClaims {
  sub: string;
  role: Role;
  /** Present (and enforced) only for role=tenant. */
  tenantId?: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  claims: AuthClaims;
}

/**
 * The enum filters are sets, not single values. An operator triaging an
 * incident needs "vendor-a and vendor-c" or "every decline", and needs to
 * exclude network-management heartbeats from volume counts - none of which a
 * single value can express. An absent key means "no constraint"; an empty
 * array is rejected rather than silently matching everything.
 */
export interface QueryFilters {
  role: Role;
  tenantId?: string;
  eftVendor?: EftVendor[];
  messageType?: MessageType[];
  txFamily?: TxFamily[];
  outcomeCode?: OutcomeCode[];
  sourceSystem?: string;
  windowMinutes?: number;
}

/**
 * How an outcome resolved, coarsely. Operators triage by severity long before
 * they care about the specific code: "are we declining more than usual" comes
 * first, "which code" second. Soft declines are ordinary customer-side
 * outcomes; hard declines indicate a card, format or upstream problem.
 */
export type OutcomeSeverity = "approved" | "soft_decline" | "hard_decline";

export const OUTCOME_SEVERITY: Record<OutcomeCode, OutcomeSeverity> = {
  approved: "approved",
  insufficient_funds: "soft_decline",
  exceeds_limit: "soft_decline",
  do_not_honor: "hard_decline",
  invalid_card: "hard_decline",
  format_error: "hard_decline",
  issuer_unavailable: "hard_decline",
};

export function outcomesOfSeverity(severity: OutcomeSeverity): OutcomeCode[] {
  return OUTCOME_CODES.filter((code) => OUTCOME_SEVERITY[code] === severity);
}

export interface TrendPoint {
  bucket: string;
  count: number;
  p95: number | null;
}

/** Aggregate stats for a single window, used to show deltas vs. the prior period. */
export interface WindowStats {
  totalCount: number;
  p50: number | null;
  p95: number | null;
  approvalRate: number | null; // 0..1
}

/** Per-tenant health, populated only for role=global cross-tenant views. */
export interface TenantHealthPoint {
  tenantId: string;
  count: number;
  approvalRate: number | null; // 0..1
  p95: number | null;
}

export interface OutcomeBreakdownPoint {
  outcomeCode: OutcomeCode | string;
  count: number;
}

export interface LatencyStats {
  p50: number | null;
  p95: number | null;
}

export interface DrilldownRow {
  id: number;
  eventTs: string;
  tenantId: string;
  eftVendor: string;
  messageType: string;
  txFamily: string | null;
  outcomeCode: string;
  sourceSystem: string;
  amountCents: number | null;
  latencyMs: number;
}

export interface QueryResult {
  trend: TrendPoint[];
  outcomes: OutcomeBreakdownPoint[];
  latency: LatencyStats;
  rows: DrilldownRow[];
  totalCount: number;
  /** Same aggregates over the immediately preceding window of equal length. */
  previous: WindowStats;
  /** Per-tenant health for cross-tenant (global) views; empty otherwise. */
  tenants: TenantHealthPoint[];
  /** Server timestamp this result was computed, ISO string. */
  generatedAt: string;
}
