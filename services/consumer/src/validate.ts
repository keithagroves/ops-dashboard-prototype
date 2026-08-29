import {
  EFT_VENDORS,
  MESSAGE_TYPES,
  OUTCOME_CODES,
  TX_FAMILIES,
  type TxEvent,
} from "@nymbus/shared";

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isOneOf<T extends string>(v: unknown, allowed: readonly T[]): v is T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v);
}

// Guards against a "poison pill" message: a Kafka payload that parses as
// valid JSON but doesn't have the shape TxEvent promises. Without this, a
// single malformed message (e.g. `{}`) reaches the INSERT, fails a NOT NULL
// constraint, throws out of eachBatch before any offset is resolved, and
// gets refetched and re-thrown forever - halting the whole partition.
export function validateTxEvent(value: unknown): value is TxEvent {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;

  if (!isNonEmptyString(v.eventTs) || Number.isNaN(Date.parse(v.eventTs))) return false;
  if (!isNonEmptyString(v.tenantId)) return false;
  if (!isOneOf(v.eftVendor, EFT_VENDORS)) return false;
  if (!isOneOf(v.messageType, MESSAGE_TYPES)) return false;
  if (v.txFamily !== null && !isOneOf(v.txFamily, TX_FAMILIES)) return false;
  if (!isOneOf(v.outcomeCode, OUTCOME_CODES)) return false;
  if (!isNonEmptyString(v.sourceSystem)) return false;
  if (v.amountCents !== null && !(typeof v.amountCents === "number" && Number.isFinite(v.amountCents))) return false;
  if (!(typeof v.latencyMs === "number" && Number.isFinite(v.latencyMs))) return false;

  return true;
}
