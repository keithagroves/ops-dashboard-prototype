import type { OutcomeBreakdownPoint } from "@nymbus/shared";

/** Share of transactions with outcome `approved`, or null when the window is empty. */
export function approvalRateOf(outcomes: OutcomeBreakdownPoint[]): number | null {
  const total = outcomes.reduce((sum, o) => sum + o.count, 0);
  if (total === 0) return null;
  const approved = outcomes.find((o) => o.outcomeCode === "approved")?.count ?? 0;
  return approved / total;
}
