import type { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import { dataSources, activeSourceId, setActiveSourceId } from "../lib/state.js";
import { addAudit } from "../lib/store.js";

export default async function datasourceRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/api/v1/data-sources", async () => ({
    activeSourceId,
    items: dataSources
  }));

  fastify.post<{ Params: { id: string } }>(
    "/api/v1/data-sources/:id/activate",
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
      const { id } = request.params;
      const source = dataSources.find((s) => s.id === id);
      if (!source) {
        return reply
          .status(404)
          .send({ error: { code: "NOT_FOUND", message: "Data source not found" } });
      }

      setActiveSourceId(source.id);
      addAudit({
        id: randomUUID(),
        action: "activate_source",
        dataSourceId: source.id,
        timestamp: new Date().toISOString(),
        detail: source.name
      });

      return { activeSourceId: source.id };
    }
  );
}
