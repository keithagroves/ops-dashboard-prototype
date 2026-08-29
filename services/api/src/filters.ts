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

  /**
   * Reads a set-valued filter. Accepts both the repeated form the dashboard
   * sends (`?eftVendor=a&eftVendor=c`) and a comma-separated one
   * (`?eftVendor=a,c`) for hand-typed URLs and curl.
   *
   * A key that is present but yields nothing usable becomes an empty array
   * rather than undefined, so validateFilters rejects it with a 400 instead of
   * it being read as "no constraint" - the same reasoning as windowMinutes
   * below. Non-string members are dropped here and caught there.
   */
  const set = (v: unknown): string[] | undefined => {
    if (v === undefined) return undefined;
    const raw = Array.isArray(v) ? v : [v];
    return raw
      .filter((item): item is string => typeof item === "string")
      .flatMap((item) => item.split(","))
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  };
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
    eftVendor: set(q.eftVendor) as QueryFilters["eftVendor"],
    messageType: set(q.messageType) as QueryFilters["messageType"],
    txFamily: set(q.txFamily) as QueryFilters["txFamily"],
    outcomeCode: set(q.outcomeCode) as QueryFilters["outcomeCode"],
    sourceSystem: str(q.sourceSystem),
    windowMinutes,
  };
}
