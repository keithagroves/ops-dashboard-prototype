"use client";

import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { OutcomeBreakdownPoint } from "@nymbus/shared";
import { Panel } from "./Panel";

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
  selected?: readonly string[];
  onSelect: (outcomeCode: string | undefined) => void;
}) {
  const total = outcomes.reduce((sum, outcome) => sum + outcome.count, 0);
  const data = outcomes.map((outcome) => ({
    ...outcome,
    summary: `${outcome.count.toLocaleString()} · ${total > 0 ? ((outcome.count / total) * 100).toFixed(1) : "0.0"}%`,
  }));
  // Dim bars only when the selection is a strict subset. With no filter — or
  // with a whole severity band selected from the sidebar — every bar the chart
  // can still see is "in", so dimming would imply a narrowing that isn't there.
  const isSelected = (code: string) => !selected || selected.length === 0 || selected.includes(code);
  return (
    <Panel
      title="Outcome breakdown"
      aside={
        <div className="flex items-center gap-3 text-[11px] text-neutral-500">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-[#22c55e]" /> approved
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-[#f59e0b]" /> soft decline
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-[#ef4444]" /> hard decline
          </span>
        </div>
      }
      note={
        <p className="mb-2 text-xs text-neutral-500">Click a bar to filter the whole dashboard to that outcome.</p>
      }
    >
      {data.length === 0 ? (
        <p className="flex h-56 items-center justify-center text-sm text-neutral-500">
          No outcome data is available for the selected window.
        </p>
      ) : (
        <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 24, right: 80 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
            <XAxis type="number" tick={{ fontSize: 10, fill: "#a3a3a3" }} />
            <YAxis dataKey="outcomeCode" type="category" tick={{ fontSize: 10, fill: "#a3a3a3" }} width={120} />
            <Tooltip contentStyle={{ background: "#171717", border: "1px solid #404040", fontSize: 12 }} />
            <Bar
              dataKey="count"
              radius={[0, 4, 4, 0]}
              // Bars animating up from zero on every push and every filter
              // change is the most visible source of flashing here.
              isAnimationActive={false}
              onClick={(d) =>
                onSelect(selected?.length === 1 && selected[0] === d.outcomeCode ? undefined : d.outcomeCode)
              }
              cursor="pointer"
            >
              {data.map((o) => (
                <Cell
                  key={o.outcomeCode}
                  fill={COLORS[o.outcomeCode] ?? "#737373"}
                  opacity={isSelected(o.outcomeCode) ? 1 : 0.35}
                />
              ))}
              <LabelList dataKey="summary" position="right" fill="#a3a3a3" fontSize={10} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      )}
    </Panel>
  );
}
