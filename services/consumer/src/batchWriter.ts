import type { Pool } from "pg";
import type { TxEvent } from "@nymbus/shared";

export async function insertBatch(pool: Pool, events: TxEvent[]): Promise<void> {
  if (events.length === 0) return;

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
  ];

  const values: unknown[] = [];
  const rows: string[] = [];

  events.forEach((e, i) => {
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
    );
  });

  const sql = `INSERT INTO tx_events (${columns.join(", ")}) VALUES ${rows.join(", ")}`;
  await pool.query(sql, values);
}
