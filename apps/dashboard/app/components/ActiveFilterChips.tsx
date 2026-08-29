"use client";

import { memo } from "react";
import type { QueryFilters } from "@nymbus/shared";
import { activeFilters, type ClearableKey } from "../lib/activeFilters";

/**
 * One place showing everything narrowing the current view. Replaces the
 * tenant-only banner: scrolled down the page, the KPI numbers otherwise give
 * no indication that they describe a slice rather than the whole platform.
 */
function ActiveFilterChipsView({
  filters,
  onClear,
  onClearAll,
}: {
  filters: QueryFilters;
  onClear: (key: ClearableKey) => void;
  onClearAll: () => void;
}) {
  const active = activeFilters(filters);
  if (active.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-blue-900 bg-blue-950/40 px-3 py-2">
      <span className="text-xs text-blue-400/80">Filtered by</span>

      {active.map(({ key, label, value }) => (
        <span
          key={key}
          className="flex items-center gap-1 rounded border border-blue-800 bg-blue-950 py-0.5 pr-1 pl-2 text-xs text-blue-200"
        >
          <span className="text-blue-400/80">{label}:</span>
          <span className="font-medium">{value}</span>
          <button
            onClick={() => onClear(key)}
            aria-label={`Clear ${label} filter`}
            className="rounded px-1 text-blue-400 hover:bg-blue-900 hover:text-blue-100"
          >
            ✕
          </button>
        </span>
      ))}

      {active.length > 1 && (
        <button
          onClick={onClearAll}
          className="ml-auto rounded px-2 py-0.5 text-xs text-blue-400 hover:bg-blue-900 hover:text-blue-100"
        >
          Clear all
        </button>
      )}
    </div>
  );
}

export const ActiveFilterChips = memo(ActiveFilterChipsView);
