import type { QueryFilters } from "@nymbus/shared";

/** Filter keys a user can clear. `role` is not one: it comes from the token. */
export type ClearableKey = "tenantId" | "eftVendor" | "messageType" | "txFamily" | "outcomeCode" | "sourceSystem";

export interface ActiveFilter {
  key: ClearableKey;
  label: string;
  value: string;
}

const LABELS: Record<ClearableKey, string> = {
  tenantId: "Tenant",
  eftVendor: "Vendor",
  messageType: "Type",
  txFamily: "Family",
  outcomeCode: "Outcome",
  sourceSystem: "Source",
};

const ORDER: ClearableKey[] = ["tenantId", "eftVendor", "messageType", "txFamily", "outcomeCode", "sourceSystem"];

/**
 * The filters currently narrowing the view, for display as dismissible chips.
 *
 * `windowMinutes` is excluded deliberately: it is always set, so a chip for it
 * would never be dismissible and would just be noise next to real narrowings.
 *
 * A tenant session's `tenantId` is its identity rather than a filter it chose,
 * so it is omitted unless the caller is a global operator who drilled in.
 */
export function activeFilters(filters: QueryFilters): ActiveFilter[] {
  const isGlobal = filters.role === "global";
  return ORDER.filter((key) => key !== "tenantId" || isGlobal)
    .map((key) => {
      const raw = filters[key];
      // A set-valued filter is one chip listing its values, not one chip per
      // value: "Vendor: vendor-a, vendor-c" is a single decision the operator
      // made and should be undone in one click.
      const value = Array.isArray(raw) ? raw.join(", ") : raw;
      return { key, label: LABELS[key], value };
    })
    .filter((f): f is ActiveFilter => typeof f.value === "string" && f.value.length > 0);
}

/**
 * Clears every user-applied narrowing while preserving the things that are not
 * filters: the caller's role, a tenant session's own tenantId, and the
 * selected time window.
 */
export function clearAllFilters(filters: QueryFilters): QueryFilters {
  return {
    role: filters.role,
    tenantId: filters.role === "tenant" ? filters.tenantId : undefined,
    windowMinutes: filters.windowMinutes,
  };
}

export function hasActiveFilters(filters: QueryFilters): boolean {
  return activeFilters(filters).length > 0;
}
