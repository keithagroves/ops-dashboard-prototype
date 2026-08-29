import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Fastify from "fastify";
import type { QueryFilters, QueryResult } from "@nymbus/shared";
import { login } from "./auth";
import { registerLoginRoute } from "./routes/login";
import { registerQueryRoute } from "./routes/query";
import { registerStreamRoute } from "./routes/stream";

const EMPTY_RESULT: QueryResult = {
  trend: [],
  outcomes: [],
  latency: { p50: null, p95: null },
  rows: [],
  totalCount: 0,
  previous: { totalCount: 0, p50: null, p95: null, approvalRate: null },
  tenants: [],
  generatedAt: "2026-08-29T00:00:00.000Z",
};

describe("POST /api/login", () => {
  it("returns a token and verified scope for valid credentials", async () => {
    const app = Fastify();
    await registerLoginRoute(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/login",
      payload: { username: "tenant-07", password: "demo" },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().claims.role, "tenant");
    assert.equal(response.json().claims.tenantId, "tenant-07");
    assert.equal(typeof response.json().token, "string");
    await app.close();
  });

  it("distinguishes malformed input from invalid credentials", async () => {
    const app = Fastify();
    await registerLoginRoute(app);

    const malformed = await app.inject({ method: "POST", url: "/api/login", payload: {} });
    const unauthorized = await app.inject({
      method: "POST",
      url: "/api/login",
      payload: { username: "admin", password: "wrong" },
    });

    assert.equal(malformed.statusCode, 400);
    assert.equal(unauthorized.statusCode, 401);
    await app.close();
  });

  it("does not expose internal failures", async () => {
    const app = Fastify({ logger: false });
    await registerLoginRoute(app, { login: () => { throw new Error("secret detail"); } });

    const response = await app.inject({
      method: "POST",
      url: "/api/login",
      payload: { username: "admin", password: "demo" },
    });

    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json(), { error: "internal error" });
    await app.close();
  });
});

describe("GET /api/query", () => {
  it("authenticates, scopes, parses filters, and returns the query result", async () => {
    const app = Fastify();
    let received: QueryFilters | undefined;
    await registerQueryRoute(app, {
      runQuery: async (filters) => {
        received = filters;
        return EMPTY_RESULT;
      },
    });
    const token = login("tenant-07", "demo").token;

    const response = await app.inject({
      method: "GET",
      url: "/api/query?tenantId=tenant-01&eftVendor=vendor-b&windowMinutes=30",
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), EMPTY_RESULT);
    assert.equal(received?.role, "tenant");
    assert.equal(received?.tenantId, "tenant-07");
    assert.equal(received?.eftVendor, "vendor-b");
    assert.equal(received?.windowMinutes, 30);
    await app.close();
  });

  it("returns 401 before querying when the token is missing", async () => {
    const app = Fastify();
    let queried = false;
    await registerQueryRoute(app, { runQuery: async () => { queried = true; return EMPTY_RESULT; } });

    const response = await app.inject({ method: "GET", url: "/api/query" });

    assert.equal(response.statusCode, 401);
    assert.equal(queried, false);
    await app.close();
  });

  it("returns 400 for an invalid filter instead of querying Postgres", async () => {
    const app = Fastify();
    await registerQueryRoute(app);
    const token = login("admin", "demo").token;

    const response = await app.inject({
      method: "GET",
      url: "/api/query?eftVendor=not-a-vendor",
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(response.statusCode, 400);
    assert.match(response.json().error, /eftVendor/);
    await app.close();
  });

  it("returns a sanitized 500 response when the query fails", async () => {
    const app = Fastify({ logger: false });
    await registerQueryRoute(app, { runQuery: async () => { throw new Error("database password"); } });
    const token = login("admin", "demo").token;

    const response = await app.inject({
      method: "GET",
      url: "/api/query",
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json(), { error: "internal error" });
    await app.close();
  });
});

describe("GET /api/stream preflight", () => {
  it("rejects missing authentication before opening an SSE response", async () => {
    const app = Fastify();
    await registerStreamRoute(app);

    const response = await app.inject({ method: "GET", url: "/api/stream" });

    assert.equal(response.statusCode, 401);
    assert.match(response.headers["content-type"] ?? "", /application\/json/);
    await app.close();
  });

  it("rejects invalid filters before opening an SSE response", async () => {
    const app = Fastify();
    await registerStreamRoute(app);
    const token = login("admin", "demo").token;

    const response = await app.inject({
      method: "GET",
      url: `/api/stream?token=${encodeURIComponent(token)}&windowMinutes=999`,
    });

    assert.equal(response.statusCode, 400);
    assert.match(response.headers["content-type"] ?? "", /application\/json/);
    await app.close();
  });
});
