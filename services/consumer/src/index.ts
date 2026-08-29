import { Kafka } from "kafkajs";
import { Pool } from "pg";
import Redis from "ioredis";
import { KAFKA_TOPIC, REDIS_UPDATE_CHANNEL, type TxEvent } from "@nymbus/shared";
import { insertBatch, type IngestRecord } from "./batchWriter";
import { validateTxEvent } from "./validate";

const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || "localhost:9092").split(",");
const PG_URL = process.env.DATABASE_URL || "postgres://nymbus:nymbus@localhost:5433/ops_dashboard";
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const RETENTION_MINUTES = Number(process.env.RETENTION_MINUTES || 30);

async function main() {
  const pool = new Pool({ connectionString: PG_URL });
  // Both pg's Pool and ioredis's client are EventEmitters that throw and
  // crash the process on an unhandled 'error' event - discovered by
  // actually restarting Postgres under a live consumer, not by inspection.
  pool.on("error", (err) => {
    console.error("[consumer] postgres pool error (will retry on next batch):", err.message);
  });

  // enableOfflineQueue:false + a low maxRetriesPerRequest make a publish()
  // fail fast (reject) instead of queuing/retrying for ~10s while Redis is
  // unreachable - measured at 10.5s with ioredis's defaults, which is 10.5s
  // every batch spent blocked before ever reaching resolveOffset below.
  const redis = new Redis(REDIS_URL, { enableOfflineQueue: false, maxRetriesPerRequest: 1, connectTimeout: 1000 });
  redis.on("error", (err) => {
    console.error("[consumer] redis connection error (publish will fail and be logged, not fatal):", err.message);
  });

  const PUBLISH_TIMEOUT_MS = 500;
  function publishWithTimeout(channel: string, message: string): Promise<void> {
    // Belt-and-suspenders on top of the client config above: notification
    // delivery must never be able to hold up offset commits, regardless of
    // exactly how a future ioredis version's retry/queue defaults behave.
    return Promise.race([
      redis.publish(channel, message).then(() => undefined),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error(`redis publish exceeded ${PUBLISH_TIMEOUT_MS}ms`)), PUBLISH_TIMEOUT_MS),
      ),
    ]);
  }

  const kafka = new Kafka({ clientId: "tx-consumer", brokers: KAFKA_BROKERS });
  const consumer = kafka.consumer({ groupId: "tx-consumer-group" });

  await consumer.connect();
  await consumer.subscribe({ topic: KAFKA_TOPIC, fromBeginning: true });

  let totalWritten = 0;

  // We let kafkajs's own batch formation (fetch size / wait time) drive
  // write granularity rather than layering a second buffer on top -
  // resolveOffset only happens after a successful Postgres write, so a
  // crash mid-batch just replays that batch on restart instead of losing it.
  await consumer.run({
    eachBatch: async ({ batch, resolveOffset, heartbeat, commitOffsetsIfNecessary, isRunning, isStale }) => {
      if (!isRunning() || isStale()) return;

      const records: IngestRecord[] = [];
      for (const message of batch.messages) {
        if (!message.value) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(message.value.toString());
        } catch {
          console.warn(
            `[consumer] skipping malformed JSON: topic=${batch.topic} partition=${batch.partition} offset=${message.offset}`,
          );
          continue;
        }
        if (!validateTxEvent(parsed)) {
          console.warn(
            `[consumer] skipping invalid TxEvent shape: topic=${batch.topic} partition=${batch.partition} offset=${message.offset}`,
          );
          continue;
        }
        records.push({ event: parsed as TxEvent, partition: batch.partition, offset: message.offset });
      }

      // insertBatch is intentionally left to throw on a genuine failure
      // (e.g. Postgres unreachable) - offsets below won't resolve, so
      // kafkajs replays this batch rather than silently losing it. The
      // records that make it this far have already passed validation, so
      // ON CONFLICT DO NOTHING is what keeps that replay from duplicating
      // rows instead of a second application-level validation pass.
      if (records.length > 0) {
        await insertBatch(pool, records);
        totalWritten += records.length;

        // A Redis outage should never block the Kafka offset commit below -
        // the write already succeeded and is the thing that matters.
        try {
          await publishWithTimeout(REDIS_UPDATE_CHANNEL, JSON.stringify({ count: records.length, at: Date.now() }));
        } catch (err) {
          console.warn(`[consumer] failed to publish update notification: ${(err as Error).message}`);
        }
      }

      for (const message of batch.messages) {
        resolveOffset(message.offset);
      }
      await heartbeat();
      await commitOffsetsIfNecessary();
    },
  });

  setInterval(() => {
    console.log(`[consumer] totalWritten=${totalWritten}`);
  }, 5000);

  // Stand-in for production's partition-drop retention: cheap enough at
  // demo volume, and keeps the "rolling window" feeling honest live.
  setInterval(async () => {
    try {
      const result = await pool.query(
        `DELETE FROM tx_events WHERE event_ts < now() - interval '${RETENTION_MINUTES} minutes'`,
      );
      console.log(`[consumer] retention cleanup removed ${result.rowCount ?? 0} rows`);
    } catch (err) {
      console.error(`[consumer] retention cleanup failed, will retry next interval: ${(err as Error).message}`);
    }
  }, 30_000);
}

main().catch((err) => {
  console.error("[consumer] fatal", err);
  process.exit(1);
});
