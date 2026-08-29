"use client";

/**
 * The shell every dashboard panel shares. Extracted so the loading skeleton is
 * literally the same chrome as the loaded panel rather than a hand-copied
 * approximation of it — the two cannot drift apart and change size between
 * states, which is what made filter changes feel like a page reload.
 */
export function Panel({
  title,
  aside,
  note,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  note?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium text-neutral-300">{title}</h2>
        {aside}
      </div>
      {note}
      {children}
    </div>
  );
}

/** A neutral block standing in for content that has not arrived yet. */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`animate-pulse rounded bg-neutral-800/60 motion-reduce:animate-none ${className}`}
    />
  );
}
