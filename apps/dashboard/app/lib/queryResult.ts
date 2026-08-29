import type { QueryResult } from "@nymbus/shared";

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const finiteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const nullableNumber = (value: unknown): boolean => value === null || finiteNumber(value);
const string = (value: unknown): value is string => typeof value === "string";

/** Runtime validation for the network boundary; a TypeScript cast is not validation. */
export function isQueryResult(value: unknown): value is QueryResult {
  if (!object(value)) return false;
  if (!Array.isArray(value.trend) || !Array.isArray(value.outcomes) || !Array.isArray(value.rows)) return false;
  if (
    !Array.isArray(value.tenants) ||
    !finiteNumber(value.totalCount) ||
    !string(value.generatedAt) ||
    !Number.isFinite(Date.parse(value.generatedAt))
  ) {
    return false;
  }
  if (!object(value.latency) || !nullableNumber(value.latency.p50) || !nullableNumber(value.latency.p95)) return false;
  if (
    !object(value.previous) ||
    !finiteNumber(value.previous.totalCount) ||
    !nullableNumber(value.previous.p50) ||
    !nullableNumber(value.previous.p95) ||
    !nullableNumber(value.previous.approvalRate)
  ) {
    return false;
  }
  if (
    !value.trend.every(
      (point) =>
        object(point) &&
        typeof point.bucket === "string" &&
        finiteNumber(point.count) &&
        nullableNumber(point.p95),
    )
  ) {
    return false;
  }
  if (
    !value.outcomes.every(
      (outcome) => object(outcome) && typeof outcome.outcomeCode === "string" && finiteNumber(outcome.count),
    )
  ) {
    return false;
  }
  if (
    !value.rows.every(
      (row) =>
        object(row) &&
        finiteNumber(row.id) &&
        string(row.eventTs) &&
        string(row.tenantId) &&
        string(row.eftVendor) &&
        string(row.messageType) &&
        (row.txFamily === null || string(row.txFamily)) &&
        string(row.outcomeCode) &&
        string(row.sourceSystem) &&
        nullableNumber(row.amountCents) &&
        finiteNumber(row.latencyMs),
    )
  ) {
    return false;
  }
  if (
    !value.tenants.every(
      (tenant) =>
        object(tenant) &&
        string(tenant.tenantId) &&
        finiteNumber(tenant.count) &&
        nullableNumber(tenant.approvalRate) &&
        nullableNumber(tenant.p95),
    )
  ) {
    return false;
  }
  return true;
}
