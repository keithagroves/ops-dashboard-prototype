"use client";

import type { DrilldownRow } from "@nymbus/shared";
import { Panel } from "./Panel";

const OUTCOME_STYLE: Record<string, string> = {
  approved: "text-emerald-400",
};

export function DrilldownTable({ rows }: { rows: DrilldownRow[] }) {
  return (
    <Panel title={`Recent transactions (${rows.length})`}>
      <div className="max-h-80 overflow-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-neutral-950 text-neutral-500">
            <tr>
              <th className="py-1 pr-3">Time</th>
              <th className="py-1 pr-3">Tenant</th>
              <th className="py-1 pr-3">Vendor</th>
              <th className="py-1 pr-3">Type</th>
              <th className="py-1 pr-3">Family</th>
              <th className="py-1 pr-3">Outcome</th>
              <th className="py-1 pr-3">Amount</th>
              <th className="py-1 pr-3">Latency</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-neutral-900 text-neutral-300">
                <td className="py-1 pr-3">{new Date(r.eventTs).toLocaleTimeString()}</td>
                <td className="py-1 pr-3">{r.tenantId}</td>
                <td className="py-1 pr-3">{r.eftVendor}</td>
                <td className="py-1 pr-3">{r.messageType}</td>
                <td className="py-1 pr-3">{r.txFamily ?? "—"}</td>
                <td className={`py-1 pr-3 ${OUTCOME_STYLE[r.outcomeCode] ?? "text-red-400"}`}>{r.outcomeCode}</td>
                <td className="py-1 pr-3">{r.amountCents != null ? `$${(r.amountCents / 100).toFixed(2)}` : "—"}</td>
                <td className={`py-1 pr-3 ${r.latencyMs > 500 ? "text-amber-400" : ""}`}>{r.latencyMs}ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
