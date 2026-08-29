import { OUTCOME_CODES, type OutcomeCode } from "@nymbus/shared";

type Environment = Record<string, string | undefined>;

function envNumber(
  env: Environment,
  name: string,
  fallback: number,
  valid: (value: number) => boolean,
): number {
  const raw = env[name];
  if (!raw?.trim()) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && valid(value) ? value : fallback;
}

export function loadConfig(env: Environment = process.env) {
  const tenantCount = envNumber(env, "TENANT_COUNT", 50, (value) => Number.isInteger(value) && value > 0);
  const requestedOutcome = env.INCIDENT_OUTCOME;
  const incidentOutcome = (OUTCOME_CODES as readonly string[]).includes(requestedOutcome ?? "")
    ? (requestedOutcome as OutcomeCode)
    : "insufficient_funds";
  const kafkaBrokers = (env.KAFKA_BROKERS ?? "")
    .split(",")
    .map((broker) => broker.trim())
    .filter(Boolean);

  return {
    tps: envNumber(env, "TPS", 30, (value) => value > 0),
    tenantCount,
    // Fraction of traffic sent to a small "hot" subset of tenants, mirroring
    // the spec's ~2 TPS baseline vs ~15 TPS for the busiest clients.
    hotTenantRatio: envNumber(env, "HOT_TENANT_RATIO", 0.6, (value) => value >= 0 && value <= 1),
    hotTenantFraction: envNumber(env, "HOT_TENANT_FRACTION", 0.1, (value) => value > 0 && value <= 1),
    latencyMeanMs: envNumber(env, "LATENCY_MEAN_MS", 120, (value) => value > 0),
    latencyP99Ms: envNumber(env, "LATENCY_P99_MS", 600, (value) => value > 0),
    // Incident mode: briefly spikes a specific outcome code for a specific
    // tenant so the drill-down demo has something real to find.
    incidentMode: env.INCIDENT_MODE === "true",
    incidentTenantIndex: envNumber(
      env,
      "INCIDENT_TENANT_INDEX",
      0,
      (value) => Number.isInteger(value) && value >= 0 && value < tenantCount,
    ),
    incidentOutcome,
    incidentIntervalSec: envNumber(env, "INCIDENT_INTERVAL_SEC", 45, (value) => value > 0),
    incidentDurationSec: envNumber(env, "INCIDENT_DURATION_SEC", 10, (value) => value > 0),
    kafkaBrokers: kafkaBrokers.length > 0 ? kafkaBrokers : ["localhost:9092"],
  };
}

export const config = loadConfig();
