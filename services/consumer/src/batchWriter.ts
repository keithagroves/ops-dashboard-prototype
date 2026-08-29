import type { Pool } from "pg";
import type { TxEvent } from "@nymbus/shared";

export interface IngestRecord {
  event: TxEvent;
  partition: number;
  offset: string;
}

export const MAX_INSERT_BATCH_SIZE = 1_000;

export async function insertBatch(pool: Pool, records: IngestRecord[]): Promise<void> {
  if (records.length === 0) return;
  if (records.length > MAX_INSERT_BATCH_SIZE) {
    throw new Error(`insert batch exceeds ${MAX_INSERT_BATCH_SIZE} records`);
  }

  const columns = [
    "event_ts",
    "tenant_id",
    "eft_vendor",
    "message_type",
    "tx_family",
    "outcome_code",
    "source_system",
    "amount_cents",
    "latency_ms",
    "kafka_partition",
    "kafka_offset",
  ];

  const values: unknown[] = [];
  const rows: string[] = [];

  records.forEach(({ event: e, partition, offset }, i) => {
    const base = i * columns.length;
    rows.push(`(${columns.map((_, j) => `$${base + j + 1}`).join(", ")})`);
    values.push(
      e.eventTs,
      e.tenantId,
      e.eftVendor,
      e.messageType,
      e.txFamily,
      e.outcomeCode,
      e.sourceSystem,
      e.amountCents,
      e.latencyMs,
      partition,
      offset,
    );
  });

  // ON CONFLICT DO NOTHING on (kafka_partition, kafka_offset) is what makes
  // this safe to call twice with an overlapping batch after a crash/replay.
  const sql = `
    INSERT INTO tx_events (${columns.join(", ")})
    VALUES ${rows.join(", ")}
    ON CONFLICT (kafka_partition, kafka_offset) DO NOTHING
  `;
  await pool.query(sql, values);
}

/**
 * KafkaJS controls fetch formation and can return more than 1,000 messages.
 * Split that fetch into bounded multi-row inserts while preserving ordering.
 * Offsets are still committed only after every chunk succeeds, and replay of
 * an earlier successful chunk remains safe through the Kafka-coordinate
 * uniqueness constraint.
 */
export async function insertInBatches(pool: Pool, records: IngestRecord[]): Promise<void> {
  for (let start = 0; start < records.length; start += MAX_INSERT_BATCH_SIZE) {
    await insertBatch(pool, records.slice(start, start + MAX_INSERT_BATCH_SIZE));
  }
}
