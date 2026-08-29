"use client";

import { useState } from "react";

export function LoginScreen({
  onSignIn,
}: {
  onSignIn: (username: string, password: string) => Promise<void>;
}) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await onSignIn(username.trim(), password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <form
        onSubmit={submit}
        className="flex w-full max-w-sm flex-col gap-4 rounded-lg border border-neutral-800 bg-neutral-950 p-6"
      >
        <div>
          <h1 className="text-base font-semibold text-neutral-100">Nymbus Operations Console</h1>
          <p className="text-xs text-neutral-500">Sign in to view transaction activity.</p>
        </div>

        <label className="flex flex-col gap-1 text-xs text-neutral-400">
          Username
          <input
            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-neutral-400">
          Password
          <input
            type="password"
            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>

        {error && (
          <p role="alert" className="rounded border border-red-900 bg-red-950/50 px-2 py-1.5 text-xs text-red-300">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || !username || !password}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>

        <p className="border-t border-neutral-800 pt-3 text-[11px] leading-relaxed text-neutral-600">
          <span className="font-medium text-neutral-500">Prototype credentials.</span> Sign in as{" "}
          <code className="text-neutral-400">admin</code> for the platform operator view, or as any tenant
          (<code className="text-neutral-400">tenant-01</code> … <code className="text-neutral-400">tenant-50</code>)
          for that institution&apos;s own view. Password is{" "}
          <code className="text-neutral-400">demo</code> for every account.
        </p>
      </form>
    </div>
  );
}
