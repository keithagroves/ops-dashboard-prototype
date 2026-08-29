import type { AuthClaims, QueryFilters } from "@nymbus/shared";

/**
 * Builds the query filters for a request.
 *
 * `role` and - for a tenant caller - `tenantId` come from the verified token
 * and are never read from the query string, so a client cannot widen its own
 * scope by asking. A global operator may additionally narrow to one tenant,
 * which is the only case where the request gets a say in tenantId at all.
 */
export function filtersFromQuery(q: Record<string, unknown>, claims: AuthClaims): QueryFilters {
  const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
  // Preserve malformed values as NaN so validateFilters rejects them. The
  // old Number.isFinite guard turned `?windowMinutes=garbage` into `undefined`,
  // silently applying the 15-minute default instead of returning a 400.
  const windowMinutes =
    q.windowMinutes === undefined
      ? undefined
      : typeof q.windowMinutes === "string" && q.windowMinutes.length > 0
        ? Number(q.windowMinutes)
        : Number.NaN;

  return {
    role: claims.role,
    tenantId: claims.role === "tenant" ? claims.tenantId : str(q.tenantId),
    eftVendor: str(q.eftVendor) as QueryFilters["eftVendor"],
    messageType: str(q.messageType) as QueryFilters["messageType"],
    txFamily: str(q.txFamily) as QueryFilters["txFamily"],
    outcomeCode: str(q.outcomeCode) as QueryFilters["outcomeCode"],
    sourceSystem: str(q.sourceSystem),
    windowMinutes,
  };
}
