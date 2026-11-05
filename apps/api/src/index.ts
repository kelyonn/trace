import "./load-env.js";
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";

import { initStores } from "./lib/store.js";
import { getEmbeddedDb } from "./lib/embedded.js";
import { initSources, connectorFor } from "./lib/sources.js";
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
import modelRoutes from "./routes/model.js";

const rateLimitMax = Number(process.env.RATE_LIMIT_MAX ?? "0");

const server = Fastify({ logger: true });

await server.register(cors, { origin: true });

if (rateLimitMax > 0) {
  await server.register(rateLimit, { max: rateLimitMax, timeWindow: "1 minute" });
}

await initStores();

// ENGINE=trino|embedded|auto picks the initial source; users can hot-swap sources at runtime.
const engineSetting = (process.env.ENGINE ?? "auto").toLowerCase();
let initial: string | undefined;
if (engineSetting === "trino") initial = "trino-local";
else if (engineSetting === "embedded") initial = "demo";
else {
  try {
    await connectorFor("trino-local").ping();
    initial = "trino-local";
  } catch {
    /* fall back to the saved choice or the embedded demo */
  }
}
await initSources(initial);

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
  await app.register(modelRoutes);
});

const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? "3000");

try {
  await server.listen({ host, port });
  // Warm up (and on first boot, seed) the embedded demo in the background.
  getEmbeddedDb((msg) => server.log.info(msg)).catch((err) => server.log.error({ err }, "embedded demo failed to start"));
} catch (err) {
  server.log.error(err);
  process.exit(1);
}
