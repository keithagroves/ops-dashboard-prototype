import type { QueryFilters, Role } from "@nymbus/shared";

export function filtersFromQuery(q: Record<string, unknown>): QueryFilters {
  const role: Role = q.role === "global" ? "global" : "tenant";
  const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
  const windowMinutes = q.windowMinutes ? Number(q.windowMinutes) : undefined;

  return {
    role,
    tenantId: str(q.tenantId),
    eftVendor: str(q.eftVendor) as QueryFilters["eftVendor"],
    messageType: str(q.messageType) as QueryFilters["messageType"],
    txFamily: str(q.txFamily) as QueryFilters["txFamily"],
    outcomeCode: str(q.outcomeCode) as QueryFilters["outcomeCode"],
    sourceSystem: str(q.sourceSystem),
    windowMinutes: Number.isFinite(windowMinutes) ? windowMinutes : undefined,
  };
}
