"use client";

import { memo } from "react";

/**
 * For small enumerated sets where an operator needs more than one value at a
 * time — comparing two vendors, or excluding heartbeat traffic. A dropdown
 * cannot express either, and with this few options there is nothing to gain
 * from hiding them behind one.
 *
 * An empty selection means "no constraint", shown as "All" rather than as
 * every box ticked, so the unfiltered state reads at a glance.
 */
function CheckboxGroupView({
  label,
  allLabel,
  options,
  selected,
  onChange,
}: {
  label: string;
  allLabel: string;
  options: readonly string[];
  selected: readonly string[] | undefined;
  onChange: (values: string[] | undefined) => void;
}) {
  const active = selected ?? [];
  const isAll = active.length === 0;

  const toggle = (value: string) => {
    const next = active.includes(value) ? active.filter((v) => v !== value) : [...active, value];
    // Collapse "nothing selected" back to undefined — the API rejects an empty
    // set, and unticking the last box means the operator wants no constraint.
    onChange(next.length === 0 ? undefined : next);
  };

  return (
    <fieldset className="flex flex-col gap-1 text-xs text-neutral-400">
      <legend className="mb-1 flex w-full items-baseline justify-between gap-2">
        <span>{label}</span>
        {!isAll && (
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className="text-[11px] text-blue-400 hover:text-blue-200"
          >
            clear
          </button>
        )}
      </legend>

      <div className="flex flex-col gap-0.5 rounded border border-neutral-800 bg-neutral-900/50 p-1.5">
        <span className={`px-1 text-[11px] ${isAll ? "text-neutral-300" : "text-neutral-600"}`}>
          {isAll ? allLabel : `${active.length} of ${options.length}`}
        </span>
        {options.map((option) => {
          const checked = active.includes(option);
          return (
            <label
              key={option}
              className="flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 hover:bg-neutral-800"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(option)}
                className="h-3 w-3 accent-blue-600"
              />
              <span className={checked ? "text-neutral-200" : "text-neutral-400"}>{option}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export const CheckboxGroup = memo(CheckboxGroupView);
