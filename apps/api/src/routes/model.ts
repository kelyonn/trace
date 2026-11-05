import type { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import { buildAggregateSql, type AggregateRequest } from "../lib/automodel.js";
import { getModel, invalidateModels } from "../lib/model-cache.js";
import { activeConnector, activeSourceId } from "../lib/sources.js";
import { evaluatePolicy } from "../lib/policy.js";
import { addAudit } from "../lib/store.js";
import { metrics } from "../lib/state.js";
import { makeCacheKey, getCached, setCached } from "../lib/cache.js";

/** Masked columns are not offered as dimensions to non-admin roles. */
const hiddenFor = (role: string, maskColumns: string[]) => (role === "admin" ? [] : maskColumns);

export default async function modelRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Querystring: { fact?: string; refresh?: string } }>("/api/v1/model", async (request, reply) => {
    const { role, maskColumns } = request.trace;
    const allowed = await evaluatePolicy({ role, action: "schema" });
    if (!allowed) return reply.status(403).send({ error: { code: "FORBIDDEN", message: "Schema access denied by policy" } });
    if (request.query.refresh === "true") invalidateModels(activeSourceId());
    try {
      return await getModel({ fact: request.query.fact || undefined, hiddenColumns: hiddenFor(role, maskColumns) });
    } catch (err) {
      return reply.status(502).send({
        error: { code: "MODEL_ERROR", message: "Could not build a model for this source", details: err instanceof Error ? err.message : String(err) }
      });
    }
  });

  fastify.post<{ Body: AggregateRequest & { fact?: string; sqlOnly?: boolean } }>(
    "/api/v1/aggregate",
    {
      schema: {
        body: {
          type: "object",
          required: ["dims", "measures"],
          properties: {
            fact: { type: "string" },
            sqlOnly: { type: "boolean" },
            dims: { type: "array", items: { type: "string" }, maxItems: 3 },
            measures: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6 },
            filters: {
              type: "array",
              items: {
                type: "object",
                required: ["dim", "value"],
                properties: { dim: { type: "string" }, value: { type: "string" } }
              }
            },
            order: {
              type: "object",
              properties: {
                by: { type: "string", enum: ["measure", "dim"] },
                index: { type: "integer" },
                dir: { type: "string", enum: ["asc", "desc"] }
              }
            },
            limit: { type: "integer", minimum: 1, maximum: 100000 }
          }
        }
      }
    },
    async (request, reply) => {
      const { role, maskColumns } = request.trace;
      const sourceId = activeSourceId();
      let sql: string;
      try {
        const model = await getModel({ fact: request.body.fact, hiddenColumns: hiddenFor(role, maskColumns) });
        sql = buildAggregateSql(model, request.body, activeConnector().dialect);
      } catch (err) {
        return reply.status(400).send({ error: { code: "BAD_REQUEST", message: err instanceof Error ? err.message : String(err) } });
      }
      if (request.body.sqlOnly) return { sql };
      const allowed = await evaluatePolicy({ role, action: "query", sql });
      if (!allowed) return reply.status(403).send({ error: { code: "FORBIDDEN", message: "Query blocked by policy" } });

      const key = makeCacheKey(sourceId, role, sql);
      const cached = getCached(key);
      if (cached) {
        metrics.cacheHits += 1;
        return { sql, columns: cached.columns, rows: cached.rows, durationMs: 0, cacheHit: true };
      }
      const started = Date.now();
      try {
        metrics.totalQueries += 1;
        const result = await activeConnector().query(sql, 100000);
        setCached(key, { columns: result.columns, rows: result.rows, rowCount: result.rows.length });
        addAudit({ id: randomUUID(), action: "query", dataSourceId: sourceId, timestamp: new Date().toISOString(), detail: sql });
        return { sql, columns: result.columns, rows: result.rows, durationMs: Date.now() - started, cacheHit: false };
      } catch (err) {
        metrics.queryErrors += 1;
        return reply.status(502).send({
          error: { code: "QUERY_ERROR", message: "Aggregate query failed", details: err instanceof Error ? err.message : String(err) }
        });
      }
    }
  );
}
