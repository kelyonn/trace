import Fastify from "fastify";
import cors from "@fastify/cors";

const server = Fastify({
  logger: true
});

await server.register(cors, {
  origin: true
});

server.get("/health", async () => ({ status: "ok" }));

server.get("/api/v1/ping", async () => ({ message: "pong" }));

server.post("/api/v1/query", async (request, reply) => {
  const body = request.body as { sql?: string } | undefined;
  const sql = body?.sql?.trim();

  if (!sql) {
    return reply.status(400).send({ error: { code: "BAD_REQUEST", message: "sql is required" } });
  }

  const trinoUrl = process.env.TRINO_URL ?? "http://localhost:8080";
  const response = await fetch(`${trinoUrl}/v1/statement`, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      "X-Trino-User": "trace",
      "X-Trino-Catalog": "postgres",
      "X-Trino-Schema": "public"
    },
    body: sql
  });

  if (!response.ok) {
    const text = await response.text();
    return reply.status(502).send({
      error: { code: "TRINO_ERROR", message: "Trino request failed", details: text }
    });
  }

  const payload = (await response.json()) as {
    data?: unknown[][];
    columns?: { name: string; type: string }[];
    nextUri?: string;
  };

  return { columns: payload.columns ?? [], rows: payload.data ?? [], nextUri: payload.nextUri ?? null };
});

server.post("/api/v1/query/next", async (request, reply) => {
  const body = request.body as { nextUri?: string } | undefined;
  const nextUri = body?.nextUri?.trim();

  if (!nextUri) {
    return reply.status(400).send({ error: { code: "BAD_REQUEST", message: "nextUri is required" } });
  }

  const response = await fetch(nextUri, {
    headers: {
      "X-Trino-User": "trace"
    }
  });

  if (!response.ok) {
    const text = await response.text();
    return reply.status(502).send({
      error: { code: "TRINO_ERROR", message: "Trino request failed", details: text }
    });
  }

  const payload = (await response.json()) as {
    data?: unknown[][];
    columns?: { name: string; type: string }[];
    nextUri?: string;
  };

  return { columns: payload.columns ?? [], rows: payload.data ?? [], nextUri: payload.nextUri ?? null };
});

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

server
  .listen({ port, host })
  .catch((error) => {
    server.log.error(error);
    process.exit(1);
  });
