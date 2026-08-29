"use client";

import { memo, useCallback } from "react";
import {
  EFT_VENDORS,
  MESSAGE_TYPES,
  TX_FAMILIES,
  outcomesOfSeverity,
  type AuthClaims,
  type OutcomeSeverity,
  type QueryFilters,
} from "@nymbus/shared";
import { LiveIndicator } from "./LiveIndicator";
import { SegmentedControl, type Segment } from "./SegmentedControl";
import { CheckboxGroup } from "./CheckboxGroup";
import { hasActiveFilters } from "../lib/activeFilters";
import { severityOf } from "../lib/outcomeSeverity";

interface SelectOption {
  value: string;
  label: string;
}

const TX_FAMILY_OPTIONS: SelectOption[] = [
  { value: "", label: "All families" },
  ...TX_FAMILIES.map((value) => ({ value, label: value })),
];

// Three exclusive options changed constantly during triage: visible as a
// segmented control rather than hidden behind a dropdown.
const WINDOW_SEGMENTS: Segment[] = [
  { value: "5", label: "5m" },
  { value: "15", label: "15m" },
  { value: "30", label: "30m" },
];

// "Are we declining more than usual" comes before "which code", and no single
// outcome code answers it — each of these maps to a set.
const SEVERITY_SEGMENTS: Segment[] = [
  { value: "", label: "All" },
  { value: "approved", label: "Appr" },
  { value: "soft_decline", label: "Soft" },
  { value: "hard_decline", label: "Hard" },
];

const Select = memo(function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-neutral-400">
      {label}
      <select
        className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
});

export function FilterSidebar({
  filters,
  onChange,
  connected,
  lastEventAt,
  claims,
  onSignOut,
  onClearAll,
  updating,
}: {
  filters: QueryFilters;
  onChange: (patch: Partial<QueryFilters>) => void;
  connected: boolean;
  lastEventAt: number | null;
  claims: AuthClaims;
  onSignOut: () => void;
  onClearAll: () => void;
  updating: boolean;
}) {
  // LiveIndicator changes every second, which re-renders this shell. Stable
  // callbacks plus memoized controls keep those clock ticks from re-rendering
  // every selector and rebuilding every option list.
  const changeVendor = useCallback(
    (values: string[] | undefined) => onChange({ eftVendor: values as QueryFilters["eftVendor"] }),
    [onChange],
  );
  const changeMessageType = useCallback(
    (values: string[] | undefined) => onChange({ messageType: values as QueryFilters["messageType"] }),
    [onChange],
  );
  const changeTxFamily = useCallback(
    (value: string) =>
      onChange({ txFamily: value ? ([value] as QueryFilters["txFamily"]) : undefined }),
    [onChange],
  );
  const changeSeverity = useCallback(
    (value: string) =>
      onChange({
        outcomeCode: value ? (outcomesOfSeverity(value as OutcomeSeverity) as QueryFilters["outcomeCode"]) : undefined,
      }),
    [onChange],
  );
  const changeWindow = useCallback((value: string) => onChange({ windowMinutes: Number(value) }), [onChange]);

  // The severity control shows a selection only when the chosen codes are
  // exactly one severity band. Clicking a single bar in the outcome chart
  // selects one code, which is narrower than any band — that shows as "All"
  // here rather than mislabelling the state, and the chip row reports the
  // actual codes.
  const severity = severityOf(filters.outcomeCode);

  return (
    <aside className="order-first flex w-full shrink-0 flex-col self-start rounded-lg border border-neutral-800 bg-neutral-950 lg:sticky lg:top-6 lg:order-last lg:max-h-[calc(100vh-3rem)] lg:w-60">
      <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
        <h2 className="text-sm font-medium text-neutral-300">Filters</h2>
        <LiveIndicator connected={connected} lastEventAt={lastEventAt} updating={updating} />
      </div>

      <div className="flex flex-col gap-3 overflow-y-auto p-3">
        <SegmentedControl
          label="Window"
          value={String(filters.windowMinutes ?? 15)}
          options={WINDOW_SEGMENTS}
          onChange={changeWindow}
        />

        <SegmentedControl
          label="Outcome"
          value={severity ?? ""}
          options={SEVERITY_SEGMENTS}
          onChange={changeSeverity}
        />

        <CheckboxGroup
          label="EFT vendor"
          allLabel="All vendors"
          options={EFT_VENDORS}
          selected={filters.eftVendor}
          onChange={changeVendor}
        />

        <CheckboxGroup
          label="Message type"
          allLabel="All types"
          options={MESSAGE_TYPES}
          selected={filters.messageType}
          onChange={changeMessageType}
        />

        <Select
          label="Tx family"
          value={filters.txFamily?.[0] ?? ""}
          onChange={changeTxFamily}
          options={TX_FAMILY_OPTIONS}
        />

        {hasActiveFilters(filters) && (
          <button
            onClick={onClearAll}
            className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
          >
            Reset filters
          </button>
        )}
      </div>

      {/*
        Role is not a control. It comes from the signed token this session was
        issued at sign-in, and the API derives every query's scope from that -
        so this block reports the session rather than offering to change it.
      */}
      <div className="mt-auto flex items-center gap-2 border-t border-neutral-800 bg-neutral-900/40 p-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-neutral-300">{claims.sub}</p>
          <p className="text-[11px] text-neutral-500">
            {claims.role === "global" ? "Platform operator" : "Tenant admin"}
          </p>
        </div>
        <button
          onClick={onSignOut}
          className="ml-auto shrink-0 rounded border border-neutral-700 px-2 py-1 text-[11px] text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
