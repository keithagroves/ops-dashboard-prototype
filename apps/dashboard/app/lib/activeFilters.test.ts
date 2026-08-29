import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { QueryFilters } from "@nymbus/shared";
import { activeFilters, clearAllFilters, hasActiveFilters } from "./activeFilters";

const global = (extra: Partial<QueryFilters> = {}): QueryFilters => ({
  role: "global",
  windowMinutes: 15,
  ...extra,
});
const tenant = (extra: Partial<QueryFilters> = {}): QueryFilters => ({
  role: "tenant",
  tenantId: "tenant-07",
  windowMinutes: 15,
  ...extra,
});

describe("activeFilters", () => {
  it("is empty when nothing is narrowing the view", () => {
    assert.deepEqual(activeFilters(global()), []);
    assert.equal(hasActiveFilters(global()), false);
  });

  it("never treats the time window as a filter", () => {
    // windowMinutes is always set, so a chip for it could never be dismissed
    // and would be permanent noise beside the real narrowings.
    assert.deepEqual(activeFilters(global({ windowMinutes: 30 })), []);
  });

  it("reports a global operator's tenant drill-down", () => {
    assert.deepEqual(activeFilters(global({ tenantId: "tenant-01" })), [
      { key: "tenantId", label: "Tenant", value: "tenant-01" },
    ]);
  });

  it("does not report a tenant session's own tenant", () => {
    // That is the caller's identity, not a filter they chose - offering an ✕
    // would imply they could clear it, and the API would ignore them if they did.
    assert.deepEqual(activeFilters(tenant()), []);
    assert.equal(hasActiveFilters(tenant()), false);
  });

  it("still reports a tenant session's other filters", () => {
    const active = activeFilters(tenant({ eftVendor: "vendor-a" }));
    assert.deepEqual(active, [{ key: "eftVendor", label: "Vendor", value: "vendor-a" }]);
  });

  it("lists every applied filter in a stable order", () => {
    const active = activeFilters(
      global({
        outcomeCode: "approved",
        eftVendor: "vendor-a",
        tenantId: "tenant-01",
        messageType: "auth_request",
      }),
    );
    assert.deepEqual(
      active.map((f) => f.key),
      ["tenantId", "eftVendor", "messageType", "outcomeCode"],
    );
  });
});

describe("clearAllFilters", () => {
  it("clears the narrowings but keeps role and window", () => {
    const cleared = clearAllFilters(global({ eftVendor: "vendor-a", outcomeCode: "approved", windowMinutes: 30 }));
    assert.deepEqual(cleared, { role: "global", tenantId: undefined, windowMinutes: 30 });
  });

  it("keeps a tenant session pinned to its own tenant", () => {
    // Clearing this client-side would not widen anything - the API re-derives
    // it from the token - but it would blank the UI's own scope label.
    const cleared = clearAllFilters(tenant({ eftVendor: "vendor-a" }));
    assert.equal(cleared.role, "tenant");
    assert.equal(cleared.tenantId, "tenant-07");
  });

  it("drops a global operator's drill-down", () => {
    assert.equal(clearAllFilters(global({ tenantId: "tenant-01" })).tenantId, undefined);
  });
});
