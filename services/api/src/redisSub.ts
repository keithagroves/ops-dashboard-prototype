import Redis from "ioredis";
import { REDIS_UPDATE_CHANNEL } from "@nymbus/shared";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const SUBSCRIBER_RETRY_DELAY_MS = 1_000;

// One Redis subscriber connection per API instance, shared across every SSE
// client on that instance - this is the cross-instance fan-out mechanism:
// the consumer publishes once, and every horizontally-scaled API pod (each
// with its own subscriber like this one) re-queries and pushes to its own
// connected browsers.
const listeners = new Set<() => void>();
let subscriber: Redis | null = null;
let subscriberRetry: ReturnType<typeof setTimeout> | null = null;

/**
 * Observe the initial SUBSCRIBE command instead of discarding its promise.
 * EventEmitter `error` listeners do not consume promise rejections; without
 * this boundary, ioredis exhausting its request retries becomes an unhandled
 * rejection that can terminate the API process.
 */
export async function settleSubscription(
  subscribe: () => Promise<unknown>,
  onFailure: (error: unknown) => void,
  report: (message: string) => void = console.error,
): Promise<void> {
  try {
    await subscribe();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    report(`[api] redis subscribe failed; will retry: ${message}`);
    onFailure(error);
  }
}

function retrySubscriberAfterFailure(client: Redis): void {
  if (subscriber !== client) return;
  subscriber = null;
  client.disconnect();

  if (listeners.size === 0 || subscriberRetry) return;
  subscriberRetry = setTimeout(() => {
    subscriberRetry = null;
    if (listeners.size > 0 && !subscriber) ensureSubscriber();
  }, SUBSCRIBER_RETRY_DELAY_MS);
}

function ensureSubscriber(): Redis {
  if (subscriber) return subscriber;

  // Connect lazily when the first SSE client subscribes. Importing the route
  // module (for tests, health checks, or tooling) should not create a Redis
  // connection as a side effect.
  // A subscriber is a long-lived command. Keeping request retries unlimited
  // lets ioredis reconnect through an outage instead of rejecting SUBSCRIBE
  // after the normal command retry budget. The explicit rejection handler
  // below still covers terminal failures such as invalid configuration.
  const client = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
  subscriber = client;
  // ioredis is an EventEmitter - an unhandled 'error' event (e.g. Redis
  // becomes unreachable) throws and crashes the process. ioredis reconnects
  // on its own by default; this just keeps a transient outage from taking
  // the whole API instance down with it.
  client.on("error", (err) => {
    console.error("[api] redis subscriber error (ioredis will retry the connection):", err.message);
  });
  client.on("message", (_channel, _message) => {
    for (const listener of listeners) listener();
  });
  void settleSubscription(
    () => client.subscribe(REDIS_UPDATE_CHANNEL),
    () => retrySubscriberAfterFailure(client),
  );
  return client;
}

export function onUpdate(listener: () => void): () => void {
  listeners.add(listener);
  ensureSubscriber();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && subscriberRetry) {
      clearTimeout(subscriberRetry);
      subscriberRetry = null;
    }
  };
}
