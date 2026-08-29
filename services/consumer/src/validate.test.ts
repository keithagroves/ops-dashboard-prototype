import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TxEvent } from "@nymbus/shared";
import { validateTxEvent } from "./validate";

const validEvent = (overrides: Partial<TxEvent> = {}): TxEvent => ({
  eventTs: "2026-08-29T12:34:56.000Z",
  tenantId: "tenant-07",
  eftVendor: "vendor-a",
  messageType: "auth_request",
  txFamily: "purchase",
  outcomeCode: "approved",
  sourceSystem: "conn-01",
  amountCents: 1234,
  latencyMs: 120,
  ...overrides,
});

describe("validateTxEvent", () => {
  it("accepts valid authorization and non-authorization events", () => {
    assert.equal(validateTxEvent(validEvent()), true);
    assert.equal(
      validateTxEvent(validEvent({ messageType: "reversal", txFamily: null, amountCents: null })),
      true,
    );
  });

  it("rejects values that are not event objects", () => {
    assert.equal(validateTxEvent(null), false);
    assert.equal(validateTxEvent([]), false);
    assert.equal(validateTxEvent("event"), false);
  });

  it("rejects invalid timestamps, empty identifiers, and unknown enums", () => {
    assert.equal(validateTxEvent(validEvent({ eventTs: "not-a-date" })), false);
    assert.equal(validateTxEvent(validEvent({ tenantId: "" })), false);
    assert.equal(validateTxEvent(validEvent({ sourceSystem: "" })), false);
    assert.equal(validateTxEvent({ ...validEvent(), eftVendor: "unknown" }), false);
    assert.equal(validateTxEvent({ ...validEvent(), outcomeCode: "mystery" }), false);
  });

  it("requires txFamily to be null for non-authorization messages", () => {
    assert.equal(validateTxEvent(validEvent({ messageType: "advice", txFamily: "payment" })), false);
    assert.equal(validateTxEvent(validEvent({ messageType: "network_management", txFamily: null })), true);
  });

  it("accepts only safe integer amounts", () => {
    assert.equal(validateTxEvent(validEvent({ amountCents: null })), true);
    assert.equal(validateTxEvent(validEvent({ amountCents: -500 })), true);
    assert.equal(validateTxEvent(validEvent({ amountCents: 1.5 })), false);
    assert.equal(validateTxEvent(validEvent({ amountCents: Number.MAX_SAFE_INTEGER + 1 })), false);
  });

  it("accepts only non-negative Postgres int4 latency values", () => {
    assert.equal(validateTxEvent(validEvent({ latencyMs: 0 })), true);
    assert.equal(validateTxEvent(validEvent({ latencyMs: 2_147_483_647 })), true);
    assert.equal(validateTxEvent(validEvent({ latencyMs: -1 })), false);
    assert.equal(validateTxEvent(validEvent({ latencyMs: 1.5 })), false);
    assert.equal(validateTxEvent(validEvent({ latencyMs: 2_147_483_648 })), false);
  });
});
