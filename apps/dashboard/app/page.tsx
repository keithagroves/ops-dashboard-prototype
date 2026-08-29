"use client";

import { useState } from "react";
import type { QueryFilters } from "@nymbus/shared";
import { FilterBar } from "./components/FilterBar";
import { TrendChart } from "./components/TrendChart";
import { OutcomeBreakdown } from "./components/OutcomeBreakdown";
import { LatencyPanel } from "./components/LatencyPanel";
import { DrilldownTable } from "./components/DrilldownTable";
import { useSse } from "./lib/useSse";

const DEFAULT_FILTERS: QueryFilters = { role: "global", windowMinutes: 15 };

export default function Home() {
  const [filters, setFilters] = useState<QueryFilters>(DEFAULT_FILTERS);
  const { data, connected } = useSse(filters);

  const patch = (p: Partial<QueryFilters>) => setFilters((f) => ({ ...f, ...p }));

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-6">
      <header>
        <h1 className="text-lg font-semibold text-neutral-100">Platform Operations — Transaction Activity</h1>
        <p className="text-xs text-neutral-500">
          Demo window is compressed to minutes (rather than the production 24h rolling view) so the pipeline is
          visibly live during a short demo — same bucketing/query mechanics apply at either scale.
        </p>
      </header>

      <FilterBar filters={filters} onChange={patch} connected={connected} />

      {!data ? (
        <p className="text-sm text-neutral-500">Waiting for data…</p>
      ) : (
        <>
          <LatencyPanel latency={data.latency} totalCount={data.totalCount} />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <TrendChart trend={data.trend} />
            <OutcomeBreakdown
              outcomes={data.outcomes}
              selected={filters.outcomeCode}
              onSelect={(v) => patch({ outcomeCode: v as QueryFilters["outcomeCode"] })}
            />
          </div>
          <DrilldownTable rows={data.rows} />
        </>
      )}
    </div>
  );
}
