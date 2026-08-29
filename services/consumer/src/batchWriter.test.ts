import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Pool } from "pg";
import type { TxEvent } from "@nymbus/shared";
import {
  insertBatch,
  insertInBatches,
  MAX_INSERT_BATCH_SIZE,
  type IngestRecord,
} from "./batchWriter";

const event: TxEvent = {
  eventTs: "2026-08-29T12:00:00.000Z",
  tenantId: "tenant-01",
  eftVendor: "vendor-a",
  messageType: "auth_request",
  txFamily: "purchase",
  outcomeCode: "approved",
  sourceSystem: "conn-01",
  amountCents: 100,
  latencyMs: 50,
};

const records = (count: number): IngestRecord[] =>
  Array.from({ length: count }, (_, index) => ({ event, partition: 0, offset: String(index) }));

function recordingPool() {
  const calls: { sql: string; values: unknown[] }[] = [];
  const pool = {
    query: async (sql: string, values: unknown[]) => {
      calls.push({ sql, values });
      return { rows: [], rowCount: 0 };
    },
  } as unknown as Pool;
  return { pool, calls };
}

describe("batchWriter", () => {
  it("uses one parameterized multi-row INSERT for one bounded batch", async () => {
    const { pool, calls } = recordingPool();
    await insertBatch(pool, records(2));

    assert.equal(calls.length, 1);
    assert.match(calls[0].sql, /INSERT INTO tx_events/);
    assert.match(calls[0].sql, /ON CONFLICT \(kafka_partition, kafka_offset\) DO NOTHING/);
    assert.equal(calls[0].values.length, 22);
  });

  it("rejects a direct insert above the 1,000-record contract", async () => {
    const { pool, calls } = recordingPool();
    await assert.rejects(() => insertBatch(pool, records(MAX_INSERT_BATCH_SIZE + 1)), /exceeds 1000/);
    assert.equal(calls.length, 0);
  });

  it("splits a Kafka fetch into inserts of at most 1,000 records", async () => {
    const { pool, calls } = recordingPool();
    await insertInBatches(pool, records(2_001));

    assert.equal(calls.length, 3);
    assert.deepEqual(calls.map((call) => call.values.length / 11), [1_000, 1_000, 1]);
  });
});
