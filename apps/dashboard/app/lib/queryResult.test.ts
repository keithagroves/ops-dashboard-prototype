import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { QueryResult } from "@nymbus/shared";
import { isQueryResult } from "./queryResult";

const result: QueryResult = {
  trend: [{ bucket: "2026-08-29T12:00:00.000Z", count: 3, p95: 120 }],
  outcomes: [{ outcomeCode: "approved", count: 3 }],
  latency: { p50: 80, p95: 120 },
  rows: [],
  totalCount: 3,
  previous: { totalCount: 2, p50: null, p95: null, approvalRate: 1 },
  tenants: [],
  generatedAt: "2026-08-29T12:00:01.000Z",
};

describe("isQueryResult", () => {
  it("accepts the complete API result shape", () => {
    assert.equal(isQueryResult(result), true);
  });

  it("rejects malformed JSON values and incomplete payloads", () => {
    assert.equal(isQueryResult(null), false);
    assert.equal(isQueryResult({}), false);
    assert.equal(isQueryResult({ ...result, tenants: undefined }), false);
    assert.equal(isQueryResult({ ...result, latency: { p50: "fast", p95: 100 } }), false);
  });

  it("rejects malformed trend and outcome members", () => {
    assert.equal(isQueryResult({ ...result, trend: [{ bucket: "now", count: "three", p95: null }] }), false);
    assert.equal(isQueryResult({ ...result, outcomes: [{ outcomeCode: "approved" }] }), false);
  });

  it("rejects malformed row, tenant, and timestamp members", () => {
    assert.equal(isQueryResult({ ...result, rows: [{ id: 1 }] }), false);
    assert.equal(isQueryResult({ ...result, tenants: [{ tenantId: "tenant-01", count: "many" }] }), false);
    assert.equal(isQueryResult({ ...result, generatedAt: "not-a-date" }), false);
  });
});
