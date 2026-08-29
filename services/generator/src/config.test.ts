import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadConfig } from "./config";

describe("loadConfig", () => {
  it("provides safe, laptop-friendly defaults", () => {
    assert.deepEqual(loadConfig({}), {
      tps: 30,
      tenantCount: 50,
      hotTenantRatio: 0.6,
      hotTenantFraction: 0.1,
      latencyMeanMs: 120,
      latencyP99Ms: 600,
      metricsPort: 9464,
      incidentMode: false,
      incidentTenantIndex: 0,
      incidentOutcome: "insufficient_funds",
      incidentIntervalSec: 45,
      incidentDurationSec: 10,
      kafkaBrokers: ["localhost:9092"],
    });
  });

  it("parses valid operator overrides", () => {
    const config = loadConfig({
      TPS: "150",
      TENANT_COUNT: "12",
      HOT_TENANT_RATIO: "0.7",
      HOT_TENANT_FRACTION: "0.25",
      LATENCY_MEAN_MS: "80",
      LATENCY_P99_MS: "450",
      METRICS_PORT: "9100",
      INCIDENT_MODE: "true",
      INCIDENT_TENANT_INDEX: "11",
      INCIDENT_OUTCOME: "issuer_unavailable",
      INCIDENT_INTERVAL_SEC: "20",
      INCIDENT_DURATION_SEC: "5",
      KAFKA_BROKERS: " kafka-1:9092, kafka-2:9092 ",
    });

    assert.equal(config.tps, 150);
    assert.equal(config.tenantCount, 12);
    assert.equal(config.hotTenantRatio, 0.7);
    assert.equal(config.hotTenantFraction, 0.25);
    assert.equal(config.incidentMode, true);
    assert.equal(config.metricsPort, 9100);
    assert.equal(config.incidentTenantIndex, 11);
    assert.equal(config.incidentOutcome, "issuer_unavailable");
    assert.deepEqual(config.kafkaBrokers, ["kafka-1:9092", "kafka-2:9092"]);
  });

  it("falls back for malformed, fractional, or out-of-range values", () => {
    const config = loadConfig({
      TPS: "0",
      TENANT_COUNT: "2.5",
      HOT_TENANT_RATIO: "1.1",
      HOT_TENANT_FRACTION: "0",
      LATENCY_MEAN_MS: "NaN",
      LATENCY_P99_MS: "-1",
      METRICS_PORT: "70000",
      INCIDENT_TENANT_INDEX: "-1",
      INCIDENT_OUTCOME: "invented_code",
      INCIDENT_INTERVAL_SEC: "Infinity",
      INCIDENT_DURATION_SEC: "0",
      KAFKA_BROKERS: " , ",
    });

    assert.equal(config.tps, 30);
    assert.equal(config.tenantCount, 50);
    assert.equal(config.hotTenantRatio, 0.6);
    assert.equal(config.hotTenantFraction, 0.1);
    assert.equal(config.latencyMeanMs, 120);
    assert.equal(config.latencyP99Ms, 600);
    assert.equal(config.metricsPort, 9464);
    assert.equal(config.incidentTenantIndex, 0);
    assert.equal(config.incidentOutcome, "insufficient_funds");
    assert.equal(config.incidentIntervalSec, 45);
    assert.equal(config.incidentDurationSec, 10);
    assert.deepEqual(config.kafkaBrokers, ["localhost:9092"]);
  });

  it("validates the incident index against the configured tenant count", () => {
    const base = {
      INCIDENT_MODE: "true",
      INCIDENT_INTERVAL_SEC: "10",
      INCIDENT_DURATION_SEC: "5",
      INCIDENT_OUTCOME: "do_not_honor",
      TENANT_COUNT: "3",
    };
    assert.equal(loadConfig({ ...base, INCIDENT_TENANT_INDEX: "2" }).incidentTenantIndex, 2);
    assert.throws(() => loadConfig({ ...base, INCIDENT_TENANT_INDEX: "3" }), /INCIDENT_TENANT_INDEX/);
  });

  it("requires every incident setting when incident mode is enabled", () => {
    const valid = {
      INCIDENT_MODE: "true",
      INCIDENT_TENANT_INDEX: "1",
      INCIDENT_INTERVAL_SEC: "10",
      INCIDENT_DURATION_SEC: "5",
      INCIDENT_OUTCOME: "do_not_honor",
    };
    for (const name of [
      "INCIDENT_TENANT_INDEX",
      "INCIDENT_INTERVAL_SEC",
      "INCIDENT_DURATION_SEC",
      "INCIDENT_OUTCOME",
    ] as const) {
      const env = { ...valid, [name]: undefined };
      assert.throws(() => loadConfig(env), new RegExp(name));
    }
  });

  it("rejects an incident duration longer than its cycle", () => {
    assert.throws(
      () =>
        loadConfig({
          INCIDENT_MODE: "true",
          INCIDENT_TENANT_INDEX: "1",
          INCIDENT_INTERVAL_SEC: "5",
          INCIDENT_DURATION_SEC: "10",
          INCIDENT_OUTCOME: "do_not_honor",
        }),
      /INCIDENT_DURATION_SEC/,
    );
  });
});
