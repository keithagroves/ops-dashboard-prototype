import type { QueryFilters } from "@nymbus/shared";

/**
 * Identifies *whose* data a payload is, as opposed to which slice of it.
 *
 * While a new stream connects, the previous payload can stay on screen so the
 * layout does not collapse — but only when it describes the same scope. A
 * change of token, role or drilled-into tenant means the old numbers belong to
 * someone else, and showing them under the new heading would misreport who is
 * being looked at. Those get a skeleton instead.
 *
 * Filter changes (vendor, message type, family, outcome, window) do not change
 * scope: the old numbers are the same tenant's, just a wider slice.
 */
export function scopeKeyOf(filters: QueryFilters, token: string): string {
  return JSON.stringify([token, filters.role, filters.tenantId ?? null]);
}

/** Whether a payload captured under `previous` may be shown while `next` loads. */
export function isSameScope(previous: string, next: string): boolean {
  return previous === next;
}
