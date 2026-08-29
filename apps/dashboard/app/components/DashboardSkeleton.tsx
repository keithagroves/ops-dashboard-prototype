"use client";

import { Panel, Skeleton } from "./Panel";

/**
 * Placeholder for a cold start or a scope change, where there is no payload we
 * are allowed to keep showing.
 *
 * It reuses the real Panel chrome and the same fixed content heights as the
 * loaded dashboard, so the page keeps its shape and nothing jumps when data
 * arrives. It shows no numbers at all — an operator must never be able to read
 * a value here and think it describes the scope they just switched to.
 */
export function DashboardSkeleton() {
  return (
    <div className="deferred-in flex flex-col gap-4">
      <div className="flex flex-wrap gap-3">
        {["transactions in window", "approval rate", "p50 latency", "p95 latency"].map((label) => (
          <div
            key={label}
            className="flex flex-1 flex-col items-center justify-center gap-1 rounded-lg border border-neutral-800 bg-neutral-950 p-4"
          >
            <span className="text-xs text-neutral-600">{label}</span>
            <Skeleton className="my-1 h-7 w-24" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Panel title="Transaction volume over time">
          <Skeleton className="h-56 w-full" />
        </Panel>
        <Panel title="p95 latency over time">
          <Skeleton className="h-56 w-full" />
        </Panel>
      </div>

      <Panel title="Outcome breakdown">
        <Skeleton className="h-56 w-full" />
      </Panel>

      <Panel title="Recent transactions">
        <div className="flex flex-col gap-2">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </div>
      </Panel>
    </div>
  );
}
