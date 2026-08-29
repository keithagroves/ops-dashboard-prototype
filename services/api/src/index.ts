import Fastify from "fastify";
import cors from "@fastify/cors";
import Redis from "ioredis";
import { registerQueryRoute } from "./routes/query";
import { registerStreamRoute } from "./routes/stream";
import { pool } from "./db";

const PORT = Number(process.env.PORT || 4000);
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

async function main() {
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });

  await registerQueryRoute(app);
  await registerStreamRoute(app);

  // Liveness: "is the process up." Always 200 if we can respond at all -
  // this is what a process supervisor/orchestrator should restart on.
  app.get("/health", async () => ({ ok: true }));

  // Readiness: "can this instance actually serve a request right now."
  // Checks the dependencies the query path needs, with a short timeout so
  // a hung dependency doesn't hang this check too. This is what previously
  // didn't exist - an API instance with an unreachable database still
  // reported healthy, which is exactly the outage /health is supposed to
  // catch and didn't.
  app.get("/ready", async (_request, reply) => {
    const timeout = (ms: number) => new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));

    const checkRedis = async () => {
      const client = new Redis(REDIS_URL, { lazyConnect: true, retryStrategy: () => null, maxRetriesPerRequest: 0 });
      client.on("error", () => {
        // Swallowed deliberately: connect()/ping() below already surface
        // the failure via their rejected promise. Without this listener
        // the same error also fires as an unhandled EventEmitter 'error'
        // and crashes the process - the exact bug this endpoint exists to
        // detect, not cause.
      });
      try {
        await client.connect();
        await client.ping();
      } finally {
        client.disconnect();
      }
    };

    const [pgResult, redisResult] = await Promise.allSettled([
      Promise.race([pool.query("SELECT 1"), timeout(1500)]),
      Promise.race([checkRedis(), timeout(1500)]),
    ]);

    const postgres = pgResult.status === "fulfilled";
    const redis = redisResult.status === "fulfilled";

    if (postgres && redis) {
      return { ready: true, postgres, redis };
    }
    reply.code(503);
    return { ready: false, postgres, redis };
  });

  await app.listen({ port: PORT, host: "0.0.0.0" });
  console.log(`[api] listening on :${PORT}`);
}

main().catch((err) => {
  console.error("[api] fatal", err);
  process.exit(1);
});
