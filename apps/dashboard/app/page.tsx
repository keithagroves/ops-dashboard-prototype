"use client";

import { useCallback, useState } from "react";
import type { QueryFilters } from "@nymbus/shared";
import { FilterSidebar } from "./components/FilterSidebar";
import { KpiRow } from "./components/KpiRow";
import { TrendChart } from "./components/TrendChart";
import { LatencyTrendChart } from "./components/LatencyTrendChart";
import { OutcomeBreakdown } from "./components/OutcomeBreakdown";
import { TenantHealthSidebar } from "./components/TenantHealthSidebar";
import { DrilldownTable } from "./components/DrilldownTable";
import { LoginScreen } from "./components/LoginScreen";
import { ActiveFilterChips } from "./components/ActiveFilterChips";
import { DashboardSkeleton } from "./components/DashboardSkeleton";
import { useSse } from "./lib/useSse";
import { useAuth } from "./lib/auth";
import { approvalRateOf } from "./lib/stats";
import { clearAllFilters, type ClearableKey } from "./lib/activeFilters";

export default function Home() {
  const { token, claims, ready, signIn, signOut } = useAuth();

  if (!ready) return null;
  if (!token || !claims) return <LoginScreen onSignIn={signIn} />;

  // Keyed on the subject so switching accounts starts from clean filter state
  // rather than carrying the previous session's drill-down across.
  return <Dashboard key={claims.sub} token={token} claims={claims} onSignOut={signOut} />;
}

function Dashboard({
  token,
  claims,
  onSignOut,
}: {
  token: string;
  claims: NonNullable<ReturnType<typeof useAuth>["claims"]>;
  onSignOut: () => void;
}) {
  // Role and (for a tenant) tenantId mirror the token purely so the UI can
  // render the right shape. The API re-derives both from the token itself.
  const [filters, setFilters] = useState<QueryFilters>({
    role: claims.role,
    tenantId: claims.role === "tenant" ? claims.tenantId : undefined,
    windowMinutes: 15,
  });
  const { data, stale, connected, lastEventAt, tenants, error } = useSse(filters, token);

  const patch = useCallback((p: Partial<QueryFilters>) => setFilters((f) => ({ ...f, ...p })), []);
  const selectTenant = useCallback((tenantId: string | undefined) => patch({ tenantId }), [patch]);
  const selectOutcome = useCallback(
    // Clicking a bar selects that one code, replacing whatever severity band
    // the sidebar had selected — a deliberate narrowing, not an addition.
    (outcomeCode: string | undefined) =>
      patch({ outcomeCode: outcomeCode ? ([outcomeCode] as QueryFilters["outcomeCode"]) : undefined }),
    [patch],
  );

  const clearFilter = useCallback((key: ClearableKey) => patch({ [key]: undefined }), [patch]);
  const clearAll = useCallback(() => setFilters(clearAllFilters), []);

  const isGlobal = claims.role === "global";
  // The tenant list stays up while drilled in — it's the navigator, so you can
  // click straight from one tenant to the next. A tenant-role session never
  // gets it: the API doesn't return other tenants to that caller at all.
  const showSidebar = isGlobal;

  return (
    <div className="mx-auto flex max-w-[95rem] flex-col gap-4 p-6">
      <header>
        <h1 className="text-lg font-semibold text-neutral-100">
          {isGlobal ? "Platform Operations" : `${claims.tenantId} Operations`} — Transaction Activity
        </h1>
        <p className="text-xs text-neutral-500">
          Demo window is compressed to minutes (rather than the production 24h rolling view) so the pipeline is
          visibly live during a short demo — same bucketing/query mechanics apply at either scale. Deltas compare
          the selected window to the window immediately before it.
        </p>
      </header>

      <div className="flex flex-col gap-4 lg:flex-row">
        {showSidebar && tenants.length > 0 && (
          <TenantHealthSidebar
            tenants={tenants}
            selected={filters.tenantId}
            onSelect={selectTenant}
          />
        )}

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <ActiveFilterChips filters={filters} onClear={clearFilter} onClearAll={clearAll} />

          {error && (
            <p role="alert" className="rounded border border-red-900 bg-red-950/50 px-3 py-2 text-xs text-red-300">
              {error}; showing the last valid data while the live stream continues.
            </p>
          )}

          {!data ? (
            <DashboardSkeleton />
          ) : (
            // While a replacement stream connects, the previous same-scope
            // payload stays in place dimmed and inert: it keeps the layout
            // from collapsing, but it must not be readable as current or
            // clickable, or an operator could drill into a bar that no longer
            // reflects the filters on screen.
            //
            // The dim is delayed on the way in and immediate on the way out.
            // Re-selecting a combination you just looked at is answered from
            // the API's short-lived query cache, so the reply can beat the
            // delay entirely - and a fade that starts and reverses inside
            // ~100ms reads as a flicker, not as feedback. Waiting 200ms means
            // fast updates show no transition at all, and only a genuinely
            // slow one dims. Doing this in CSS rather than by delaying the
            // `stale` state keeps pointer-events off for the whole window.
            <div
              className={
                stale
                  ? "pointer-events-none flex flex-col gap-4 opacity-40 transition-opacity delay-200 duration-150"
                  : "flex flex-col gap-4 opacity-100 transition-opacity duration-150"
              }
              aria-busy={stale}
            >
              <KpiRow
                latency={data.latency}
                totalCount={data.totalCount}
                approvalRate={approvalRateOf(data.outcomes)}
                previous={data.previous}
              />

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <TrendChart trend={data.trend} />
                <LatencyTrendChart trend={data.trend} />
              </div>

              <OutcomeBreakdown
                outcomes={data.outcomes}
                selected={filters.outcomeCode}
                onSelect={selectOutcome}
              />

              <DrilldownTable rows={data.rows} />
            </div>
          )}
        </div>

        <FilterSidebar
          filters={filters}
          onChange={patch}
          connected={connected}
          lastEventAt={lastEventAt}
          claims={claims}
          onSignOut={onSignOut}
          onClearAll={clearAll}
          updating={stale}
        />
      </div>
    </div>
  );
}
