import type { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import { fetchTrinoStatement, fetchTrinoNext, collectTrino, type TrinoResult } from "../lib/trino.js";
import { addHistory, addAudit } from "../lib/store.js";
import { makeCacheKey, getCached, setCached } from "../lib/cache.js";
import { getRole, maskRows, maskColumns } from "../lib/auth.js";
import { evaluatePolicy } from "../lib/policy.js";
import { activeSourceId, metrics } from "../lib/state.js";

export default async function queryRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post<{ Body: { sql?: string } }>(
    "/api/v1/query",
    {
      schema: {
        body: {
          type: "object",
          required: ["sql"],
          properties: { sql: { type: "string", minLength: 1 } }
        }
      }
    },
    async (request, reply) => {
      const sql = (request.body.sql ?? "").trim();
      const role = getRole(request.headers as Record<string, unknown>);

      if (!sql) {
        return reply
          .status(400)
          .send({ error: { code: "BAD_REQUEST", message: "sql is required" } });
      }

      const allowed = await evaluatePolicy({ role, action: "query", sql });
      if (!allowed) {
        return reply
          .status(403)
          .send({ error: { code: "FORBIDDEN", message: "Query blocked by policy" } });
      }

      const queryId = randomUUID();
      const sourceId = activeSourceId;
      const startedAt = Date.now();
      const key = makeCacheKey(sourceId, role, sql);
      const cached = getCached(key);

      if (cached) {
        metrics.cacheHits += 1;
        return {
          queryId,
          durationMs: 0,
          rowCount: cached.rowCount,
          columns: cached.columns,
          rows: cached.rows,
          nextUri: null,
          cacheHit: true,
          maskColumns: role === "admin" ? [] : maskColumns
        };
      }

      try {
        metrics.totalQueries += 1;
        // collectTrino pages through all Trino async results automatically
        const result: TrinoResult = await collectTrino(sql, 10);
        const durationMs = Date.now() - startedAt;
        const { columns } = result;
        const maskedRows = maskRows(columns, result.rows, role);
        const rowCount = maskedRows.length;

        setCached(key, { columns, rows: maskedRows, rowCount });

        addHistory({
          id: queryId,
          sql,
          submittedAt: new Date().toISOString(),
          durationMs,
          rowCount,
          status: "completed",
          dataSourceId: sourceId
        });

        addAudit({
          id: randomUUID(),
          action: "query",
          dataSourceId: sourceId,
          timestamp: new Date().toISOString(),
          detail: sql
        });

        return {
          queryId,
          durationMs,
          rowCount,
          columns,
          rows: maskedRows,
          nextUri: result.nextUri ?? null,
          cacheHit: false,
          maskColumns: role === "admin" ? [] : maskColumns
        };
      } catch (err) {
        metrics.totalQueries += 1;
        metrics.queryErrors += 1;
        const durationMs = Date.now() - startedAt;
        const message = err instanceof Error ? err.message : "Unknown error";

        addHistory({
          id: queryId,
          sql,
          submittedAt: new Date().toISOString(),
          durationMs,
          rowCount: null,
          status: "failed",
          error: message,
          dataSourceId: sourceId
        });

        return reply.status(502).send({
          error: { code: "TRINO_ERROR", message: "Trino request failed", details: message }
        });
      }
    }
  );

  fastify.post<{ Body: { nextUri?: string; columns?: { name: string; type: string }[] } }>(
    "/api/v1/query/next",
    {
      schema: {
        body: {
          type: "object",
          required: ["nextUri"],
          properties: {
            nextUri: { type: "string", minLength: 1 },
            columns: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  type: { type: "string" }
                }
              }
            }
          }
        }
      }
    },
    async (request, reply) => {
      const { nextUri, columns: passedColumns } = request.body;
      const role = getRole(request.headers as Record<string, unknown>);

      if (!nextUri) {
        return reply
          .status(400)
          .send({ error: { code: "BAD_REQUEST", message: "nextUri is required" } });
      }

      try {
        const payload = await fetchTrinoNext(nextUri);
        const columns = passedColumns ?? payload.columns ?? [];
        const rows = maskRows(columns, payload.data ?? [], role);
        return { columns, rows, nextUri: payload.nextUri ?? null };
      } catch (err) {
        return reply.status(502).send({
          error: {
            code: "TRINO_ERROR",
            message: "Trino request failed",
            details: err instanceof Error ? err.message : "Unknown error"
          }
        });
      }
    }
  );

  fastify.post<{ Body: { sql?: string } }>(
    "/api/v1/explain",
    {
      schema: {
        body: {
          type: "object",
          required: ["sql"],
          properties: { sql: { type: "string", minLength: 1 } }
        }
      }
    },
    async (request, reply) => {
      const sql = (request.body.sql ?? "").trim();
      if (!sql) {
        return reply
          .status(400)
          .send({ error: { code: "BAD_REQUEST", message: "sql is required" } });
      }

      const sourceId = activeSourceId;

      try {
        const result = await collectTrino(`EXPLAIN (TYPE DISTRIBUTED) ${sql}`, 2);
        const plan = result.rows.map((row) => String(row[0])).join("\n");
        addAudit({
          id: randomUUID(),
          action: "explain",
          dataSourceId: sourceId,
          timestamp: new Date().toISOString(),
          detail: sql
        });
        return { plan };
      } catch (err) {
        return reply.status(502).send({
          error: {
            code: "TRINO_ERROR",
            message: "Explain request failed",
            details: err instanceof Error ? err.message : "Unknown error"
          }
        });
      }
    }
  );
}
