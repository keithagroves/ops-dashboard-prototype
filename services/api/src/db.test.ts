import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { QueryFilters } from "@nymbus/shared";
import { buildTrendSql, buildWhere, validateFilters } from "./db";
import { ValidationError } from "./errors";

const global = (extra: Partial<QueryFilters> = {}): QueryFilters => ({ role: "global", ...extra });
const tenant = (extra: Partial<QueryFilters> = {}): QueryFilters => ({
  role: "tenant",
  tenantId: "tenant-07",
  ...extra,
});

describe("buildTrendSql", () => {
  it("generates every bucket and zero-fills gaps", () => {
    const sql = buildTrendSql("event_ts > now() - interval '5 minutes'", 5, 5);

    assert.match(sql, /generate_series/);
    assert.match(sql, /interval '5 seconds'/);
    assert.match(sql, /coalesce\(matched\.count, 0\)/);
    assert.match(sql, /LEFT JOIN matched USING \(bucket\)/);
  });

  it("gates generated buckets on at least one matching row", () => {
    const sql = buildTrendSql("event_ts > now() - interval '30 minutes'", 30, 15);

    assert.match(sql, /matched_count/);
    assert.match(sql, /WHERE count > 0/);
    assert.match(sql, /interval '30 minutes'/);
    assert.match(sql, /interval '15 seconds'/);
  });
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
      { eftVendor: ["vendor-zzz"] as unknown as QueryFilters["eftVendor"] },
      { messageType: ["not_a_type"] as unknown as QueryFilters["messageType"] },
      { txFamily: ["not_a_family"] as unknown as QueryFilters["txFamily"] },
      { outcomeCode: ["not_an_outcome"] as unknown as QueryFilters["outcomeCode"] },
    ];
    for (const c of cases) {
      assert.throws(() => validateFilters(global(c)), ValidationError, JSON.stringify(c));
    }
  });

  it("rejects an empty set rather than reading it as no constraint", () => {
    // `?eftVendor=` is far more likely a client bug than a request to match
    // everything, and silently widening the result set is the worse failure.
    const keys = ["eftVendor", "messageType", "txFamily", "outcomeCode"] as const;
    for (const key of keys) {
      assert.throws(() => validateFilters(global({ [key]: [] })), ValidationError, key);
    }
  });

  it("accepts a multi-value set of valid members", () => {
    assert.doesNotThrow(() => validateFilters(global({ eftVendor: ["vendor-a", "vendor-c"] })));
  });

  it("rejects a set where any member is invalid", () => {
    assert.throws(
      () => validateFilters(global({ eftVendor: ["vendor-a", "vendor-zzz"] as unknown as QueryFilters["eftVendor"] })),
      ValidationError,
    );
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
        eftVendor: ["vendor-a"],
        messageType: ["auth_request"],
        txFamily: ["purchase"],
        outcomeCode: ["approved"],
        sourceSystem: "pos",
      }),
    );
    assert.deepEqual(params, [
      "tenant-01",
      ["vendor-a"],
      ["auth_request"],
      ["purchase"],
      ["approved"],
      "pos",
    ]);
    for (let i = 1; i <= params.length; i++) {
      assert.ok(clause.includes(`$${i}`), `missing placeholder $${i}`);
    }
    for (const value of params.flat()) {
      assert.ok(!clause.includes(String(value)), `value ${value} was inlined into SQL`);
    }
  });

  it("keeps placeholder numbering contiguous when earlier filters are absent", () => {
    // The bug this guards: dropping a predicate but not renumbering leaves a
    // $2 with only one bound parameter.
    const { clause, params } = buildWhere(global({ outcomeCode: ["approved"] }));
    assert.deepEqual(params, [["approved"]]);
    assert.match(clause, /outcome_code = ANY\(\$1::text\[\]\)/);
    assert.ok(!clause.includes("$2"));
  });

  it("binds a multi-value filter as one array parameter, not N placeholders", () => {
    // Using `= ANY($n)` instead of expanding `IN ($1,$2,...)` keeps the
    // numbering independent of how many values each filter carries — the
    // thing that makes hand-built IN lists error-prone.
    const { clause, params } = buildWhere(
      global({ eftVendor: ["vendor-a", "vendor-c"], messageType: ["auth_request"] }),
    );
    assert.deepEqual(params, [["vendor-a", "vendor-c"], ["auth_request"]]);
    assert.match(clause, /eft_vendor = ANY\(\$1::text\[\]\)/);
    assert.match(clause, /message_type = ANY\(\$2::text\[\]\)/);
    assert.ok(!clause.includes("$3"));
  });

  it("copies the values rather than binding the caller's array", () => {
    // Mutating a filter object after building must not alter the bound query.
    const vendors: QueryFilters["eftVendor"] = ["vendor-a"];
    const { params } = buildWhere(global({ eftVendor: vendors }));
    vendors!.push("vendor-b");
    assert.deepEqual(params, [["vendor-a"]]);
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
