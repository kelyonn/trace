import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";

import { initStores } from "./lib/store.js";
import { attachTraceHooks } from "./lib/request-context.js";

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

await initStores();

await server.register(async (app) => {
  attachTraceHooks(app);
  await app.register(statusRoutes);
  await app.register(governanceRoutes);
  await app.register(datasourceRoutes);
  await app.register(schemaRoutes);
  await app.register(queryRoutes);
  await app.register(exportRoutes);
  await app.register(assistantRoutes);
  await app.register(notebookRoutes);
  await app.register(snapshotRoutes);
  await app.register(alertRoutes);
  await app.register(semanticRoutes);
  await app.register(streamRoutes);
});

const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? "3000");

try {
  await server.listen({ host, port });
} catch (err) {
  server.log.error(err);
  process.exit(1);
}
