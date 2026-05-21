import type { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import { snapshots, saveSnapshots, addAudit } from "../lib/store.js";
import { activeSourceId } from "../lib/state.js";

export default async function snapshotRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/api/v1/snapshots", async () => ({ items: snapshots }));

  fastify.post<{ Body: { name?: string; sql?: string; summary?: string } }>(
    "/api/v1/snapshots",
    {
      schema: {
        body: {
          type: "object",
          properties: {
            name: { type: "string" },
            sql: { type: "string" },
            summary: { type: "string" }
          }
        }
      }
    },
    async (request) => {
      const snapshot = {
        id: randomUUID(),
        name: request.body.name?.trim() || "Snapshot",
        sql: request.body.sql?.trim() || "",
        summary: request.body.summary?.trim() || "",
        createdAt: new Date().toISOString()
      };
      snapshots.unshift(snapshot);
      await saveSnapshots();
      addAudit({
        id: randomUUID(),
        action: "query",
        dataSourceId: activeSourceId,
        timestamp: new Date().toISOString(),
        detail: `snapshot:${snapshot.id}`
      });
      return snapshot;
    }
  );
}
