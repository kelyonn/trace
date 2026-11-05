import type { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import { addAudit } from "../lib/store.js";
import { activeSourceId } from "../lib/sources.js";
import { evaluatePolicy } from "../lib/policy.js";
import { getTables, invalidateModels } from "../lib/model-cache.js";

const SAFE_NAME = /^[\w .$-]+$/;

export default async function schemaRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Querystring: { table?: string; full?: string; refresh?: string } }>(
    "/api/v1/schema",
    {
      schema: {
        querystring: {
          type: "object",
          properties: { table: { type: "string" }, full: { type: "string" }, refresh: { type: "string" } }
        }
      }
    },
    async (request, reply) => {
      const table = (request.query.table ?? "").trim();
      const { role } = request.trace;

      const allowed = await evaluatePolicy({ role, action: "schema" });
      if (!allowed) {
        return reply.status(403).send({ error: { code: "FORBIDDEN", message: "Schema access denied by policy" } });
      }

      if (table && !SAFE_NAME.test(table)) {
        return reply.status(400).send({ error: { code: "BAD_REQUEST", message: "Invalid table name" } });
      }

      const sourceId = activeSourceId();
      if (request.query.refresh === "true") invalidateModels(sourceId);
      try {
        const tables = await getTables();
        addAudit({
          id: randomUUID(),
          action: "schema",
          dataSourceId: sourceId,
          timestamp: new Date().toISOString(),
          detail: table || undefined
        });
        if (request.query.full === "true") return { sourceId, tables };
        if (!table) return { tables: tables.map((t) => t.name) };
        const t = tables.find((x) => x.name === table);
        if (!t) return reply.status(404).send({ error: { code: "NOT_FOUND", message: `Unknown table: ${table}` } });
        return {
          table,
          rowCount: t.rowCount,
          primaryKey: t.primaryKey,
          foreignKeys: t.foreignKeys,
          columns: t.columns.map((c) => ({ name: c.name, type: c.type }))
        };
      } catch (err) {
        return reply.status(502).send({
          error: { code: "QUERY_ERROR", message: "Schema request failed", details: err instanceof Error ? err.message : "Unknown error" }
        });
      }
    }
  );
}
