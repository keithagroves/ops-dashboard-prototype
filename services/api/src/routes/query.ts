import type { FastifyInstance } from "fastify";
import { runQuery } from "../db";
import { filtersFromQuery } from "../filters";

export async function registerQueryRoute(app: FastifyInstance) {
  app.get("/api/query", async (request, reply) => {
    const filters = filtersFromQuery(request.query as Record<string, unknown>);
    try {
      const result = await runQuery(filters);
      return result;
    } catch (err) {
      reply.code(400);
      return { error: (err as Error).message };
    }
  });
}
