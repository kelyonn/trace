import type { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import { dataSources, activeSourceId, setActiveSourceId } from "../lib/state.js";
import { addAudit } from "../lib/store.js";
import { evaluatePolicy } from "../lib/policy.js";
import { verifyJwt } from "../lib/auth.js";

function extractBearer(authHeader: string | undefined): string {
  return (authHeader ?? "").replace(/^Bearer\s+/i, "").trim();
}

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
      const { role } = request.trace;
      const source = dataSources.find((s) => s.id === id);

      if (!source) {
        return reply
          .status(404)
          .send({ error: { code: "NOT_FOUND", message: "Data source not found" } });
      }

      const allowed = await evaluatePolicy({ role, action: "activate_source" });
      if (!allowed) {
        return reply
          .status(403)
          .send({ error: { code: "FORBIDDEN", message: "Cannot activate this data source" } });
      }

      if (source.status === "auth_required") {
        const token = extractBearer(request.headers.authorization as string | undefined);
        const jwtOk = token ? await verifyJwt(token) : false;
        if (!jwtOk) {
          return reply.status(401).send({
            error: {
              code: "AUTH_REQUIRED",
              message: "Sign in with Keycloak to connect to this data source"
            }
          });
        }
        source.status = "connected";
      }

      setActiveSourceId(source.id);
      addAudit({
        id: randomUUID(),
        action: "activate_source",
        dataSourceId: source.id,
        timestamp: new Date().toISOString(),
        detail: source.name
      });

      return { activeSourceId: source.id, status: source.status };
    }
  );
}
