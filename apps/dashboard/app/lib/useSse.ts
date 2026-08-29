"use client";

import { useEffect, useState } from "react";
import type { QueryFilters, QueryResult } from "@nymbus/shared";
import { buildUrl } from "./queryUrl";

export function useSse(filters: QueryFilters) {
  const [data, setData] = useState<QueryResult | null>(null);
  const [connected, setConnected] = useState(false);
  const key = JSON.stringify(filters);

  useEffect(() => {
    // Reopening the connection on filter change (rather than tracking
    // per-connection filter state server-side) is the pragmatic choice for
    // this scope: simpler to implement correctly, same user-visible result.
    const url = buildUrl("/api/stream", filters);
    const es = new EventSource(url);

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (event) => {
      try {
        setData(JSON.parse(event.data) as QueryResult);
      } catch {
        // ignore malformed frame
      }
    };

    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { data, connected };
}
