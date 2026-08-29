import Fastify from "fastify";
import cors from "@fastify/cors";
import { registerQueryRoute } from "./routes/query";
import { registerStreamRoute } from "./routes/stream";

const PORT = Number(process.env.PORT || 4000);

async function main() {
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });

  await registerQueryRoute(app);
  await registerStreamRoute(app);

  app.get("/health", async () => ({ ok: true }));

  await app.listen({ port: PORT, host: "0.0.0.0" });
  console.log(`[api] listening on :${PORT}`);
}

main().catch((err) => {
  console.error("[api] fatal", err);
  process.exit(1);
});
