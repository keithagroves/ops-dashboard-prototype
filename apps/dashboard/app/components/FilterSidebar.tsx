"use client";

import { memo, useCallback } from "react";
import {
  EFT_VENDORS,
  MESSAGE_TYPES,
  OUTCOME_CODES,
  TX_FAMILIES,
  type AuthClaims,
  type QueryFilters,
} from "@nymbus/shared";
import { LiveIndicator } from "./LiveIndicator";

interface SelectOption {
  value: string;
  label: string;
}

const EFT_VENDOR_OPTIONS: SelectOption[] = [
  { value: "", label: "All vendors" },
  ...EFT_VENDORS.map((value) => ({ value, label: value })),
];
const MESSAGE_TYPE_OPTIONS: SelectOption[] = [
  { value: "", label: "All types" },
  ...MESSAGE_TYPES.map((value) => ({ value, label: value })),
];
const TX_FAMILY_OPTIONS: SelectOption[] = [
  { value: "", label: "All families" },
  ...TX_FAMILIES.map((value) => ({ value, label: value })),
];
const OUTCOME_OPTIONS: SelectOption[] = [
  { value: "", label: "All outcomes" },
  ...OUTCOME_CODES.map((value) => ({ value, label: value })),
];
const WINDOW_OPTIONS: SelectOption[] = [
  { value: "5", label: "Last 5 min" },
  { value: "15", label: "Last 15 min" },
  { value: "30", label: "Last 30 min" },
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
}: {
  filters: QueryFilters;
  onChange: (patch: Partial<QueryFilters>) => void;
  connected: boolean;
  lastEventAt: number | null;
  claims: AuthClaims;
  onSignOut: () => void;
}) {
  // SSE freshness props update this shell for every frame. Stable callbacks
  // plus memoized Select controls keep those updates from re-rendering every
  // selector and rebuilding every option list.
  const changeVendor = useCallback(
    (value: string) => onChange({ eftVendor: (value || undefined) as QueryFilters["eftVendor"] }),
    [onChange],
  );
  const changeMessageType = useCallback(
    (value: string) => onChange({ messageType: (value || undefined) as QueryFilters["messageType"] }),
    [onChange],
  );
  const changeTxFamily = useCallback(
    (value: string) => onChange({ txFamily: (value || undefined) as QueryFilters["txFamily"] }),
    [onChange],
  );
  const changeOutcome = useCallback(
    (value: string) => onChange({ outcomeCode: (value || undefined) as QueryFilters["outcomeCode"] }),
    [onChange],
  );
  const changeWindow = useCallback(
    (value: string) => onChange({ windowMinutes: Number(value) }),
    [onChange],
  );

  return (
    <aside className="order-first flex w-full shrink-0 flex-col self-start rounded-lg border border-neutral-800 bg-neutral-950 lg:sticky lg:top-6 lg:order-last lg:max-h-[calc(100vh-3rem)] lg:w-60">
      <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
        <h2 className="text-sm font-medium text-neutral-300">Filters</h2>
        <LiveIndicator connected={connected} lastEventAt={lastEventAt} />
      </div>

      <div className="flex flex-col gap-3 overflow-y-auto p-3">
        <Select
          label="EFT vendor"
          value={filters.eftVendor || ""}
          onChange={changeVendor}
          options={EFT_VENDOR_OPTIONS}
        />

        <Select
          label="Message type"
          value={filters.messageType || ""}
          onChange={changeMessageType}
          options={MESSAGE_TYPE_OPTIONS}
        />

        <Select
          label="Tx family"
          value={filters.txFamily || ""}
          onChange={changeTxFamily}
          options={TX_FAMILY_OPTIONS}
        />

        <Select
          label="Outcome"
          value={filters.outcomeCode || ""}
          onChange={changeOutcome}
          options={OUTCOME_OPTIONS}
        />

        <Select
          label="Window"
          value={String(filters.windowMinutes ?? 15)}
          onChange={changeWindow}
          options={WINDOW_OPTIONS}
        />
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
