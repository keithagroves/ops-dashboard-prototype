import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { QueryFilters } from "@nymbus/shared";
import { isSameScope, scopeKeyOf } from "./sseScope";

const global = (extra: Partial<QueryFilters> = {}): QueryFilters => ({
  role: "global",
  windowMinutes: 15,
  ...extra,
});

const sameScope = (a: QueryFilters, b: QueryFilters, tokenA = "t", tokenB = tokenA) =>
  isSameScope(scopeKeyOf(a, tokenA), scopeKeyOf(b, tokenB));

describe("scopeKeyOf — what may stay on screen while a new stream connects", () => {
  it("treats a filter change as the same scope", () => {
    // These are the same tenant's numbers, just a different slice - safe to
    // keep showing dimmed rather than collapsing the layout to a skeleton.
    assert.ok(sameScope(global(), global({ eftVendor: ["vendor-a"] })));
    assert.ok(sameScope(global(), global({ windowMinutes: 30 })));
    assert.ok(sameScope(global(), global({ outcomeCode: ["approved"] })));
    assert.ok(sameScope(global(), global({ messageType: ["auth_request"], txFamily: ["purchase"] })));
  });

  it("treats a tenant drill-down as the same scope", () => {
    // A global operator is authorized for every tenant, so drilling in is a
    // filter, not a change of viewer. Blanking the dashboard here flickered on
    // every tenant click for no benefit - the chip row already names the
    // tenant the moment it is clicked.
    assert.ok(sameScope(global(), global({ tenantId: "tenant-01" })));
    assert.ok(sameScope(global({ tenantId: "tenant-01" }), global({ tenantId: "tenant-02" })));
    assert.ok(sameScope(global({ tenantId: "tenant-01" }), global()));
  });

  it("treats a different token as a scope change", () => {
    // The decisive case: one account's data must never linger into another's
    // session, however briefly.
    assert.ok(!sameScope(global(), global(), "token-a", "token-b"));
  });

  it("treats a role change as a scope change", () => {
    const tenant: QueryFilters = { role: "tenant", tenantId: "tenant-01", windowMinutes: 15 };
    assert.ok(!sameScope(global({ tenantId: "tenant-01" }), tenant));
  });

  it("is stable for identical inputs", () => {
    assert.equal(scopeKeyOf(global({ eftVendor: ["vendor-a"] }), "t"), scopeKeyOf(global(), "t"));
  });
});
