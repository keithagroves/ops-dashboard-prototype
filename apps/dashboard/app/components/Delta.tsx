"use client";

/**
 * Small change indicator shown beneath a KPI. `goodDirection` says which way
 * is healthy so the arrow can be colored meaningfully ("none" = just informational).
 */
export function Delta({
  delta,
  format,
  goodDirection,
}: {
  delta: number | null;
  format: (n: number) => string;
  goodDirection: "up" | "down" | "none";
}) {
  if (delta == null || !Number.isFinite(delta)) {
    return <span className="text-[11px] text-neutral-600">no prior data</span>;
  }
  const flat = Math.abs(delta) < 1e-9;
  const color = flat
    ? "text-neutral-500"
    : goodDirection === "none"
      ? "text-neutral-400"
      : (delta > 0 ? "up" : "down") === goodDirection
        ? "text-emerald-400"
        : "text-red-400";
  const arrow = flat ? "→" : delta > 0 ? "▲" : "▼";
  return (
    <span className={`text-[11px] ${color}`}>
      {arrow} {format(Math.abs(delta))} <span className="text-neutral-600">vs prev</span>
    </span>
  );
}
