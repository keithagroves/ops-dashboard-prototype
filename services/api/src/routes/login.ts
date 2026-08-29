import type { FastifyInstance } from "fastify";
import { AuthError, login } from "../auth";
import { ValidationError } from "../errors";

export async function registerLoginRoute(app: FastifyInstance) {
  app.post("/api/login", async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    try {
      return login(body.username, body.password);
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
