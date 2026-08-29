"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { AuthClaims, LoginResponse } from "@nymbus/shared";
import { getApiBase } from "./queryUrl";

const STORAGE_KEY = "nymbus.token";

// localStorage is an external store, so it's read through
// useSyncExternalStore rather than copied into state from an effect: that
// keeps server and client render consistent and avoids a cascading render on
// every mount. Writers call emit() to notify subscribers in this tab; the
// "storage" event covers other tabs.
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

const getTokenSnapshot = () => localStorage.getItem(STORAGE_KEY);
const getServerTokenSnapshot = () => null;

// Reports false on the server and during hydration, true afterwards, so the
// caller can hold the first paint instead of flashing the login screen before
// localStorage has been read.
const subscribeToNothing = () => () => {};
const alwaysTrue = () => true;
const alwaysFalse = () => false;

/**
 * Reads the claims out of a JWT payload without verifying it. That is fine
 * here: the client only needs them to decide what to render. Every decision
 * that actually matters - which tenant's rows you can see - is made by the
 * API from the signed token, not from this.
 */
function decodeClaims(token: string): AuthClaims | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const parsed = JSON.parse(json) as Partial<AuthClaims> & { exp?: number };
    if (parsed.role !== "tenant" && parsed.role !== "global") return null;
    // Expiry is checked here only to skip a round-trip we know would 401.
    // The API checks it too, and that check is the one that counts.
    if (parsed.exp && parsed.exp * 1000 < Date.now()) return null;
    return { sub: String(parsed.sub ?? ""), role: parsed.role, tenantId: parsed.tenantId };
  } catch {
    return null;
  }
}

export function useAuth() {
  const stored = useSyncExternalStore(subscribe, getTokenSnapshot, getServerTokenSnapshot);
  const ready = useSyncExternalStore(subscribeToNothing, alwaysTrue, alwaysFalse);

  const claims = useMemo(() => (stored ? decodeClaims(stored) : null), [stored]);
  // A token that won't decode (malformed, or expired) is treated as no
  // session at all, so the login screen shows instead of a wall of 401s.
  const token = claims ? stored : null;

  const signIn = useCallback(async (username: string, password: string) => {
    const res = await fetch(`${getApiBase()}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error || "sign in failed");
    }
    const { token: newToken } = (await res.json()) as LoginResponse;
    localStorage.setItem(STORAGE_KEY, newToken);
    emit();
  }, []);

  const signOut = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    emit();
  }, []);

  return { token, claims, ready, signIn, signOut };
}
