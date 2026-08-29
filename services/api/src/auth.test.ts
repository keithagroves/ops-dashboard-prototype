import assert from "node:assert/strict";
import { describe, it } from "node:test";
import jwt from "jsonwebtoken";
import { AuthError, authenticate, login } from "./auth";
import { ValidationError } from "./errors";

// Matches the module's own fallbacks; these tests run without env overrides.
const SECRET = "dev-only-not-a-real-secret";
const PASSWORD = "demo";

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe("login", () => {
  it("issues a global-role token for admin", () => {
    const { token, claims } = login("admin", PASSWORD);
    assert.deepEqual(claims, { sub: "admin", role: "global" });
    assert.equal(typeof token, "string");
  });

  it("issues a tenant token scoped to that tenant", () => {
    const { claims } = login("tenant-07", PASSWORD);
    assert.deepEqual(claims, { sub: "tenant-07", role: "tenant", tenantId: "tenant-07" });
  });

  it("does not leak whether the user exists", () => {
    // Both must produce the *same* message, or the endpoint becomes a user
    // enumeration oracle.
    const messageFrom = (attempt: () => unknown): string => {
      try {
        attempt();
        assert.fail("expected login to throw");
      } catch (err) {
        assert.ok(err instanceof AuthError);
        return err.message;
      }
    };
    assert.equal(messageFrom(() => login("admin", "nope")), messageFrom(() => login("nobody", PASSWORD)));
  });

  it("rejects a tenant outside the configured range", () => {
    assert.throws(() => login("tenant-51", PASSWORD), AuthError);
    assert.throws(() => login("tenant-00", PASSWORD), AuthError);
  });

  it("rejects non-string credentials as a validation error, not an auth error", () => {
    // A 400 rather than a 401: the request is malformed, not unauthorized.
    assert.throws(() => login(undefined, PASSWORD), ValidationError);
    assert.throws(() => login("admin", { toString: () => PASSWORD }), ValidationError);
  });
});

describe("authenticate", () => {
  it("accepts a token from the Authorization header", () => {
    const { token } = login("admin", PASSWORD);
    assert.deepEqual(authenticate(bearer(token), {}), { sub: "admin", role: "global", tenantId: undefined });
  });

  it("accepts a token from the query string (the SSE path)", () => {
    // EventSource cannot set headers, so ?token= has to work.
    const { token } = login("tenant-07", PASSWORD);
    const claims = authenticate({}, { token });
    assert.equal(claims.role, "tenant");
    assert.equal(claims.tenantId, "tenant-07");
  });

  it("prefers the header when both are present", () => {
    const admin = login("admin", PASSWORD).token;
    const tenant = login("tenant-07", PASSWORD).token;
    assert.equal(authenticate(bearer(admin), { token: tenant }).role, "global");
  });

  it("rejects a missing token", () => {
    assert.throws(() => authenticate({}, {}), AuthError);
    assert.throws(() => authenticate({}, { token: "" }), AuthError);
  });

  it("rejects a malformed Authorization header", () => {
    const { token } = login("admin", PASSWORD);
    // No "Bearer " prefix - must not be accepted as a bare token.
    assert.throws(() => authenticate({ authorization: token }, {}), AuthError);
    assert.throws(() => authenticate({ authorization: `Basic ${token}` }, {}), AuthError);
  });

  it("rejects a tampered signature", () => {
    const { token } = login("admin", PASSWORD);
    const tampered = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
    assert.throws(() => authenticate(bearer(tampered), {}), AuthError);
  });

  it("rejects a token signed with a different secret", () => {
    // The forgery that matters: correct shape, wrong signer.
    const forged = jwt.sign({ sub: "admin", role: "global" }, "attacker-secret");
    assert.throws(() => authenticate(bearer(forged), {}), AuthError);
  });

  it("rejects an unsigned (alg=none) token", () => {
    const unsigned = `${Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url")}.${Buffer.from(
      JSON.stringify({ sub: "admin", role: "global" }),
    ).toString("base64url")}.`;
    assert.throws(() => authenticate(bearer(unsigned), {}), AuthError);
  });

  it("rejects an expired token", () => {
    const expired = jwt.sign({ sub: "admin", role: "global" }, SECRET, { expiresIn: "-1s" });
    assert.throws(() => authenticate(bearer(expired), {}), AuthError);
  });

  it("rejects a validly-signed token with no usable role", () => {
    const noRole = jwt.sign({ sub: "admin" }, SECRET);
    const badRole = jwt.sign({ sub: "admin", role: "superuser" }, SECRET);
    assert.throws(() => authenticate(bearer(noRole), {}), AuthError);
    assert.throws(() => authenticate(bearer(badRole), {}), AuthError);
  });

  it("rejects a tenant token with no tenantId rather than falling through unscoped", () => {
    // This is the dangerous case: role=tenant with no tenant would otherwise
    // reach buildWhere and produce a query scoped to nobody.
    const scopeless = jwt.sign({ sub: "tenant-07", role: "tenant" }, SECRET);
    assert.throws(() => authenticate(bearer(scopeless), {}), AuthError);
  });
});
