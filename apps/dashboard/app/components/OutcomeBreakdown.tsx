"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { OutcomeBreakdownPoint } from "@nymbus/shared";

const COLORS: Record<string, string> = {
  approved: "#22c55e",
  insufficient_funds: "#f59e0b",
  exceeds_limit: "#f59e0b",
  do_not_honor: "#ef4444",
  invalid_card: "#ef4444",
  format_error: "#ef4444",
  issuer_unavailable: "#ef4444",
};

export function OutcomeBreakdown({
  outcomes,
  selected,
  onSelect,
}: {
  outcomes: OutcomeBreakdownPoint[];
  selected?: string;
  onSelect: (outcomeCode: string | undefined) => void;
}) {
  const total = outcomes.reduce((sum, o) => sum + o.count, 0);
  const approved = outcomes.find((o) => o.outcomeCode === "approved")?.count ?? 0;
  const approvalRate = total > 0 ? ((approved / total) * 100).toFixed(1) : "—";

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-neutral-300">Outcome breakdown</h2>
        <span className="text-xs text-neutral-400">
          approval rate: <span className="font-semibold text-emerald-400">{approvalRate}%</span>
        </span>
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={outcomes} layout="vertical" margin={{ left: 24 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
            <XAxis type="number" tick={{ fontSize: 10, fill: "#a3a3a3" }} />
            <YAxis dataKey="outcomeCode" type="category" tick={{ fontSize: 10, fill: "#a3a3a3" }} width={120} />
            <Tooltip contentStyle={{ background: "#171717", border: "1px solid #404040", fontSize: 12 }} />
            <Bar
              dataKey="count"
              radius={[0, 4, 4, 0]}
              onClick={(d) => onSelect(d.outcomeCode === selected ? undefined : d.outcomeCode)}
              cursor="pointer"
            >
              {outcomes.map((o) => (
                <Cell
                  key={o.outcomeCode}
                  fill={COLORS[o.outcomeCode] ?? "#737373"}
                  opacity={!selected || selected === o.outcomeCode ? 1 : 0.35}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
