import type { QueryFilters } from "@nymbus/shared";

/**
 * Identifies *whose* data a payload is — the identity it was fetched under,
 * not the slice of it that was requested.
 *
 * While a new stream connects, the previous payload stays on screen dimmed so
 * the layout does not collapse. That is only acceptable when the viewer is the
 * same: a different token or role is a different person, with a different
 * entitlement, and their numbers must never appear under the new session.
 * Those get a skeleton instead.
 *
 * `tenantId` is deliberately NOT part of the identity. A global operator
 * drilling into one tenant is navigating within data they already hold and are
 * authorized for — the same as any other filter. Treating that as a scope
 * change blanked the whole dashboard on every tenant click, which read as a
 * flicker for the ~30ms the query takes, and bought nothing: the operator is
 * cleared for both views, and the chip row names the tenant immediately.
 *
 * A tenant-role session cannot reach the other branch anyway - its tenantId
 * comes from its own token and never changes within a session.
 */
export function scopeKeyOf(filters: QueryFilters, token: string): string {
  return JSON.stringify([token, filters.role]);
}

/** Whether a payload captured under `previous` may be shown while `next` loads. */
export function isSameScope(previous: string, next: string): boolean {
  return previous === next;
}
