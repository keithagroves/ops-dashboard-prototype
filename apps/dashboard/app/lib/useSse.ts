"use client";

import { useEffect, useState } from "react";
import type { QueryFilters, QueryResult, TenantHealthPoint } from "@nymbus/shared";
import { buildUrl } from "./queryUrl";
import { sameTenantHealth } from "./tenantHealth";
import { isSameScope, scopeKeyOf } from "./sseScope";

export function useSse(filters: QueryFilters, token: string) {
  const [snapshot, setSnapshot] = useState<{
    key: string;
    scope: string;
    data: QueryResult;
    receivedAt: number;
  } | null>(null);
  const [connectedKey, setConnectedKey] = useState<string | null>(null);
  // Tenant health is navigation context, not filter-scoped panel data. Keep
  // the last list for this exact token while a replacement filtered stream
  // connects, so changing vendor/type does not unmount the whole navigator.
  const [tenantSnapshot, setTenantSnapshot] = useState<{ token: string; tenants: TenantHealthPoint[] } | null>(null);
  // Include the credential as well as the filters: even if a future caller
  // reuses this hook without remounting on account change, a prior user's
  // snapshot can never be rendered under the new scope.
  const key = JSON.stringify([token, filters]);
  const scope = scopeKeyOf(filters, token);

  useEffect(() => {
    // Reopening the connection on filter change (rather than tracking
    // per-connection filter state server-side) is the pragmatic choice for
    // this scope: simpler to implement correctly, same user-visible result.
    const url = buildUrl("/api/stream", filters, token);
    const es = new EventSource(url);

    es.onopen = () => setConnectedKey(key);
    es.onerror = () => setConnectedKey((current) => (current === key ? null : current));
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as QueryResult;
        if (data.tenants.length > 0) {
          setTenantSnapshot((current) =>
            current?.token === token && sameTenantHealth(current.tenants, data.tenants)
              ? current
              : { token, tenants: data.tenants },
          );
        }
        setSnapshot({ key, scope, data, receivedAt: Date.now() });
      } catch {
        // ignore malformed frame
      }
    };

    return () => {
      es.onopen = null;
      es.onerror = null;
      es.onmessage = null;
      es.close();
      setConnectedKey((current) => (current === key ? null : current));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, token]);

  // Scope the returned state synchronously during render. Effects run after a
  // paint, so merely clearing state inside the effect still flashes the old
  // tenant/global payload for one render after a filter change.
  const isCurrent = snapshot?.key === key;

  // A snapshot from the same scope but a stale filter stays on screen while the
  // replacement stream connects, so the panels keep their dimensions instead of
  // collapsing to a loading line and snapping back. It is surfaced as `stale`
  // rather than passed off as live: the caller dims it and blocks interaction,
  // and the live indicator says "updating". A snapshot from a *different*
  // scope is never reused - see scopeKeyOf.
  const reusable = !isCurrent && snapshot != null && isSameScope(snapshot.scope, scope);

  return {
    data: isCurrent ? snapshot.data : reusable ? snapshot.data : null,
    stale: reusable,
    connected: connectedKey === key,
    // Only a current snapshot has a meaningful age; a stale one would make the
    // indicator claim data is fresher than the filter it belongs to.
    lastEventAt: isCurrent ? snapshot.receivedAt : null,
    tenants: tenantSnapshot?.token === token ? tenantSnapshot.tenants : [],
  };
}
