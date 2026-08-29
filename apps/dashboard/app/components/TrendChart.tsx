"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TrendPoint } from "@nymbus/shared";
import { Panel } from "./Panel";

export function TrendChart({ trend }: { trend: TrendPoint[] }) {
  const data = trend.map((t) => ({
    time: new Date(t.bucket).toLocaleTimeString(),
    count: t.count,
  }));

  return (
    <Panel title="Transaction volume over time">
      {data.length === 0 ? (
        <p className="flex h-56 items-center justify-center text-sm text-neutral-500">
          No transaction data is available for the selected window.
        </p>
      ) : (
        <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id="volumeFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.5} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
            <XAxis dataKey="time" tick={{ fontSize: 10, fill: "#a3a3a3" }} minTickGap={30} />
            <YAxis domain={[0, "auto"]} allowDecimals={false} tick={{ fontSize: 10, fill: "#a3a3a3" }} width={36} />
            <Tooltip contentStyle={{ background: "#171717", border: "1px solid #404040", fontSize: 12 }} />
            <Area
              type="monotone"
              dataKey="count"
              stroke="#3b82f6"
              fill="url(#volumeFill)"
              strokeWidth={2}
              // Off for the same reason as the latency chart: this redraws on
              // every push, so a 1.5s enter animation is a constant ripple,
              // and on a filter change it replays from scratch as a flash.
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      )}
    </Panel>
  );
}
