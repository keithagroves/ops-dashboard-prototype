"use client";

import { useEffect, useState } from "react";

/**
 * Connection dot plus "updated Ns ago" — so a silently stalled SSE stream
 * (connected socket, no frames) is visible rather than showing frozen numbers
 * that look current.
 */
export function LiveIndicator({
  connected,
  lastEventAt,
  updating = false,
}: {
  connected: boolean;
  lastEventAt: number | null;
  /** A new stream is connecting; what is on screen belongs to older filters. */
  updating?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const ageSec = lastEventAt == null ? null : Math.max(0, Math.round((now - lastEventAt) / 1000));
  const stale = ageSec != null && ageSec > 10;
  // "updating" is a normal transition, not a fault, so it keeps the healthy dot
  // - unlike a disconnect (red) or a stream that has gone quiet (amber).
  const dotColor = !connected && !updating ? "bg-red-500" : stale ? "bg-amber-500" : "bg-emerald-500";

  return (
    <div className="flex items-center gap-2 text-xs text-neutral-400">
      <span className={`h-2 w-2 rounded-full ${dotColor}`} />
      {updating
        ? "updating…"
        : !connected
          ? "disconnected"
          : ageSec == null
            ? "connecting…"
            : `updated ${ageSec}s ago`}
    </div>
  );
}
