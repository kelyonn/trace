import type { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { collect } from "../lib/engine.js";
import { dataDir } from "../lib/store.js";
import { evaluatePolicy } from "../lib/policy.js";
import { exportJobs, metrics } from "../lib/state.js";
import { activeSourceId } from "../lib/sources.js";

export default async function exportRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post<{ Body: { sql?: string; format?: string } }>(
    "/api/v1/exports",
    {
      schema: {
        body: {
          type: "object",
          required: ["sql"],
          properties: {
            sql: { type: "string", minLength: 1 },
            format: { type: "string", enum: ["csv"] }
          }
        }
      }
    },
    async (request, reply) => {
      const { role } = request.trace;
      const allowed = await evaluatePolicy({ role, action: "export" });
      if (!allowed) {
        return reply
          .status(403)
          .send({ error: { code: "FORBIDDEN", message: "Export requires admin role" } });
      }

      const sql = (request.body.sql ?? "").trim();
      const format = request.body.format ?? "csv";

      if (!sql) {
        return reply
          .status(400)
          .send({ error: { code: "BAD_REQUEST", message: "sql is required" } });
      }
      if (format !== "csv") {
        return reply
          .status(400)
          .send({ error: { code: "BAD_REQUEST", message: "Only csv format is supported" } });
      }

      const queryAllowed = await evaluatePolicy({ role, action: "query", sql });
      if (!queryAllowed) {
        return reply
          .status(403)
          .send({ error: { code: "FORBIDDEN", message: "Export SQL blocked by policy" } });
      }

      const exportId = randomUUID();
      exportJobs[exportId] = { id: exportId, status: "queued", createdAt: new Date().toISOString() };

      try {
        metrics.exports += 1;
        const result = await collect(sql, 5);
        const header = result.columns.map((col) => col.name).join(",");
        const lines = result.rows.map((row) =>
          row
            .map((cell) => {
              const text = String(cell ?? "");
              if (text.includes(",") || text.includes("\n") || text.includes('"')) {
                return `"${text.replace(/"/g, '""')}"`;
              }
              return text;
            })
            .join(",")
        );

        const exportsDir = path.join(dataDir, "exports");
        await fs.mkdir(exportsDir, { recursive: true });
        const filePath = path.join(exportsDir, `${exportId}.csv`);
        await fs.writeFile(filePath, [header, ...lines].join("\n"));

        exportJobs[exportId] = {
          id: exportId,
          status: "ready",
          createdAt: exportJobs[exportId].createdAt,
          filePath
        };

        return {
          exportId,
          status: "ready",
          downloadUrl: `/api/v1/exports/${exportId}/download`
        };
      } catch (err) {
        exportJobs[exportId] = {
          id: exportId,
          status: "failed",
          createdAt: exportJobs[exportId].createdAt,
          error: err instanceof Error ? err.message : "Export failed"
        };
        return reply.status(502).send({
          error: {
            code: "QUERY_ERROR",
            message: "Export failed",
            details: err instanceof Error ? err.message : "Unknown error"
          }
        });
      }
    }
  );

  fastify.get<{ Params: { id: string } }>(
    "/api/v1/exports/:id",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } }
        }
      }
    },
    async (request, reply) => {
      const { role } = request.trace;
      const allowed = await evaluatePolicy({ role, action: "export" });
      if (!allowed) {
        return reply.status(403).send({ error: { code: "FORBIDDEN", message: "Export requires admin role" } });
      }

      const { id } = request.params;
      const job = exportJobs[id];
      if (!job) {
        return reply
          .status(404)
          .send({ error: { code: "NOT_FOUND", message: "Export not found" } });
      }
      return {
        id: job.id,
        status: job.status,
        downloadUrl: job.filePath ? `/api/v1/exports/${id}/download` : null
      };
    }
  );

  fastify.get<{ Params: { id: string } }>(
    "/api/v1/exports/:id/download",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } }
        }
      }
    },
    async (request, reply) => {
      const { role } = request.trace;
      const allowed = await evaluatePolicy({ role, action: "export" });
      if (!allowed) {
        return reply.status(403).send({ error: { code: "FORBIDDEN", message: "Export requires admin role" } });
      }

      const { id } = request.params;
      const job = exportJobs[id];
      if (!job?.filePath) {
        return reply
          .status(404)
          .send({ error: { code: "NOT_FOUND", message: "Export not found or not ready" } });
      }
      const file = await fs.readFile(job.filePath);
      reply.header("Content-Type", "text/csv");
      reply.header("Content-Disposition", `attachment; filename=trace-export-${id}.csv`);
      return reply.send(file);
    }
  );
}
