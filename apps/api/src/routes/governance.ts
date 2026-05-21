import type { FastifyInstance } from "fastify";
import { queryHistory, auditEvents } from "../lib/store.js";

export default async function governanceRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/api/v1/history", async () => ({ items: queryHistory }));

  fastify.get("/api/v1/audit", async () => ({ items: auditEvents }));
}
