import type { FastifyInstance } from "fastify";
import { collect } from "../lib/engine.js";
import { evaluatePolicy } from "../lib/policy.js";
import { maskRows } from "../lib/auth.js";

export default async function assistantRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post<{ Body: { sql?: string } }>(
    "/api/v1/assistant/summary",
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

      try {
        const result = await collect(sql, 3);
        const { columns } = result;
        const rows = maskRows(columns, result.rows, role, colsToMask);

        const numericIndexes = columns
          .map((col, i) => ({
            i,
            isNumeric: /int|double|decimal|real|float|numeric/i.test(col.type)
          }))
          .filter((x) => x.isNumeric)
          .map((x) => x.i);

        const stats = numericIndexes.map((i) => {
          const values = rows
            .map((row) => Number(row[i]))
            .filter((v) => Number.isFinite(v));
          if (!values.length) {
            return { column: columns[i]?.name ?? `col_${i}`, min: null, max: null, avg: null };
          }
          const sum = values.reduce((acc, v) => acc + v, 0);
          return {
            column: columns[i]?.name ?? `col_${i}`,
            min: Math.min(...values),
            max: Math.max(...values),
            avg: Number((sum / values.length).toFixed(2))
          };
        });

        return {
          rowCount: rows.length,
          columns: columns.map((col) => col.name),
          numericStats: stats
        };
      } catch (err) {
        return reply.status(502).send({
          error: {
            code: "QUERY_ERROR",
            message: "Assistant summary failed",
            details: err instanceof Error ? err.message : "Unknown error"
          }
        });
      }
    }
  );
}
