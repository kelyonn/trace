import type { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import { fetchStatement, fetchNext } from "../lib/engine.js";
import { addHistory, addAudit } from "../lib/store.js";
import { maskRows } from "../lib/auth.js";
import { evaluatePolicy } from "../lib/policy.js";
import { metrics } from "../lib/state.js";
import { activeSourceId } from "../lib/sources.js";
import { pendingQueries, enqueueStreamJob } from "../lib/stream-jobs.js";

export default async function streamRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post<{ Body: { sql?: string } }>(
    "/api/v1/queries",
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
      const { role, maskColumns: colsToMask } = request.trace;

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

      const queryId = enqueueStreamJob({ sql, role, maskColumns: colsToMask });
      reply.status(202);
      return { queryId, status: "pending", streamUrl: `/api/v1/queries/${queryId}/stream` };
    }
  );

  fastify.get<{ Params: { id: string }; Querystring: { token?: string } }>(
    "/api/v1/queries/:id/stream",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } }
        },
        querystring: {
          type: "object",
          properties: { token: { type: "string" } }
        }
      }
    },
    async (request, reply) => {
      const { id } = request.params;
      const job = pendingQueries.get(id);
      if (!job) {
        return reply
          .status(404)
          .send({ error: { code: "NOT_FOUND", message: "Query not found or expired" } });
      }

      pendingQueries.delete(id);
      const { sql, role, maskColumns: colsToMask } = job;
      const sourceId = activeSourceId();

      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*"
      });

      const send = (event: string, data: unknown) => {
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      const startedAt = Date.now();
      metrics.totalQueries += 1;
      let totalRows = 0;
      let columns: { name: string; type: string }[] = [];

      try {
        const first = await fetchStatement(sql);
        columns = first.columns ?? [];
        const maskedRows = maskRows(columns, first.data ?? [], role, colsToMask);
        totalRows += maskedRows.length;

        if (maskedRows.length > 0) {
          send("data", { columns, rows: maskedRows });
        }
        send("progress", { rowCount: totalRows });

        let nextUri = first.nextUri;
        const maxPages = 10;
        let pageCount = 1;

        while (nextUri && pageCount < maxPages) {
          const next = await fetchNext(nextUri);
          if (next.columns?.length && columns.length === 0) {
            columns = next.columns;
          }
          const batch = maskRows(columns, next.data ?? [], role, colsToMask);
          totalRows += batch.length;
          if (batch.length > 0) {
            send("data", { columns, rows: batch });
          }
          send("progress", { rowCount: totalRows });
          nextUri = next.nextUri;
          pageCount += 1;
        }

        const durationMs = Date.now() - startedAt;
        send("complete", { queryId: id, rowCount: totalRows, durationMs, columns });

        addHistory({
          id,
          sql,
          submittedAt: new Date().toISOString(),
          durationMs,
          rowCount: totalRows,
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
      } catch (err) {
        metrics.queryErrors += 1;
        const durationMs = Date.now() - startedAt;
        const message = err instanceof Error ? err.message : "Unknown error";

        send("error", { code: "QUERY_ERROR", message });

        addHistory({
          id,
          sql,
          submittedAt: new Date().toISOString(),
          durationMs,
          rowCount: null,
          status: "failed",
          error: message,
          dataSourceId: sourceId
        });
      } finally {
        reply.raw.end();
      }

      return reply;
    }
  );
}
