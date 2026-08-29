import type { QueryFilters } from "@nymbus/shared";

const DEFAULT_API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:4000";

// A `?api=4001`-style override lets two browser tabs point at two different
// API instances without needing two separate Next.js dev servers - useful
// only for demonstrating the Redis pub/sub fan-out pattern works across
// horizontally-scaled API instances.
export function getApiBase(): string {
  if (typeof window === "undefined") return DEFAULT_API_BASE;
  const port = new URLSearchParams(window.location.search).get("api");
  return port ? `http://localhost:${port}` : DEFAULT_API_BASE;
}

export function buildUrl(path: string, filters: QueryFilters): string {
  const API_BASE = getApiBase();
  const params = new URLSearchParams();
  params.set("role", filters.role);
  if (filters.tenantId) params.set("tenantId", filters.tenantId);
  if (filters.eftVendor) params.set("eftVendor", filters.eftVendor);
  if (filters.messageType) params.set("messageType", filters.messageType);
  if (filters.txFamily) params.set("txFamily", filters.txFamily);
  if (filters.outcomeCode) params.set("outcomeCode", filters.outcomeCode);
  if (filters.sourceSystem) params.set("sourceSystem", filters.sourceSystem);
  if (filters.windowMinutes) params.set("windowMinutes", String(filters.windowMinutes));
  return `${API_BASE}${path}?${params.toString()}`;
}
