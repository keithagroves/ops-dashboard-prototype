import type { Pool } from "pg";
import type { TxEvent } from "@nymbus/shared";

export interface IngestRecord {
  event: TxEvent;
  partition: number;
  offset: string;
}

export async function insertBatch(pool: Pool, records: IngestRecord[]): Promise<void> {
  if (records.length === 0) return;

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
