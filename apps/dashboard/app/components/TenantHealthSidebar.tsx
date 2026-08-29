"use client";

import { memo, useMemo } from "react";
import type { TenantHealthPoint } from "@nymbus/shared";
import { countNeedingAttention, health, sameTenantHealth, sortByHealth } from "../lib/tenantHealth";

const DOT = { bad: "bg-red-500", warn: "bg-amber-500", ok: "bg-emerald-500" } as const;

const pct = (r: number | null) => (r != null ? `${(r * 100).toFixed(0)}%` : "—");
const ms = (n: number | null) => (n != null ? `${Math.round(n)}ms` : "—");

/**
 * The global operator's tenant navigator. Always lists every tenant — the
 * selected one is highlighted rather than filtered out, so you can click
 * straight from one tenant to the next while drilled in.
 */
interface TenantHealthSidebarProps {
  tenants: TenantHealthPoint[];
  selected?: string;
  onSelect: (tenantId: string | undefined) => void;
}

function TenantHealthSidebarView({
  tenants,
  selected,
  onSelect,
}: TenantHealthSidebarProps) {
  const { sorted, needAttention } = useMemo(
    () => ({ sorted: sortByHealth(tenants), needAttention: countNeedingAttention(tenants) }),
    [tenants],
  );
  if (tenants.length === 0) return null;

  const rowClass = (isSel: boolean) =>
    `flex w-full items-center gap-2 border-b border-neutral-900 px-3 py-1.5 text-left text-xs last:border-b-0 ${
      isSel ? "bg-blue-950 text-blue-100" : "hover:bg-neutral-900"
    }`;

  return (
    <aside className="flex w-full shrink-0 flex-col self-start rounded-lg border border-neutral-800 bg-neutral-950 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:w-64">
      <div className="border-b border-neutral-800 px-3 py-2">
        <h2 className="text-sm font-medium text-neutral-300">Tenants</h2>
        <p className="text-[11px] text-neutral-500">
          {needAttention > 0 ? (
            <span className="font-semibold text-amber-400">{needAttention} need attention</span>
          ) : (
            "all tenants nominal"
          )}
          <span className="text-neutral-600"> · worst first</span>
        </p>
      </div>

      <div className="max-h-72 overflow-y-auto lg:max-h-none">
        <button
          onClick={() => onSelect(undefined)}
          className={`${rowClass(!selected)} font-medium`}
          aria-current={!selected}
        >
          <span className="w-2 shrink-0" />
          <span className={selected ? "text-neutral-300" : ""}>All tenants</span>
          <span className="ml-auto text-neutral-600">{sorted.length}</span>
        </button>

        {sorted.map((t) => {
          const h = health(t);
          const isSel = selected === t.tenantId;
          return (
            <button
              key={t.tenantId}
              onClick={() => onSelect(t.tenantId)}
              aria-current={isSel}
              title={`${t.tenantId} — ${h} · approval ${pct(t.approvalRate)} · p95 ${ms(t.p95)}`}
              className={rowClass(isSel)}
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[h]}`} />
              <span className="w-16 shrink-0 text-neutral-200">{t.tenantId}</span>
              <span className={`w-10 text-right tabular-nums ${h === "ok" ? "text-neutral-500" : "text-neutral-300"}`}>
                {pct(t.approvalRate)}
              </span>
              <span className="ml-auto tabular-nums text-neutral-500">{ms(t.p95)}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

export const TenantHealthSidebar = memo(
  TenantHealthSidebarView,
  (previous, next) =>
    previous.selected === next.selected &&
    previous.onSelect === next.onSelect &&
    sameTenantHealth(previous.tenants, next.tenants),
);
