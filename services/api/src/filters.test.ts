import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthClaims } from "@nymbus/shared";
import { filtersFromQuery } from "./filters";

const GLOBAL: AuthClaims = { sub: "admin", role: "global" };
const TENANT: AuthClaims = { sub: "tenant-07", role: "tenant", tenantId: "tenant-07" };

describe("filtersFromQuery — scope comes from the token, not the query", () => {
  it("takes role from the claims and ignores a role query param entirely", () => {
    // The privilege-escalation attempt this whole design exists to stop.
    assert.equal(filtersFromQuery({ role: "global" }, TENANT).role, "tenant");
    assert.equal(filtersFromQuery({ role: "tenant" }, GLOBAL).role, "global");
  });

  it("pins a tenant caller to its own tenant even when it asks for another", () => {
    const filters = filtersFromQuery({ tenantId: "tenant-01" }, TENANT);
    assert.equal(filters.tenantId, "tenant-07");
  });

  it("lets a global operator narrow to one tenant", () => {
    // The only case where the request influences tenantId at all.
    assert.equal(filtersFromQuery({ tenantId: "tenant-01" }, GLOBAL).tenantId, "tenant-01");
    assert.equal(filtersFromQuery({}, GLOBAL).tenantId, undefined);
  });
});

describe("filtersFromQuery — parsing", () => {
  it("passes through the non-scope filters", () => {
    const filters = filtersFromQuery(
      {
        eftVendor: "vendor-a",
        messageType: "auth_request",
        txFamily: "purchase",
        outcomeCode: "approved",
        sourceSystem: "pos",
        windowMinutes: "30",
      },
      GLOBAL,
    );
    assert.deepEqual(filters.eftVendor, ["vendor-a"]);
    assert.deepEqual(filters.messageType, ["auth_request"]);
    assert.deepEqual(filters.txFamily, ["purchase"]);
    assert.deepEqual(filters.outcomeCode, ["approved"]);
    assert.equal(filters.sourceSystem, "pos");
    assert.equal(filters.windowMinutes, 30);
  });

  it("reads a repeated key as a set", () => {
    // The form the dashboard sends: ?eftVendor=vendor-a&eftVendor=vendor-c
    const filters = filtersFromQuery({ eftVendor: ["vendor-a", "vendor-c"] }, GLOBAL);
    assert.deepEqual(filters.eftVendor, ["vendor-a", "vendor-c"]);
  });

  it("also accepts a comma-separated set for hand-typed URLs", () => {
    const filters = filtersFromQuery({ messageType: "auth_request,reversal" }, GLOBAL);
    assert.deepEqual(filters.messageType, ["auth_request", "reversal"]);
  });

  it("trims members and drops empty ones", () => {
    assert.deepEqual(filtersFromQuery({ eftVendor: " vendor-a , vendor-c ,, " }, GLOBAL).eftVendor, [
      "vendor-a",
      "vendor-c",
    ]);
  });

  it("treats empty strings as absent", () => {
    const filters = filtersFromQuery({ tenantId: "", sourceSystem: "" }, GLOBAL);
    assert.equal(filters.tenantId, undefined);
    assert.equal(filters.sourceSystem, undefined);
  });

  it("yields an empty set for a present-but-unusable key, so validation rejects it", () => {
    // Not undefined: `?eftVendor=` is a client bug, and reading it as "no
    // constraint" would silently widen the result set instead of 400ing.
    assert.deepEqual(filtersFromQuery({ eftVendor: "" }, GLOBAL).eftVendor, []);
    assert.deepEqual(filtersFromQuery({ eftVendor: [] }, GLOBAL).eftVendor, []);
  });

  it("leaves an unsupplied set undefined, meaning no constraint", () => {
    assert.equal(filtersFromQuery({}, GLOBAL).eftVendor, undefined);
  });

  it("leaves windowMinutes undefined when not supplied, so the default applies", () => {
    assert.equal(filtersFromQuery({}, GLOBAL).windowMinutes, undefined);
  });

  it("preserves a malformed windowMinutes as NaN so validation can reject it", () => {
    // Regression: coercing this to undefined silently applied the 15-minute
    // default instead of returning a 400 for a nonsense request.
    assert.ok(Number.isNaN(filtersFromQuery({ windowMinutes: "garbage" }, GLOBAL).windowMinutes));
    assert.ok(Number.isNaN(filtersFromQuery({ windowMinutes: [] }, GLOBAL).windowMinutes));
    assert.ok(Number.isNaN(filtersFromQuery({ windowMinutes: "" }, GLOBAL).windowMinutes));
  });

  it("drops non-string members rather than coercing them", () => {
    // The survivors are still enum-checked by validateFilters; what matters
    // here is that a number never becomes the string "42".
    assert.deepEqual(filtersFromQuery({ messageType: 42 }, GLOBAL).messageType, []);
    assert.deepEqual(filtersFromQuery({ eftVendor: ["vendor-a", 42] }, GLOBAL).eftVendor, ["vendor-a"]);
  });
});
