import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Fastify from "fastify";
import cors from "@fastify/cors";

// Mock the Trino module so tests run without a real Trino instance
vi.mock("../lib/trino.js", () => ({
  fetchTrinoStatement: vi.fn().mockResolvedValue({
    columns: [{ name: "id", type: "integer" }],
    data: [[1]],
    nextUri: undefined
  }),
  fetchTrinoNext: vi.fn().mockResolvedValue({ columns: [], data: [], nextUri: undefined }),
  collectTrino: vi.fn().mockResolvedValue({
    columns: [{ name: "count", type: "integer" }],
    rows: [[42]],
    nextUri: undefined
  })
}));

// Mock store init so no disk access is needed
vi.mock("../lib/store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/store.js")>();
  return {
    ...actual,
    initStores: vi.fn().mockResolvedValue(undefined)
  };
});

import queryRoutes from "../routes/query.js";
import schemaRoutes from "../routes/schema.js";
import exportRoutes from "../routes/exports.js";
import assistantRoutes from "../routes/assistant.js";
import statusRoutes from "../routes/status.js";

const buildServer = async () => {
  const server = Fastify({ logger: false });
  await server.register(cors, { origin: true });
  await server.register(queryRoutes);
  await server.register(schemaRoutes);
  await server.register(exportRoutes);
  await server.register(assistantRoutes);
  await server.register(statusRoutes);
  return server;
};

describe("POST /api/v1/query", () => {
  let server: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    server = await buildServer();
  });

  afterAll(async () => {
    await server.close();
  });

  it("returns results for a valid SQL query", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/v1/query",
      payload: { sql: "SELECT * FROM orders LIMIT 10" }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("columns");
    expect(body).toHaveProperty("rows");
    expect(body).toHaveProperty("queryId");
  });

  it("returns 400 when sql is missing", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/v1/query",
      payload: {}
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for write statements", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/v1/query",
      payload: { sql: "DROP TABLE orders" }
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /api/v1/schema", () => {
  let server: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    server = await buildServer();
  });

  afterAll(async () => {
    await server.close();
  });

  it("returns table list when no table param given", async () => {
    const res = await server.inject({ method: "GET", url: "/api/v1/schema" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("tables");
  });

  it("returns 400 for invalid table names", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/v1/schema?table=orders;DROP TABLE orders"
    });
    expect(res.statusCode).toBe(400);
  });

  it("accepts valid table names", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/v1/schema?table=orders"
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("POST /api/v1/exports — admin gate", () => {
  let server: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    server = await buildServer();
  });

  afterAll(async () => {
    await server.close();
  });

  it("returns 403 for non-admin role", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/v1/exports",
      headers: { "x-trace-role": "user" },
      payload: { sql: "SELECT * FROM orders", format: "csv" }
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 200 for admin role", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/v1/exports",
      headers: { "x-trace-role": "admin" },
      payload: { sql: "SELECT * FROM orders", format: "csv" }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("exportId");
  });
});

describe("POST /api/v1/assistant/summary", () => {
  let server: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    server = await buildServer();
  });

  afterAll(async () => {
    await server.close();
  });

  it("returns numeric stats for a valid query", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/v1/assistant/summary",
      payload: { sql: "SELECT COUNT(*) FROM orders" }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("rowCount");
    expect(body).toHaveProperty("numericStats");
  });

  it("returns 400 when sql is missing", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/v1/assistant/summary",
      payload: {}
    });
    expect(res.statusCode).toBe(400);
  });
});
