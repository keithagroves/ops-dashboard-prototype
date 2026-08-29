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

// `role` is deliberately not sent: the API takes it from the verified token,
// and a tenant caller's tenantId too. The tenantId below is only honoured for
// a global operator narrowing to one tenant.
export function buildUrl(path: string, filters: QueryFilters, token: string): string {
  const API_BASE = getApiBase();
  const params = new URLSearchParams();
  params.set("token", token);
  // Set-valued filters are appended once per value. An empty selection is
  // omitted entirely rather than sent as a bare key: the API rejects an empty
  // set, and "no constraint" is what an empty selection means here.
  const appendAll = (key: string, values: readonly string[] | undefined) => {
    for (const value of values ?? []) params.append(key, value);
  };

  if (filters.tenantId) params.set("tenantId", filters.tenantId);
  appendAll("eftVendor", filters.eftVendor);
  appendAll("messageType", filters.messageType);
  appendAll("txFamily", filters.txFamily);
  appendAll("outcomeCode", filters.outcomeCode);
  if (filters.sourceSystem) params.set("sourceSystem", filters.sourceSystem);
  if (filters.windowMinutes) params.set("windowMinutes", String(filters.windowMinutes));
  return `${API_BASE}${path}?${params.toString()}`;
}
