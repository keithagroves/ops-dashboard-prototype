"use client";

import {
  EFT_VENDORS,
  MESSAGE_TYPES,
  OUTCOME_CODES,
  TX_FAMILIES,
  tenantIds,
  type QueryFilters,
} from "@nymbus/shared";

const TENANTS = tenantIds(50);

function Select({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-neutral-400">
      {label}
      <select
        className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100 disabled:opacity-40"
        value={value}
        disabled={disabled}
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
}

export function FilterBar({
  filters,
  onChange,
  connected,
}: {
  filters: QueryFilters;
  onChange: (patch: Partial<QueryFilters>) => void;
  connected: boolean;
}) {
  const isTenantRole = filters.role === "tenant";

  return (
    <div className="flex flex-wrap items-end gap-4 rounded-lg border border-neutral-800 bg-neutral-950 p-4">
      <div className="flex flex-col gap-1 text-xs text-neutral-400">
        Audience
        <div className="flex overflow-hidden rounded border border-neutral-700">
          <button
            className={`px-3 py-1 text-sm ${isTenantRole ? "bg-blue-600 text-white" : "bg-neutral-900 text-neutral-300"}`}
            onClick={() => onChange({ role: "tenant", tenantId: filters.tenantId || TENANTS[0] })}
          >
            Tenant view
          </button>
          <button
            className={`px-3 py-1 text-sm ${!isTenantRole ? "bg-blue-600 text-white" : "bg-neutral-900 text-neutral-300"}`}
            onClick={() => onChange({ role: "global" })}
          >
            Global ops view
          </button>
        </div>
      </div>

      <Select
        label={isTenantRole ? "Logged in as tenant" : "Drill into tenant (optional)"}
        value={filters.tenantId || ""}
        onChange={(v) => onChange({ tenantId: v || undefined })}
        options={[
          ...(isTenantRole ? [] : [{ value: "", label: "All tenants" }]),
          ...TENANTS.map((t) => ({ value: t, label: t })),
        ]}
      />

      <Select
        label="EFT vendor"
        value={filters.eftVendor || ""}
        onChange={(v) => onChange({ eftVendor: (v || undefined) as QueryFilters["eftVendor"] })}
        options={[{ value: "", label: "All vendors" }, ...EFT_VENDORS.map((v) => ({ value: v, label: v }))]}
      />

      <Select
        label="Message type"
        value={filters.messageType || ""}
        onChange={(v) => onChange({ messageType: (v || undefined) as QueryFilters["messageType"] })}
        options={[{ value: "", label: "All types" }, ...MESSAGE_TYPES.map((v) => ({ value: v, label: v }))]}
      />

      <Select
        label="Tx family"
        value={filters.txFamily || ""}
        onChange={(v) => onChange({ txFamily: (v || undefined) as QueryFilters["txFamily"] })}
        options={[{ value: "", label: "All families" }, ...TX_FAMILIES.map((v) => ({ value: v, label: v }))]}
      />

      <Select
        label="Outcome"
        value={filters.outcomeCode || ""}
        onChange={(v) => onChange({ outcomeCode: (v || undefined) as QueryFilters["outcomeCode"] })}
        options={[{ value: "", label: "All outcomes" }, ...OUTCOME_CODES.map((v) => ({ value: v, label: v }))]}
      />

      <Select
        label="Window"
        value={String(filters.windowMinutes ?? 15)}
        onChange={(v) => onChange({ windowMinutes: Number(v) })}
        options={[
          { value: "5", label: "Last 5 min" },
          { value: "15", label: "Last 15 min" },
          { value: "30", label: "Last 30 min" },
        ]}
      />

      <div className="ml-auto flex items-center gap-2 text-xs text-neutral-400">
        <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-500" : "bg-red-500"}`} />
        {connected ? "live" : "disconnected"}
      </div>
    </div>
  );
}
