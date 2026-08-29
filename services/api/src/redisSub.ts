import Redis from "ioredis";
import { REDIS_UPDATE_CHANNEL } from "@nymbus/shared";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

// One Redis subscriber connection per API instance, shared across every SSE
// client on that instance - this is the cross-instance fan-out mechanism:
// the consumer publishes once, and every horizontally-scaled API pod (each
// with its own subscriber like this one) re-queries and pushes to its own
// connected browsers.
const subscriber = new Redis(REDIS_URL);
// ioredis is an EventEmitter - an unhandled 'error' event (e.g. Redis
// becomes unreachable) throws and crashes the process. ioredis reconnects
// on its own by default; this just keeps a transient outage from taking
// the whole API instance down with it.
subscriber.on("error", (err) => {
  console.error("[api] redis subscriber error (ioredis will retry the connection):", err.message);
});
subscriber.subscribe(REDIS_UPDATE_CHANNEL);

const listeners = new Set<() => void>();

subscriber.on("message", (_channel, _message) => {
  for (const listener of listeners) listener();
});

export function onUpdate(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
