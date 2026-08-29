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
    assert.equal(filters.eftVendor, "vendor-a");
    assert.equal(filters.messageType, "auth_request");
    assert.equal(filters.txFamily, "purchase");
    assert.equal(filters.outcomeCode, "approved");
    assert.equal(filters.sourceSystem, "pos");
    assert.equal(filters.windowMinutes, 30);
  });

  it("treats empty strings as absent", () => {
    const filters = filtersFromQuery({ eftVendor: "", tenantId: "", sourceSystem: "" }, GLOBAL);
    assert.equal(filters.eftVendor, undefined);
    assert.equal(filters.tenantId, undefined);
    assert.equal(filters.sourceSystem, undefined);
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

  it("ignores non-string filter values rather than coercing them", () => {
    const filters = filtersFromQuery({ eftVendor: ["vendor-a"], messageType: 42 }, GLOBAL);
    assert.equal(filters.eftVendor, undefined);
    assert.equal(filters.messageType, undefined);
  });
});
