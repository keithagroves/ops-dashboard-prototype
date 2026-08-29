import type { FastifyInstance } from "fastify";
import { runQuery, validateFilters } from "../db";
import { filtersFromQuery } from "../filters";
import { onUpdate } from "../redisSub";
import { authenticate, AuthError } from "../auth";
import { ValidationError } from "../errors";
import { createTrailingThrottle } from "../sseThrottle";

const MIN_PUSH_INTERVAL_MS = 500;

interface StreamRouteDependencies {
  authenticate: typeof authenticate;
  filtersFromQuery: typeof filtersFromQuery;
  validateFilters: typeof validateFilters;
  runQuery: typeof runQuery;
  onUpdate: typeof onUpdate;
}

export async function registerStreamRoute(
  app: FastifyInstance,
  overrides: Partial<StreamRouteDependencies> = {},
) {
  const dependencies: StreamRouteDependencies = {
    authenticate,
    filtersFromQuery,
    validateFilters,
    runQuery,
    onUpdate,
    ...overrides,
  };

  app.get("/api/stream", async (request, reply) => {
    const query = request.query as Record<string, unknown>;

    // Authenticate and validate before committing to an SSE response - a bad
    // request gets a normal 401/400 instead of a 200 that immediately emits
    // an error frame and leaves the client to figure out the stream is dead
    // on arrival.
    let filters;
    try {
      const claims = dependencies.authenticate(request.headers as Record<string, unknown>, query);
      filters = dependencies.filtersFromQuery(query, claims);
      dependencies.validateFilters(filters);
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
        const result = await dependencies.runQuery(filters);
        reply.raw.write(`data: ${JSON.stringify(result)}\n\n`);
      } catch (err) {
        reply.raw.write(`event: error\ndata: ${JSON.stringify({ error: (err as Error).message })}\n\n`);
      }
    };

    await send();

    const throttle = createTrailingThrottle(send, MIN_PUSH_INTERVAL_MS);
    const unsubscribe = dependencies.onUpdate(throttle.trigger);

    const keepAlive = setInterval(() => {
      reply.raw.write(": keep-alive\n\n");
    }, 15_000);

    request.raw.on("close", () => {
      clearInterval(keepAlive);
      unsubscribe();
      // Cancel a notification that was scheduled before the socket closed;
      // otherwise it can still query and write to a dead response later.
      throttle.stop();
    });
  });
}
