import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { QueryFilters } from "@nymbus/shared";
import { buildWhere, validateFilters } from "./db";
import { ValidationError } from "./errors";

const global = (extra: Partial<QueryFilters> = {}): QueryFilters => ({ role: "global", ...extra });
const tenant = (extra: Partial<QueryFilters> = {}): QueryFilters => ({
  role: "tenant",
  tenantId: "tenant-07",
  ...extra,
});

describe("validateFilters", () => {
  it("accepts a minimal global filter set", () => {
    assert.doesNotThrow(() => validateFilters(global()));
  });

  it("requires a tenantId for role=tenant", () => {
    assert.throws(() => validateFilters({ role: "tenant" }), ValidationError);
  });

  it("restricts windowMinutes to the supported set", () => {
    for (const w of [5, 15, 30]) assert.doesNotThrow(() => validateFilters(global({ windowMinutes: w })));
    for (const w of [0, 1, 60, -15, 1e308, Number.NaN]) {
      assert.throws(() => validateFilters(global({ windowMinutes: w })), ValidationError, `windowMinutes=${w}`);
    }
  });

  it("rejects values outside each enum", () => {
    // Regression: these reached the SQL layer unchecked, where an unknown
    // vendor silently matched zero rows and returned 200 instead of a 400.
    const cases: Partial<QueryFilters>[] = [
      { eftVendor: "vendor-zzz" as QueryFilters["eftVendor"] },
      { messageType: "not_a_type" as QueryFilters["messageType"] },
      { txFamily: "not_a_family" as QueryFilters["txFamily"] },
      { outcomeCode: "not_an_outcome" as QueryFilters["outcomeCode"] },
    ];
    for (const c of cases) {
      assert.throws(() => validateFilters(global(c)), ValidationError, JSON.stringify(c));
    }
  });
});

describe("buildWhere — tenant scoping is the security boundary", () => {
  it("always scopes a tenant caller to its own tenant", () => {
    const { clause, params } = buildWhere(tenant());
    assert.match(clause, /tenant_id = \$1/);
    assert.deepEqual(params, ["tenant-07"]);
  });

  it("applies a global operator's optional tenant drill-down", () => {
    const scoped = buildWhere(global({ tenantId: "tenant-01" }));
    assert.match(scoped.clause, /tenant_id = \$1/);
    assert.deepEqual(scoped.params, ["tenant-01"]);
  });

  it("adds no tenant predicate for an unscoped global operator", () => {
    assert.doesNotMatch(buildWhere(global()).clause, /tenant_id/);
  });
});

describe("buildWhere — filters and parameterization", () => {
  it("parameterizes every filter value rather than interpolating it", () => {
    // The values are attacker-influenced; only the validated windowMinutes
    // is ever inlined into the SQL text.
    const { clause, params } = buildWhere(
      global({
        tenantId: "tenant-01",
        eftVendor: "vendor-a",
        messageType: "auth_request",
        txFamily: "purchase",
        outcomeCode: "approved",
        sourceSystem: "pos",
      }),
    );
    assert.deepEqual(params, ["tenant-01", "vendor-a", "auth_request", "purchase", "approved", "pos"]);
    for (let i = 1; i <= params.length; i++) {
      assert.ok(clause.includes(`$${i}`), `missing placeholder $${i}`);
    }
    for (const value of params) {
      assert.ok(!clause.includes(String(value)), `value ${value} was inlined into SQL`);
    }
  });

  it("keeps placeholder numbering contiguous when earlier filters are absent", () => {
    // The bug this guards: dropping a predicate but not renumbering leaves a
    // $2 with only one bound parameter.
    const { clause, params } = buildWhere(global({ outcomeCode: "approved" }));
    assert.deepEqual(params, ["approved"]);
    assert.match(clause, /outcome_code = \$1/);
    assert.ok(!clause.includes("$2"));
  });

  it("defaults to a 15-minute window", () => {
    assert.match(buildWhere(global()).clause, /interval '15 minutes'/);
  });

  it("builds the previous period as the equal-length window immediately before", () => {
    const { clause } = buildWhere(global({ windowMinutes: 30 }), { window: "previous" });
    assert.match(clause, /event_ts > now\(\) - interval '60 minutes'/);
    assert.match(clause, /event_ts <= now\(\) - interval '30 minutes'/);
  });

  it("validates before building, so a bad filter never reaches SQL", () => {
    assert.throws(() => buildWhere(global({ windowMinutes: 1e308 })), ValidationError);
    assert.throws(() => buildWhere({ role: "tenant" }), ValidationError);
  });
});
