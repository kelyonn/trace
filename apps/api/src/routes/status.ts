import type { FastifyInstance } from "fastify";
import { metrics } from "../lib/state.js";
import { queryHistory, auditEvents } from "../lib/store.js";
import { activeConnector, activeSourceId, allSources, getSource, KIND_LABELS } from "../lib/sources.js";
import { getTables } from "../lib/model-cache.js";
import { embeddedInfo } from "../lib/embedded.js";

export default async function statusRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/health", async () => ({ status: "ok" }));

  fastify.get("/api/v1/ping", async () => ({ message: "pong" }));

  fastify.get("/api/v1/status", async () => {
    const id = activeSourceId();
    const src = getSource(id);
    let ok = false;
    let error: string | null = null;
    let tables: { name: string; rowCount: number | null }[] = [];
    try {
      await activeConnector().ping();
      tables = (await getTables()).map((t) => ({ name: t.name, rowCount: t.rowCount }));
      ok = true;
    } catch (err) {
      error = err instanceof Error ? err.message : "Source unavailable";
    }
    const totalRows = tables.reduce((a, t) => a + (t.rowCount ?? 0), 0);
    const seeding = src?.kind === "demo" && !embeddedInfo().seeded;
    return {
      activeSourceId: id,
      source: {
        id,
        name: src?.name ?? id,
        kind: src?.kind ?? "demo",
        kindLabel: src ? KIND_LABELS[src.kind] : "",
        ok,
        error,
        seeding,
        tables,
        totalRows
      },
      // Back-compat fields consumed by older clients and the smoke test.
      trino: { ok: src?.kind === "trino" && ok, version: null, error: src?.kind === "trino" ? error : null },
      postgres: { ok, error },
      demo: { orderCount: totalRows, seeded: ok && totalRows > 0 }
    };
  });

  fastify.get("/api/v1/metrics", async () => ({
    ...metrics,
    historyCount: queryHistory.length,
    auditCount: auditEvents.length,
    dataSourceCount: allSources().length
  }));
}
