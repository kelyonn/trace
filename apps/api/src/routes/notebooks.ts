import type { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import { notebooks, saveNotebooks } from "../lib/store.js";

export default async function notebookRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/api/v1/notebooks", async () => ({ items: notebooks }));

  fastify.post<{ Body: { title?: string; content?: string } }>(
    "/api/v1/notebooks",
    {
      schema: {
        body: {
          type: "object",
          properties: {
            title: { type: "string" },
            content: { type: "string" }
          }
        }
      }
    },
    async (request) => {
      const now = new Date().toISOString();
      const notebook = {
        id: randomUUID(),
        title: request.body.title?.trim() || "Untitled",
        content: request.body.content ?? "",
        createdAt: now,
        updatedAt: now
      };
      notebooks.unshift(notebook);
      await saveNotebooks();
      return notebook;
    }
  );

  fastify.get<{ Params: { id: string } }>(
    "/api/v1/notebooks/:id",
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
      const nb = notebooks.find((n) => n.id === request.params.id);
      if (!nb) {
        return reply
          .status(404)
          .send({ error: { code: "NOT_FOUND", message: "Notebook not found" } });
      }
      return nb;
    }
  );

  fastify.put<{ Params: { id: string }; Body: { title?: string; content?: string } }>(
    "/api/v1/notebooks/:id",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } }
        },
        body: {
          type: "object",
          properties: {
            title: { type: "string" },
            content: { type: "string" }
          }
        }
      }
    },
    async (request, reply) => {
      const nb = notebooks.find((n) => n.id === request.params.id);
      if (!nb) {
        return reply
          .status(404)
          .send({ error: { code: "NOT_FOUND", message: "Notebook not found" } });
      }
      if (request.body.title) nb.title = request.body.title.trim();
      if (request.body.content !== undefined) nb.content = request.body.content;
      nb.updatedAt = new Date().toISOString();
      await saveNotebooks();
      return nb;
    }
  );
}
