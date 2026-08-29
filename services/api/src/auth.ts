import jwt from "jsonwebtoken";
import { tenantIds, type AuthClaims } from "@nymbus/shared";
import { ValidationError } from "./errors";

// Prototype-only. A real deployment reads this from the platform's secret
// store and, more likely, verifies tokens issued by the existing IdP rather
// than signing its own.
const JWT_SECRET = process.env.JWT_SECRET || "dev-only-not-a-real-secret";
const TOKEN_TTL = "8h";

export class AuthError extends Error {}

/**
 * Hardcoded demo directory standing in for the platform's real user store.
 * Everyone shares one password because the point of this prototype is what
 * the *token* authorizes, not credential handling.
 */
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || "demo";

function lookupUser(username: string): AuthClaims | null {
  if (username === "admin") {
    return { sub: "admin", role: "global" };
  }
  if ((tenantIds(50) as string[]).includes(username)) {
    return { sub: username, role: "tenant", tenantId: username };
  }
  return null;
}

export function login(username: unknown, password: unknown): { token: string; claims: AuthClaims } {
  if (typeof username !== "string" || typeof password !== "string") {
    throw new ValidationError("username and password are required");
  }
  const claims = lookupUser(username);
  // Same error either way - a login endpoint that distinguishes "no such
  // user" from "wrong password" hands out a user enumeration oracle.
  if (!claims || password !== DEMO_PASSWORD) {
    throw new AuthError("invalid credentials");
  }
  const token = jwt.sign(claims, JWT_SECRET, { expiresIn: TOKEN_TTL });
  return { token, claims };
}

/**
 * EventSource cannot set request headers, so the SSE stream passes its token
 * as a query parameter. That is a prototype simplification: a real deployment
 * would use an httpOnly cookie (or a fetch-based stream) so the credential
 * never lands in a URL, where it can leak into logs and referrers.
 */
function extractToken(headers: Record<string, unknown>, query: Record<string, unknown>): string | null {
  const header = headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    return header.slice("Bearer ".length);
  }
  if (typeof query.token === "string" && query.token.length > 0) {
    return query.token;
  }
  return null;
}

/**
 * Verifies the caller's token and returns its claims. Throws AuthError for
 * anything missing, malformed, expired or badly signed - callers turn that
 * into a 401. This is the only place a request's role and tenant come from:
 * nothing in the query string can influence them.
 */
export function authenticate(headers: Record<string, unknown>, query: Record<string, unknown>): AuthClaims {
  const token = extractToken(headers, query);
  if (!token) throw new AuthError("missing token");

  let decoded: unknown;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    throw new AuthError("invalid or expired token");
  }

  const claims = decoded as Partial<AuthClaims>;
  if (claims?.role !== "tenant" && claims?.role !== "global") {
    throw new AuthError("token is missing a usable role claim");
  }
  // A tenant token without a tenant is not safely scopeable - reject it
  // rather than letting it fall through to an unscoped query.
  if (claims.role === "tenant" && !claims.tenantId) {
    throw new AuthError("tenant token is missing tenantId");
  }

  return { sub: String(claims.sub ?? ""), role: claims.role, tenantId: claims.tenantId };
}
