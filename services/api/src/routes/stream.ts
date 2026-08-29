import type { FastifyInstance } from "fastify";
import { runQuery, validateFilters } from "../db";
import { filtersFromQuery } from "../filters";
import { onUpdate } from "../redisSub";
import { ValidationError } from "../errors";

const MIN_PUSH_INTERVAL_MS = 500;

export async function registerStreamRoute(app: FastifyInstance) {
  app.get("/api/stream", async (request, reply) => {
    const filters = filtersFromQuery(request.query as Record<string, unknown>);

    // Validate before committing to an SSE response - an invalid request
    // gets a normal 400 instead of a 200 that immediately emits an error
    // frame and leaves the client to figure out the stream is dead on arrival.
    try {
      validateFilters(filters);
    } catch (err) {
      if (err instanceof ValidationError) {
        reply.code(400);
        return { error: err.message };
      }
      throw err;
    }

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });

    const send = async () => {
      try {
        const result = await runQuery(filters);
        reply.raw.write(`data: ${JSON.stringify(result)}\n\n`);
      } catch (err) {
        reply.raw.write(`event: error\ndata: ${JSON.stringify({ error: (err as Error).message })}\n\n`);
      }
    };

    await send();

    // A trigger while a send is already in flight sets `queued` rather than
    // starting a second, overlapping send - otherwise a burst of Redis
    // notifications during one slow query can fire concurrent queries for
    // the same connection instead of the intended one-at-a-time cadence.
    let running = false;
    let queued = false;
    let lastSent = Date.now();

    const trigger = () => {
      if (running) {
        queued = true;
        return;
      }
      const wait = Math.max(0, MIN_PUSH_INTERVAL_MS - (Date.now() - lastSent));
      running = true;
      setTimeout(async () => {
        do {
          queued = false;
          await send();
          lastSent = Date.now();
        } while (queued);
        running = false;
      }, wait);
    };

    const unsubscribe = onUpdate(trigger);

    const keepAlive = setInterval(() => {
      reply.raw.write(": keep-alive\n\n");
    }, 15_000);

    request.raw.on("close", () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });
}
