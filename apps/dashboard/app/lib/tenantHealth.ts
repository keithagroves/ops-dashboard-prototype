import type { TenantHealthPoint } from "@nymbus/shared";

export const SLA_MS = 500;

export type Health = "bad" | "warn" | "ok";

// Thresholds are set relative to the platform's ~88% baseline approval rate:
// a healthy tenant sits in the mid-to-high 80s, so "warn" only fires on a
// genuine dip and "bad" on the kind of drop an outcome incident produces.
const BAD_APPROVAL = 0.6;
const WARN_APPROVAL = 0.78;

export function health(t: TenantHealthPoint): Health {
  const slaBreach = t.p95 != null && t.p95 > SLA_MS;
  if ((t.approvalRate != null && t.approvalRate < BAD_APPROVAL) || slaBreach) return "bad";
  if ((t.approvalRate != null && t.approvalRate < WARN_APPROVAL) || (t.p95 != null && t.p95 > SLA_MS * 0.9)) {
    return "warn";
  }
  return "ok";
}

const RANK: Record<Health, number> = { bad: 0, warn: 1, ok: 2 };

/**
 * Worst-first, then stable by tenant ID within a health band. Live counts
 * change continuously; using them as a tiebreaker made healthy rows shuffle
 * even though count is not displayed. The input is not mutated.
 */
export function sortByHealth(tenants: TenantHealthPoint[]): TenantHealthPoint[] {
  return [...tenants].sort((a, b) => {
    const byHealth = RANK[health(a)] - RANK[health(b)];
    if (byHealth !== 0) return byHealth;
    return a.tenantId.localeCompare(b.tenantId);
  });
}

export function countNeedingAttention(tenants: TenantHealthPoint[]): number {
  return tenants.filter((t) => health(t) !== "ok").length;
}

const displayedApproval = (value: number | null): number | null =>
  value == null ? null : Math.round(value * 100);
const displayedLatency = (value: number | null): number | null =>
  value == null ? null : Math.round(value);

/**
 * Compare what a tenant row actually renders, not raw aggregate precision.
 * A sub-percentage approval change, fractional millisecond, or hidden count
 * update should not cause 50 DOM rows to reconcile.
 */
export function sameTenantHealth(a: TenantHealthPoint[], b: TenantHealthPoint[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (tenant, index) =>
        tenant.tenantId === b[index]?.tenantId &&
        health(tenant) === health(b[index]) &&
        displayedApproval(tenant.approvalRate) === displayedApproval(b[index].approvalRate) &&
        displayedLatency(tenant.p95) === displayedLatency(b[index].p95),
    )
  );
}
