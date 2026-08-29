import Redis from "ioredis";
import { REDIS_UPDATE_CHANNEL } from "@nymbus/shared";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

// One Redis subscriber connection per API instance, shared across every SSE
// client on that instance - this is the cross-instance fan-out mechanism:
// the consumer publishes once, and every horizontally-scaled API pod (each
// with its own subscriber like this one) re-queries and pushes to its own
// connected browsers.
const subscriber = new Redis(REDIS_URL);
subscriber.subscribe(REDIS_UPDATE_CHANNEL);

const listeners = new Set<() => void>();

subscriber.on("message", (_channel, _message) => {
  for (const listener of listeners) listener();
});

export function onUpdate(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
