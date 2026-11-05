import type { FastifyInstance } from "fastify";
import { collectTrino, engineStatus, embeddedInfo } from "../lib/trino.js";
import { activeSourceId, dataSources, metrics } from "../lib/state.js";
import { queryHistory, auditEvents } from "../lib/store.js";

export default async function statusRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/health", async () => ({ status: "ok" }));

  fastify.get("/api/v1/ping", async () => ({ message: "pong" }));

  fastify.get("/api/v1/status", async () => {
    const engine = await engineStatus();
    const trinoOk = engine.kind === "trino" && !engine.trinoError;
    let postgresOk = false;
    let postgresError: string | null = null;
    let orderCount = 0;

    try {
      const countRows = await collectTrino("SELECT COUNT(*) AS c FROM orders", 30);
      postgresOk = true;
      orderCount = Number(countRows.rows[0]?.[0] ?? 0);
      if (!Number.isFinite(orderCount)) orderCount = 0;
    } catch (err) {
      postgresError = err instanceof Error ? err.message : "Postgres check failed";
    }

    return {
      activeSourceId,
      engine: {
        kind: engine.kind,
        mode: engine.mode,
        label: engine.kind === "trino" ? "Trino → Postgres" : "Embedded Postgres (PGlite)",
        ...(engine.kind === "embedded" ? { dataset: embeddedInfo() } : {})
      },
      trino: { ok: trinoOk, version: engine.trinoVersion ?? null, error: engine.trinoError ?? null },
      postgres: { ok: postgresOk, error: postgresError },
      demo: {
        orderCount,
        seeded: orderCount > 0
      }
    };
  });

  fastify.get("/api/v1/metrics", async () => ({
    ...metrics,
    historyCount: queryHistory.length,
    auditCount: auditEvents.length,
    dataSourceCount: dataSources.length
  }));
}
