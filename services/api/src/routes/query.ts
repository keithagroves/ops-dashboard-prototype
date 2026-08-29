import type { FastifyInstance } from "fastify";
import { runQuery } from "../db";
import { filtersFromQuery } from "../filters";
import { ValidationError } from "../errors";

export async function registerQueryRoute(app: FastifyInstance) {
  app.get("/api/query", async (request, reply) => {
    const filters = filtersFromQuery(request.query as Record<string, unknown>);
    try {
      return await runQuery(filters);
    } catch (err) {
      if (err instanceof ValidationError) {
        reply.code(400);
        return { error: err.message };
      }
      request.log?.error(err);
      reply.code(500);
      return { error: "internal error" };
    }
  });
}
