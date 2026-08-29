import type { FastifyInstance } from "fastify";
import { runQuery } from "../db";
import { filtersFromQuery } from "../filters";
import { onUpdate } from "../redisSub";

const MIN_PUSH_INTERVAL_MS = 500;

export async function registerStreamRoute(app: FastifyInstance) {
  app.get("/api/stream", async (request, reply) => {
    const filters = filtersFromQuery(request.query as Record<string, unknown>);

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

    let pending = false;
    let lastSent = Date.now();
    const unsubscribe = onUpdate(() => {
      if (pending) return;
      const wait = Math.max(0, MIN_PUSH_INTERVAL_MS - (Date.now() - lastSent));
      pending = true;
      setTimeout(async () => {
        pending = false;
        lastSent = Date.now();
        await send();
      }, wait);
    });

    const keepAlive = setInterval(() => {
      reply.raw.write(": keep-alive\n\n");
    }, 15_000);

    request.raw.on("close", () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });
}
