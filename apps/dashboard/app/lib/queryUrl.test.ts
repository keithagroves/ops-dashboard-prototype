import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { QueryFilters } from "@nymbus/shared";
import { buildUrl, getApiBase } from "./queryUrl";

describe("buildUrl", () => {
  it("serializes the token and supported filters", () => {
    const filters: QueryFilters = {
      role: "global",
      tenantId: "tenant-07",
      eftVendor: "vendor-b",
      messageType: "auth_request",
      txFamily: "purchase",
      outcomeCode: "approved",
      sourceSystem: "conn-01",
      windowMinutes: 30,
    };

    const url = new URL(buildUrl("/api/stream", filters, "signed-token"));

    assert.equal(url.pathname, "/api/stream");
    assert.equal(url.searchParams.get("token"), "signed-token");
    assert.equal(url.searchParams.get("tenantId"), "tenant-07");
    assert.equal(url.searchParams.get("eftVendor"), "vendor-b");
    assert.equal(url.searchParams.get("messageType"), "auth_request");
    assert.equal(url.searchParams.get("txFamily"), "purchase");
    assert.equal(url.searchParams.get("outcomeCode"), "approved");
    assert.equal(url.searchParams.get("sourceSystem"), "conn-01");
    assert.equal(url.searchParams.get("windowMinutes"), "30");
  });

  it("never sends the client-provided role", () => {
    const url = new URL(buildUrl("/api/query", { role: "global" }, "token"));

    assert.equal(url.searchParams.has("role"), false);
  });

  it("URL-encodes credentials and free-text filters", () => {
    const url = new URL(
      buildUrl("/api/query", { role: "global", sourceSystem: "core & cards/+" }, "a+b&c=d"),
    );

    assert.equal(url.searchParams.get("token"), "a+b&c=d");
    assert.equal(url.searchParams.get("sourceSystem"), "core & cards/+");
  });

  it("uses the default API origin during server-side rendering", () => {
    assert.equal(typeof window, "undefined");
    assert.match(getApiBase(), /^https?:\/\//);
  });
});
