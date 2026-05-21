import Fastify from "fastify";
import cors from "@fastify/cors";

const server = Fastify({
  logger: true
});

const trinoUrl = process.env.TRINO_URL ?? "http://localhost:8080";
const trinoBaseHeaders = {
  "X-Trino-User": "trace",
  "X-Trino-Catalog": "postgres",
  "X-Trino-Schema": "public"
};

const fetchTrinoStatement = async (sql: string) => {
  const response = await fetch(`${trinoUrl}/v1/statement`, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      ...trinoBaseHeaders
    },
    body: sql
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Trino request failed");
  }

  return (await response.json()) as {
    data?: unknown[][];
    columns?: { name: string; type: string }[];
    nextUri?: string;
  };
};

const fetchTrinoNext = async (nextUri: string) => {
  const response = await fetch(nextUri, {
    headers: {
      "X-Trino-User": "trace"
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Trino request failed");
  }

  return (await response.json()) as {
    data?: unknown[][];
    columns?: { name: string; type: string }[];
    nextUri?: string;
  };
};

const collectTrino = async (sql: string, maxPages = 5) => {
  const first = await fetchTrinoStatement(sql);
  const columns = first.columns ?? [];
  const rows = [...(first.data ?? [])];
  let nextUri = first.nextUri;
  let pageCount = 1;

  while (nextUri && pageCount < maxPages) {
    const next = await fetchTrinoNext(nextUri);
    if (next.columns?.length && !columns.length) {
      columns.push(...next.columns);
    }
    if (next.data?.length) {
      rows.push(...next.data);
    }
    nextUri = next.nextUri;
    pageCount += 1;
  }

  return { columns, rows, nextUri };
};

await server.register(cors, {
  origin: true
});

server.get("/health", async () => ({ status: "ok" }));

server.get("/api/v1/ping", async () => ({ message: "pong" }));

server.get("/api/v1/status", async () => {
  let trinoOk = false;
  let trinoVersion: string | null = null;
  let trinoError: string | null = null;
  let postgresOk = false;
  let postgresError: string | null = null;

  try {
    const response = await fetch(`${trinoUrl}/v1/info`);
    if (response.ok) {
      const payload = (await response.json()) as { nodeVersion?: { version?: string } };
      trinoVersion = payload.nodeVersion?.version ?? null;
      trinoOk = true;
    } else {
      trinoError = await response.text();
    }
  } catch (error) {
    trinoError = error instanceof Error ? error.message : "Trino check failed";
  }

  try {
    await collectTrino("SELECT 1", 1);
    postgresOk = true;
  } catch (error) {
    postgresError = error instanceof Error ? error.message : "Postgres check failed";
  }

  return {
    trino: { ok: trinoOk, version: trinoVersion, error: trinoError },
    postgres: { ok: postgresOk, error: postgresError }
  };
});

server.post("/api/v1/query", async (request, reply) => {
  const body = request.body as { sql?: string } | undefined;
  const sql = body?.sql?.trim();

  if (!sql) {
    return reply.status(400).send({ error: { code: "BAD_REQUEST", message: "sql is required" } });
  }

  try {
    const payload = await fetchTrinoStatement(sql);
    return { columns: payload.columns ?? [], rows: payload.data ?? [], nextUri: payload.nextUri ?? null };
  } catch (error) {
    return reply.status(502).send({
      error: {
        code: "TRINO_ERROR",
        message: "Trino request failed",
        details: error instanceof Error ? error.message : "Unknown error"
      }
    });
  }
});

server.post("/api/v1/query/next", async (request, reply) => {
  const body = request.body as { nextUri?: string } | undefined;
  const nextUri = body?.nextUri?.trim();

  if (!nextUri) {
    return reply.status(400).send({ error: { code: "BAD_REQUEST", message: "nextUri is required" } });
  }

  try {
    const payload = await fetchTrinoNext(nextUri);
    return { columns: payload.columns ?? [], rows: payload.data ?? [], nextUri: payload.nextUri ?? null };
  } catch (error) {
    return reply.status(502).send({
      error: {
        code: "TRINO_ERROR",
        message: "Trino request failed",
        details: error instanceof Error ? error.message : "Unknown error"
      }
    });
  }
});

server.get("/api/v1/schema", async (request, reply) => {
  const query = request.query as { table?: string } | undefined;
  const table = query?.table?.trim();

  if (table && !/^[a-zA-Z0-9_]+$/.test(table)) {
    return reply.status(400).send({ error: { code: "BAD_REQUEST", message: "Invalid table name" } });
  }

  try {
    if (!table) {
      const payload = await collectTrino(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
        3
      );
      return { tables: payload.rows.map((row) => String(row[0])) };
    }

    const payload = await collectTrino(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${table}' ORDER BY ordinal_position`,
      3
    );

    return {
      table,
      columns: payload.rows.map((row) => ({ name: String(row[0]), type: String(row[1]) }))
    };
  } catch (error) {
    return reply.status(502).send({
      error: {
        code: "TRINO_ERROR",
        message: "Schema request failed",
        details: error instanceof Error ? error.message : "Unknown error"
      }
    });
  }
});

server.post("/api/v1/explain", async (request, reply) => {
  const body = request.body as { sql?: string } | undefined;
  const sql = body?.sql?.trim();

  if (!sql) {
    return reply.status(400).send({ error: { code: "BAD_REQUEST", message: "sql is required" } });
  }

  try {
    const payload = await collectTrino(`EXPLAIN (TYPE DISTRIBUTED) ${sql}`, 2);
    const plan = payload.rows.map((row) => String(row[0])).join("\n");
    return { plan };
  } catch (error) {
    return reply.status(502).send({
      error: {
        code: "TRINO_ERROR",
        message: "Explain request failed",
        details: error instanceof Error ? error.message : "Unknown error"
      }
    });
  }
});

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

server
  .listen({ port, host })
  .catch((error) => {
    server.log.error(error);
    process.exit(1);
  });
