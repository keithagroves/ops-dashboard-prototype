"use client";

import { memo } from "react";

export interface Segment {
  value: string;
  label: string;
}

/**
 * For small sets of mutually exclusive options that are changed often. Unlike
 * a <select>, every choice is visible and switching costs one click instead
 * of open-scan-click.
 */
function SegmentedControlView({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Segment[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1 text-xs text-neutral-400">
      <span id={`seg-${label}`}>{label}</span>
      <div role="radiogroup" aria-labelledby={`seg-${label}`} className="flex overflow-hidden rounded border border-neutral-700">
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(o.value)}
              className={`flex-1 px-2 py-1 text-xs whitespace-nowrap ${
                selected ? "bg-blue-600 text-white" : "bg-neutral-900 text-neutral-300 hover:bg-neutral-800"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export const SegmentedControl = memo(SegmentedControlView);
