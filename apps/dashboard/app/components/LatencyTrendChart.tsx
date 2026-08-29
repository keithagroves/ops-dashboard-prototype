"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TrendPoint } from "@nymbus/shared";

const SLA_MS = 500;

export function LatencyTrendChart({ trend }: { trend: TrendPoint[] }) {
  const data = trend.map((t) => ({
    time: new Date(t.bucket).toLocaleTimeString(),
    p95: t.p95 != null ? Math.round(t.p95) : null,
  }));

  const peak = data.reduce((m, d) => Math.max(m, d.p95 ?? 0), 0);
  // Fixed floor of 600 keeps the SLA line meaningfully placed and stops the
  // axis from zooming into noise when everything is healthy.
  const yMax = Math.max(600, Math.ceil((peak * 1.15) / 100) * 100);

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
      <h2 className="mb-2 text-sm font-medium text-neutral-300">p95 latency over time</h2>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
            <XAxis dataKey="time" tick={{ fontSize: 10, fill: "#a3a3a3" }} minTickGap={30} />
            <YAxis domain={[0, yMax]} tick={{ fontSize: 10, fill: "#a3a3a3" }} width={44} unit="ms" />
            <Tooltip
              contentStyle={{ background: "#171717", border: "1px solid #404040", fontSize: 12 }}
              formatter={(v) => [`${v}ms`, "p95"]}
            />
            <ReferenceLine
              y={SLA_MS}
              stroke="#f59e0b"
              strokeDasharray="4 4"
              label={{ value: `SLA ${SLA_MS}ms`, position: "insideTopRight", fill: "#f59e0b", fontSize: 10 }}
            />
            <Line
              type="monotone"
              dataKey="p95"
              stroke="#38bdf8"
              strokeWidth={2}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
