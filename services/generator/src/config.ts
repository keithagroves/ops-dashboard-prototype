function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function envFloat(name: string, fallback: number): number {
  return envInt(name, fallback);
}

export const config = {
  tps: envFloat("TPS", 30),
  tenantCount: envInt("TENANT_COUNT", 50),
  // Fraction of traffic sent to a small "hot" subset of tenants, mirroring
  // the spec's ~2 TPS baseline vs ~15 TPS for the busiest clients.
  hotTenantRatio: envFloat("HOT_TENANT_RATIO", 0.6),
  hotTenantFraction: envFloat("HOT_TENANT_FRACTION", 0.1),
  latencyMeanMs: envFloat("LATENCY_MEAN_MS", 120),
  latencyP99Ms: envFloat("LATENCY_P99_MS", 600),
  // Incident mode: briefly spikes a specific outcome code for a specific
  // tenant so the drill-down demo has something real to find.
  incidentMode: process.env.INCIDENT_MODE === "true",
  incidentTenantIndex: envInt("INCIDENT_TENANT_INDEX", 0),
  incidentOutcome: process.env.INCIDENT_OUTCOME || "insufficient_funds",
  incidentIntervalSec: envInt("INCIDENT_INTERVAL_SEC", 45),
  incidentDurationSec: envInt("INCIDENT_DURATION_SEC", 10),
  kafkaBrokers: (process.env.KAFKA_BROKERS || "localhost:9092").split(","),
};
