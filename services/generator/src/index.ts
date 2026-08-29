import { Kafka } from "kafkajs";
import {
  EFT_VENDORS,
  KAFKA_TOPIC,
  MESSAGE_TYPES,
  OUTCOME_CODES,
  TX_FAMILIES,
  type EftVendor,
  type MessageType,
  type OutcomeCode,
  type TxEvent,
  type TxFamily,
} from "@nymbus/shared";
import { config } from "./config";
import { createIncidentController } from "./incident";
import { startMetricsServer, type GeneratorMetricsSnapshot } from "./metrics";
import { startFixedRate } from "./pacer";
import { createTenantPicker } from "./traffic";

const { tenants, pick: pickTenant } = createTenantPicker(
  config.tenantCount,
  config.hotTenantFraction,
  config.hotTenantRatio,
);
const sourceSystems = ["conn-01", "conn-02", "conn-03"];

function weightedPick<T extends string>(weights: [T, number][]): T {
  const total = weights.reduce((sum, [, w]) => sum + w, 0);
  let r = Math.random() * total;
  for (const [value, w] of weights) {
    r -= w;
    if (r <= 0) return value;
  }
  return weights[weights.length - 1][0];
}

function pickLatencyMs(): number {
  // Rough gaussian via sum-of-uniforms, clamped positive, with a rare long tail.
  const u1 = Math.random();
  const u2 = Math.random();
  const gaussian = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const base = Math.max(5, config.latencyMeanMs + gaussian * (config.latencyMeanMs / 3));
  if (Math.random() < 0.02) {
    return Math.round(config.latencyP99Ms + Math.random() * config.latencyP99Ms);
  }
  return Math.round(base);
}

function pickAmountCents(family: TxFamily | null): number | null {
  if (!family) return null;
  const ranges: Record<TxFamily, [number, number]> = {
    purchase: [500, 25000],
    withdrawal: [2000, 60000],
    deposit: [1000, 200000],
    transfer: [500, 500000],
    payment: [1000, 150000],
  };
  const [min, max] = ranges[family];
  return Math.round(min + Math.random() * (max - min));
}

const incident = createIncidentController({
  enabled: config.incidentMode,
  tenantIndex: config.incidentTenantIndex,
  tenantId: tenants[config.incidentTenantIndex],
  outcomeCode: config.incidentOutcome,
  intervalSec: config.incidentIntervalSec,
  durationSec: config.incidentDurationSec,
});

function maybeStartIncident() {
  for (const transition of incident.tick()) {
    if (transition.type === "started") {
      console.log(
        `[incident] started index=${transition.tenantIndex} tenant=${transition.incident.tenantId} outcome=${transition.incident.outcomeCode} duration=${config.incidentDurationSec}s`,
      );
    } else {
      console.log(
        `[incident] cleared tenant=${transition.incident.tenantId} outcome=${transition.incident.outcomeCode}`,
      );
    }
  }
}

function buildEvent(): TxEvent {
  const tenantId = pickTenant();
  const eftVendor = weightedPick<EftVendor>(EFT_VENDORS.map((v) => [v, 1]));
  const messageType = weightedPick<MessageType>([
    ["auth_request", 85],
    ["reversal", 7],
    ["advice", 5],
    ["network_management", 3],
  ]);

  const txFamily: TxFamily | null =
    messageType === "auth_request"
      ? weightedPick<TxFamily>(
          TX_FAMILIES.map((f) => [f, f === "purchase" ? 5 : 2]) as [TxFamily, number][],
        )
      : null;

  let outcomeCode: OutcomeCode;
  const activeIncident = incident.current();
  if (activeIncident && tenantId === activeIncident.tenantId && messageType === "auth_request") {
    outcomeCode = weightedPick<OutcomeCode>([
      [activeIncident.outcomeCode, 70],
      ["approved", 30],
    ]);
  } else if (messageType !== "auth_request") {
    outcomeCode = "approved";
  } else {
    outcomeCode = weightedPick<OutcomeCode>(
      OUTCOME_CODES.map((c) => [c, c === "approved" ? 90 : 2]) as [OutcomeCode, number][],
    );
  }

  return {
    eventTs: new Date().toISOString(),
    tenantId,
    eftVendor,
    messageType,
    txFamily,
    outcomeCode,
    sourceSystem: sourceSystems[Math.floor(Math.random() * sourceSystems.length)],
    amountCents: pickAmountCents(txFamily),
    latencyMs: pickLatencyMs(),
  };
}

async function main() {
  process.env.KAFKAJS_NO_PARTITIONER_WARNING = "1";
  const kafka = new Kafka({ clientId: "connector-simulator", brokers: config.kafkaBrokers });
  const producer = kafka.producer({ allowAutoTopicCreation: true });
  await producer.connect();
  console.log(`[generator] connected to Kafka, targeting ${config.tps} TPS`);

  const metrics: GeneratorMetricsSnapshot = { sent: 0, dropped: 0, inFlight: 0 };
  startMetricsServer(() => ({ ...metrics }), config.metricsPort);
  const MAX_IN_FLIGHT = 500;

  startFixedRate(() => {
    maybeStartIncident();
    const event = buildEvent();

    // Bounded fire-and-forget: never await the produce call on the "hot
    // path", but also never let unresolved sends accumulate without limit.
    // Under sustained broker degradation, kafkajs's own internal retries
    // would otherwise let in-flight promises pile up indefinitely - that's
    // memory/backpressure risk by another name, which is exactly what this
    // design is supposed to rule out. Past the cap, a tick is dropped and
    // counted immediately instead of ever calling send().
    if (metrics.inFlight >= MAX_IN_FLIGHT) {
      metrics.dropped += 1;
      return;
    }

    metrics.inFlight += 1;
    producer
      .send({
        topic: KAFKA_TOPIC,
        messages: [{ key: event.tenantId, value: JSON.stringify(event) }],
      })
      .then(() => {
        metrics.sent += 1;
      })
      .catch((err) => {
        metrics.dropped += 1;
        console.warn(`[generator] dropped event (total dropped: ${metrics.dropped}): ${err.message}`);
      })
      .finally(() => {
        metrics.inFlight -= 1;
      });
  }, config.tps);

  setInterval(() => {
    console.log(
      `[generator] sent=${metrics.sent} dropped=${metrics.dropped} inFlight=${metrics.inFlight}`,
    );
  }, 5000);
}

main().catch((err) => {
  console.error("[generator] fatal", err);
  process.exit(1);
});
