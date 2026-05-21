import type { FastifyInstance } from "fastify";
import { collectTrino } from "../lib/trino.js";
import { activeSourceId, dataSources, metrics } from "../lib/state.js";
import { queryHistory, auditEvents } from "../lib/store.js";

export default async function statusRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/health", async () => ({ status: "ok" }));

  fastify.get("/api/v1/ping", async () => ({ message: "pong" }));

  fastify.get("/api/v1/status", async () => {
    let trinoOk = false;
    let trinoVersion: string | null = null;
    let trinoError: string | null = null;
    let postgresOk = false;
    let postgresError: string | null = null;

    try {
      const trinoUrl = process.env.TRINO_URL ?? "http://localhost:8080";
      const response = await fetch(`${trinoUrl}/v1/info`);
      if (response.ok) {
        const payload = (await response.json()) as { nodeVersion?: { version?: string } };
        trinoVersion = payload.nodeVersion?.version ?? null;
        trinoOk = true;
      } else {
        trinoError = await response.text();
      }
    } catch (err) {
      trinoError = err instanceof Error ? err.message : "Trino check failed";
    }

    try {
      await collectTrino("SELECT 1", 1);
      postgresOk = true;
    } catch (err) {
      postgresError = err instanceof Error ? err.message : "Postgres check failed";
    }

    return {
      activeSourceId,
      trino: { ok: trinoOk, version: trinoVersion, error: trinoError },
      postgres: { ok: postgresOk, error: postgresError }
    };
  });

  fastify.get("/api/v1/metrics", async () => ({
    ...metrics,
    historyCount: queryHistory.length,
    auditCount: auditEvents.length,
    dataSourceCount: dataSources.length
  }));
}
