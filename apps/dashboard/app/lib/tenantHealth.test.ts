import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TenantHealthPoint } from "@nymbus/shared";
import { countNeedingAttention, health, sameTenantHealth, sortByHealth } from "./tenantHealth";

const t = (over: Partial<TenantHealthPoint> = {}): TenantHealthPoint => ({
  tenantId: "tenant-01",
  count: 100,
  approvalRate: 0.9,
  p95: 200,
  ...over,
});

describe("health", () => {
  it("calls a tenant at the platform's normal ~88% baseline healthy", () => {
    // The thresholds only earn their keep if routine traffic reads as "ok" -
    // a list where everything is amber teaches operators to ignore it.
    assert.equal(health(t({ approvalRate: 0.88 })), "ok");
    assert.equal(health(t({ approvalRate: 0.8 })), "ok");
  });

  it("warns on a genuine approval dip and fails on an incident-sized drop", () => {
    assert.equal(health(t({ approvalRate: 0.77 })), "warn");
    assert.equal(health(t({ approvalRate: 0.59 })), "bad");
  });

  it("fails on an SLA breach regardless of approval rate", () => {
    assert.equal(health(t({ p95: 501, approvalRate: 1 })), "bad");
    // Exactly at the SLA is not a breach, but it is still inside the
    // approaching-SLA warning band defined below.
    assert.equal(health(t({ p95: 500, approvalRate: 1 })), "warn");
  });

  it("warns as latency approaches the SLA", () => {
    assert.equal(health(t({ p95: 451 })), "warn");
    assert.equal(health(t({ p95: 450 })), "ok");
  });

  it("takes the worse of the two signals", () => {
    assert.equal(health(t({ approvalRate: 0.77, p95: 600 })), "bad");
  });

  it("treats absent metrics as not-unhealthy rather than guessing", () => {
    // A tenant with no traffic in the window has null stats; flagging it red
    // would cry wolf about a tenant that is simply quiet.
    assert.equal(health(t({ approvalRate: null, p95: null })), "ok");
    assert.equal(health(t({ approvalRate: null, p95: 600 })), "bad");
  });
});

describe("sortByHealth", () => {
  it("orders worst first, then stably by tenant ID within a band", () => {
    const tenants = [
      t({ tenantId: "ok-a-quiet", count: 10 }),
      t({ tenantId: "bad", approvalRate: 0.4 }),
      t({ tenantId: "ok-b-busy", count: 900 }),
      t({ tenantId: "warn", approvalRate: 0.7 }),
    ];
    assert.deepEqual(
      sortByHealth(tenants).map((x) => x.tenantId),
      ["bad", "warn", "ok-a-quiet", "ok-b-busy"],
    );
  });

  it("does not mutate its input", () => {
    const tenants = [t({ tenantId: "a" }), t({ tenantId: "b", approvalRate: 0.1 })];
    sortByHealth(tenants);
    assert.deepEqual(
      tenants.map((x) => x.tenantId),
      ["a", "b"],
    );
  });

  it("handles an empty list", () => {
    assert.deepEqual(sortByHealth([]), []);
  });
});

describe("countNeedingAttention", () => {
  it("counts warn and bad, not ok", () => {
    const tenants = [t(), t({ approvalRate: 0.7 }), t({ p95: 900 }), t()];
    assert.equal(countNeedingAttention(tenants), 2);
  });

  it("is zero for an all-healthy platform", () => {
    assert.equal(countNeedingAttention([t(), t()]), 0);
  });
});

describe("sameTenantHealth", () => {
  it("treats separately parsed but equal tenant payloads as unchanged", () => {
    assert.equal(sameTenantHealth([t()], [{ ...t() }]), true);
  });

  it("ignores raw changes that do not affect rendered output", () => {
    assert.equal(sameTenantHealth([t()], [t({ count: 101 })]), true);
    assert.equal(sameTenantHealth([t({ approvalRate: 0.901 })], [t({ approvalRate: 0.902 })]), true);
    assert.equal(sameTenantHealth([t({ p95: 200.1 })], [t({ p95: 200.4 })]), true);
  });

  it("detects displayed or health-band changes", () => {
    assert.equal(sameTenantHealth([t()], [t({ approvalRate: 0.8 })]), false);
    assert.equal(sameTenantHealth([t()], [t({ p95: 300 })]), false);
    assert.equal(sameTenantHealth([t({ approvalRate: 0.78 })], [t({ approvalRate: 0.779 })]), false);
    assert.equal(sameTenantHealth([t()], [t({ tenantId: "tenant-02" })]), false);
  });
});
