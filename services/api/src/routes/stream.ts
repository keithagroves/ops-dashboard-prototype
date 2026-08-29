import type { FastifyInstance } from "fastify";
import { runQuery, validateFilters } from "../db";
import { filtersFromQuery } from "../filters";
import { onUpdate } from "../redisSub";
import { authenticate, AuthError } from "../auth";
import { ValidationError } from "../errors";

const MIN_PUSH_INTERVAL_MS = 500;

export async function registerStreamRoute(app: FastifyInstance) {
  app.get("/api/stream", async (request, reply) => {
    const query = request.query as Record<string, unknown>;

    // Authenticate and validate before committing to an SSE response - a bad
    // request gets a normal 401/400 instead of a 200 that immediately emits
    // an error frame and leaves the client to figure out the stream is dead
    // on arrival.
    let filters;
    try {
      const claims = authenticate(request.headers as Record<string, unknown>, query);
      filters = filtersFromQuery(query, claims);
      validateFilters(filters);
    } catch (err) {
      if (err instanceof AuthError) {
        reply.code(401);
        return { error: err.message };
      }
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

    // A trailing update (queued while the current one was in flight) goes
    // back through trigger() itself rather than looping immediately - that
    // recomputes `wait` against the *new* lastSent, which is what actually
    // enforces the 500ms floor. A same-function do/while here would fire
    // the trailing send with 0ms delay, since it never recalculates wait -
    // measured live as 512ms/0ms/508ms/0ms under rapid notifications.
    const trigger = () => {
      if (running) {
        queued = true;
        return;
      }
      const wait = Math.max(0, MIN_PUSH_INTERVAL_MS - (Date.now() - lastSent));
      running = true;
      setTimeout(async () => {
        await send();
        lastSent = Date.now();
        running = false;
        if (queued) {
          queued = false;
          trigger();
        }
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
