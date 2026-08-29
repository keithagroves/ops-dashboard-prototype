import type { FastifyInstance } from "fastify";
import { runQuery } from "../db";
import { filtersFromQuery } from "../filters";
import { authenticate, AuthError } from "../auth";
import { ValidationError } from "../errors";

interface QueryRouteDependencies {
  authenticate: typeof authenticate;
  filtersFromQuery: typeof filtersFromQuery;
  runQuery: typeof runQuery;
}

export async function registerQueryRoute(
  app: FastifyInstance,
  overrides: Partial<QueryRouteDependencies> = {},
) {
  const dependencies: QueryRouteDependencies = {
    authenticate,
    filtersFromQuery,
    runQuery,
    ...overrides,
  };

  app.get("/api/query", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    try {
      const claims = dependencies.authenticate(request.headers as Record<string, unknown>, query);
      return await dependencies.runQuery(dependencies.filtersFromQuery(query, claims));
    } catch (err) {
      if (err instanceof AuthError) {
        reply.code(401);
        return { error: err.message };
      }
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
