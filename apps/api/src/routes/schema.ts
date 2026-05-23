import type { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import { collectTrino } from "../lib/trino.js";
import { addAudit } from "../lib/store.js";
import { activeSourceId } from "../lib/state.js";
import { evaluatePolicy } from "../lib/policy.js";

const SAFE_NAME = /^[a-zA-Z0-9_]+$/;

export default async function schemaRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Querystring: { table?: string } }>(
    "/api/v1/schema",
    {
      schema: {
        querystring: {
          type: "object",
          properties: { table: { type: "string" } }
        }
      }
    },
    async (request, reply) => {
      const table = (request.query.table ?? "").trim();
      const { role } = request.trace;

      const allowed = await evaluatePolicy({ role, action: "schema" });
      if (!allowed) {
        return reply
          .status(403)
          .send({ error: { code: "FORBIDDEN", message: "Schema access denied by policy" } });
      }

      if (table && !SAFE_NAME.test(table)) {
        return reply
          .status(400)
          .send({ error: { code: "BAD_REQUEST", message: "Invalid table name" } });
      }

      const sourceId = activeSourceId;

      try {
        if (!table) {
          const result = await collectTrino(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
            3
          );
          addAudit({
            id: randomUUID(),
            action: "schema",
            dataSourceId: sourceId,
            timestamp: new Date().toISOString()
          });
          return { tables: result.rows.map((row) => String(row[0])) };
        }

        const result = await collectTrino(
          `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${table}' ORDER BY ordinal_position`,
          3
        );

        addAudit({
          id: randomUUID(),
          action: "schema",
          dataSourceId: sourceId,
          timestamp: new Date().toISOString(),
          detail: table
        });

        return {
          table,
          columns: result.rows.map((row) => ({
            name: String(row[0]),
            type: String(row[1])
          }))
        };
      } catch (err) {
        return reply.status(502).send({
          error: {
            code: "TRINO_ERROR",
            message: "Schema request failed",
            details: err instanceof Error ? err.message : "Unknown error"
          }
        });
      }
    }
  );
}
