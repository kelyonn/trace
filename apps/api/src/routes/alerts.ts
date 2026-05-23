import type { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import { alerts, saveAlerts } from "../lib/store.js";
import type { AlertRule } from "../lib/store.js";
import { collectTrino } from "../lib/trino.js";
import { evaluatePolicy } from "../lib/policy.js";

export default async function alertRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/api/v1/alerts", async () => ({ items: alerts }));

  fastify.post<{
    Body: { name?: string; sql?: string; comparison?: string; threshold?: number };
  }>(
    "/api/v1/alerts",
    {
      schema: {
        body: {
          type: "object",
          required: ["sql", "comparison", "threshold"],
          properties: {
            name: { type: "string" },
            sql: { type: "string", minLength: 1 },
            comparison: { type: "string", enum: [">", "<", ">=", "<="] },
            threshold: { type: "number" }
          }
        }
      }
    },
    async (request, reply) => {
      const { name, sql, comparison, threshold } = request.body;
      const { role } = request.trace;

      if (!sql?.trim()) {
        return reply
          .status(400)
          .send({ error: { code: "BAD_REQUEST", message: "sql is required" } });
      }
      if (!comparison || !([">", "<", ">=", "<="] as string[]).includes(comparison)) {
        return reply
          .status(400)
          .send({ error: { code: "BAD_REQUEST", message: "Invalid comparison operator" } });
      }
      if (!Number.isFinite(threshold)) {
        return reply
          .status(400)
          .send({ error: { code: "BAD_REQUEST", message: "threshold must be a number" } });
      }

      const allowed = await evaluatePolicy({ role, action: "query", sql: sql.trim() });
      if (!allowed) {
        return reply
          .status(403)
          .send({ error: { code: "FORBIDDEN", message: "Alert SQL blocked by policy" } });
      }

      const alert: AlertRule = {
        id: randomUUID(),
        name: name?.trim() || "Alert",
        sql: sql.trim(),
        comparison: comparison as AlertRule["comparison"],
        threshold: threshold as number,
        createdAt: new Date().toISOString()
      };
      alerts.unshift(alert);
      await saveAlerts();
      return alert;
    }
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/v1/alerts/:id/evaluate",
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
      const alert = alerts.find((a) => a.id === request.params.id);
      const { role } = request.trace;

      if (!alert) {
        return reply
          .status(404)
          .send({ error: { code: "NOT_FOUND", message: "Alert not found" } });
      }

      const allowed = await evaluatePolicy({ role, action: "query", sql: alert.sql });
      if (!allowed) {
        return reply
          .status(403)
          .send({ error: { code: "FORBIDDEN", message: "Alert SQL blocked by policy" } });
      }

      try {
        const result = await collectTrino(alert.sql, 1);
        const value = Number(result.rows?.[0]?.[0]);
        const finite = Number.isFinite(value);

        const triggered = finite
          ? (alert.comparison === ">" && value > alert.threshold) ||
            (alert.comparison === ">=" && value >= alert.threshold) ||
            (alert.comparison === "<" && value < alert.threshold) ||
            (alert.comparison === "<=" && value <= alert.threshold)
          : false;

        alert.lastValue = finite ? value : undefined;
        if (triggered) alert.lastTriggeredAt = new Date().toISOString();
        await saveAlerts();

        return { id: alert.id, value: alert.lastValue ?? null, triggered };
      } catch (err) {
        return reply.status(502).send({
          error: {
            code: "TRINO_ERROR",
            message: "Alert evaluation failed",
            details: err instanceof Error ? err.message : "Unknown error"
          }
        });
      }
    }
  );
}
