"use client";

import type { LatencyStats, WindowStats } from "@nymbus/shared";
import { Delta } from "./Delta";

const P95_SLA_MS = 500;

function Tile({
  label,
  value,
  warn,
  children,
}: {
  label: string;
  value: string;
  warn?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 rounded-lg border border-neutral-800 bg-neutral-950 p-4">
      <span className="text-xs text-neutral-400">{label}</span>
      <span className={`text-2xl font-semibold ${warn ? "text-amber-400" : "text-neutral-100"}`}>{value}</span>
      {children}
    </div>
  );
}

const ms = (n: number) => `${Math.round(n)}ms`;
const pp = (n: number) => `${(n * 100).toFixed(1)}pp`;
const int = (n: number) => Math.round(n).toLocaleString();

export function KpiRow({
  latency,
  totalCount,
  approvalRate,
  previous,
}: {
  latency: LatencyStats;
  totalCount: number;
  approvalRate: number | null;
  previous: WindowStats;
}) {
  return (
    <div className="flex flex-wrap gap-3">
      <Tile label="transactions in window" value={totalCount.toLocaleString()}>
        <Delta delta={totalCount - previous.totalCount} format={int} goodDirection="none" />
      </Tile>

      <Tile
        label="approval rate"
        value={approvalRate != null ? `${(approvalRate * 100).toFixed(1)}%` : "—"}
      >
        <Delta
          delta={approvalRate != null && previous.approvalRate != null ? approvalRate - previous.approvalRate : null}
          format={pp}
          goodDirection="up"
        />
      </Tile>

      <Tile label="p50 latency" value={latency.p50 != null ? ms(latency.p50) : "—"}>
        <Delta
          delta={latency.p50 != null && previous.p50 != null ? latency.p50 - previous.p50 : null}
          format={ms}
          goodDirection="down"
        />
      </Tile>

      <Tile
        label={`p95 latency (SLA ${P95_SLA_MS}ms)`}
        value={latency.p95 != null ? ms(latency.p95) : "—"}
        warn={latency.p95 != null && latency.p95 > P95_SLA_MS}
      >
        <Delta
          delta={latency.p95 != null && previous.p95 != null ? latency.p95 - previous.p95 : null}
          format={ms}
          goodDirection="down"
        />
      </Tile>
    </div>
  );
}
