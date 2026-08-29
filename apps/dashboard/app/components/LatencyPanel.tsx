"use client";

import type { LatencyStats } from "@nymbus/shared";

function Tile({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-neutral-800 bg-neutral-950 p-4">
      <span className="text-xs text-neutral-400">{label}</span>
      <span className={`text-2xl font-semibold ${warn ? "text-amber-400" : "text-neutral-100"}`}>{value}</span>
    </div>
  );
}

export function LatencyPanel({ latency, totalCount }: { latency: LatencyStats; totalCount: number }) {
  return (
    <div className="flex gap-3">
      <Tile label="p50 latency" value={latency.p50 != null ? `${Math.round(latency.p50)}ms` : "—"} />
      <Tile
        label="p95 latency"
        value={latency.p95 != null ? `${Math.round(latency.p95)}ms` : "—"}
        warn={latency.p95 != null && latency.p95 > 500}
      />
      <Tile label="transactions in window" value={totalCount.toLocaleString()} />
    </div>
  );
}
