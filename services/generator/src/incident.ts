import type { OutcomeCode } from "@nymbus/shared";

interface IncidentSettings {
  enabled: boolean;
  tenantIndex: number;
  tenantId: string;
  outcomeCode: OutcomeCode;
  intervalSec: number;
  durationSec: number;
}

export interface ActiveIncident {
  tenantId: string;
  outcomeCode: OutcomeCode;
  endsAt: number;
}

export type IncidentTransition =
  | { type: "started"; incident: ActiveIncident; tenantIndex: number }
  | { type: "cleared"; incident: ActiveIncident };

/** Deterministic repeating incident clock used by the generator loop. */
export function createIncidentController(
  settings: IncidentSettings,
  startedAt = Date.now(),
): {
  tick: (now?: number) => IncidentTransition[];
  current: () => ActiveIncident | null;
} {
  const intervalMs = settings.intervalSec * 1_000;
  const durationMs = settings.durationSec * 1_000;
  let nextStartAt = startedAt + intervalMs;
  let active: ActiveIncident | null = null;

  const tick = (now = Date.now()): IncidentTransition[] => {
    if (!settings.enabled) return [];
    const transitions: IncidentTransition[] = [];

    if (active && now >= active.endsAt) {
      transitions.push({ type: "cleared", incident: active });
      active = null;
    }

    if (!active && now >= nextStartAt) {
      active = {
        tenantId: settings.tenantId,
        outcomeCode: settings.outcomeCode,
        endsAt: now + durationMs,
      };
      transitions.push({ type: "started", incident: active, tenantIndex: settings.tenantIndex });

      // Keep the cycle anchored to its configured interval. If the event loop
      // was paused for several cycles, skip missed starts instead of emitting
      // a burst of backdated incidents.
      do nextStartAt += intervalMs;
      while (nextStartAt <= now);
    }

    return transitions;
  };

  return { tick, current: () => active };
}
