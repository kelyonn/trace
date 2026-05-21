import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";

import { initStores } from "./lib/store.js";
import { isAuthRequired, validateApiKey } from "./lib/auth.js";

import statusRoutes from "./routes/status.js";
import governanceRoutes from "./routes/governance.js";
import datasourceRoutes from "./routes/datasources.js";
import schemaRoutes from "./routes/schema.js";
import queryRoutes from "./routes/query.js";
import exportRoutes from "./routes/exports.js";
import assistantRoutes from "./routes/assistant.js";
import notebookRoutes from "./routes/notebooks.js";
import snapshotRoutes from "./routes/snapshots.js";
import alertRoutes from "./routes/alerts.js";
import semanticRoutes from "./routes/semantic.js";
import streamRoutes from "./routes/stream.js";

const rateLimitMax = Number(process.env.RATE_LIMIT_MAX ?? "0");

const server = Fastify({ logger: true });

await server.register(cors, { origin: true });

if (rateLimitMax > 0) {
  await server.register(rateLimit, { max: rateLimitMax, timeWindow: "1 minute" });
}

server.addHook("preHandler", async (request, reply) => {
  if (!isAuthRequired) return;
  const authHeader = (request.headers.authorization as string | undefined) ?? "";
  if (!validateApiKey(authHeader)) {
    return reply
      .status(401)
      .send({ error: { code: "UNAUTHORIZED", message: "Invalid API key" } });
  }
});

await initStores();

await server.register(statusRoutes);
await server.register(governanceRoutes);
await server.register(datasourceRoutes);
await server.register(schemaRoutes);
await server.register(queryRoutes);
await server.register(exportRoutes);
await server.register(assistantRoutes);
await server.register(notebookRoutes);
await server.register(snapshotRoutes);
await server.register(alertRoutes);
await server.register(semanticRoutes);
await server.register(streamRoutes);

const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? "3000");

try {
  await server.listen({ host, port });
} catch (err) {
  server.log.error(err);
  process.exit(1);
}
