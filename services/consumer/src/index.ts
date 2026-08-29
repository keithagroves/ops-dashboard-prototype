import { Kafka } from "kafkajs";
import { Pool } from "pg";
import Redis from "ioredis";
import { KAFKA_TOPIC, REDIS_UPDATE_CHANNEL, type TxEvent } from "@nymbus/shared";
import { insertBatch } from "./batchWriter";

const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || "localhost:9092").split(",");
const PG_URL = process.env.DATABASE_URL || "postgres://nymbus:nymbus@localhost:5433/ops_dashboard";
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const RETENTION_MINUTES = Number(process.env.RETENTION_MINUTES || 30);

async function main() {
  const pool = new Pool({ connectionString: PG_URL });
  const redis = new Redis(REDIS_URL);

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

      const events: TxEvent[] = [];
      for (const message of batch.messages) {
        if (!message.value) continue;
        try {
          events.push(JSON.parse(message.value.toString()) as TxEvent);
        } catch {
          console.warn("[consumer] skipping malformed message");
        }
      }

      if (events.length > 0) {
        await insertBatch(pool, events);
        totalWritten += events.length;
        await redis.publish(REDIS_UPDATE_CHANNEL, JSON.stringify({ count: events.length, at: Date.now() }));
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
    const result = await pool.query(
      `DELETE FROM tx_events WHERE event_ts < now() - interval '${RETENTION_MINUTES} minutes'`,
    );
    if (result.rowCount) {
      console.log(`[consumer] retention cleanup removed ${result.rowCount} rows`);
    }
  }, 30_000);
}

main().catch((err) => {
  console.error("[consumer] fatal", err);
  process.exit(1);
});
