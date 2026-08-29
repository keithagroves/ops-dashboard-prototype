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

// latency_ms is a Postgres INTEGER (int4): -2147483648..2147483647. A
// fractional value (e.g. 1.5) or one outside int4 range is valid JS `number`
// but invalid Postgres integer input - Number.isFinite() alone let both
// through, which meant a validated record could still fail the INSERT and
// re-trigger the exact poison-message problem this file exists to prevent.
const INT4_MAX = 2147483647;

function isValidLatencyMs(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= INT4_MAX;
}

// amount_cents is BIGINT, but JS numbers only represent integers exactly up
// to Number.MAX_SAFE_INTEGER - requiring a safe integer is the real
// constraint here (a "finite" fractional or huge float is neither safe nor
// valid bigint input).
function isValidAmountCents(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v);
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
  // Reversal/advice/network-management records do not represent a new
  // transaction authorization, so Requirement 2.4 requires their family to
  // be null. Shape validation must enforce the relationship, not just validate
  // each field independently.
  if (v.messageType !== "auth_request" && v.txFamily !== null) return false;
  if (!isOneOf(v.outcomeCode, OUTCOME_CODES)) return false;
  if (!isNonEmptyString(v.sourceSystem)) return false;
  if (v.amountCents !== null && !isValidAmountCents(v.amountCents)) return false;
  if (!isValidLatencyMs(v.latencyMs)) return false;

  return true;
}
