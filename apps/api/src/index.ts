import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { createHash, randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";

const server = Fastify({
  logger: true
});

const trinoUrl = process.env.TRINO_URL ?? "http://localhost:8080";
const trinoBaseHeaders = {
  "X-Trino-User": "trace",
  "X-Trino-Catalog": "postgres",
  "X-Trino-Schema": "public"
};

const authRequired = process.env.AUTH_REQUIRED === "true";
const apiKey = process.env.API_KEY ?? "";
const maskColumns = (process.env.MASK_COLUMNS ?? "name")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const cacheTtlMs = Number(process.env.CACHE_TTL_MS ?? "30000");
const cacheMax = Number(process.env.CACHE_MAX ?? "30");
const trinoTimeoutMs = Number(process.env.TRINO_TIMEOUT_MS ?? "10000");
const rateLimitMax = Number(process.env.RATE_LIMIT_MAX ?? "0");

type DataSource = {
  id: string;
  name: string;
  type: "postgres" | "snowflake" | "bigquery" | "sqlserver";
  status: "connected" | "auth_required" | "error";
};

const dataSources: DataSource[] = [
  { id: "postgres-local", name: "Local Postgres", type: "postgres", status: "connected" }
];
let activeSourceId = dataSources[0]?.id ?? null;

type QueryHistoryItem = {
  id: string;
  sql: string;
  submittedAt: string;
  durationMs: number;
  rowCount: number | null;
  status: "completed" | "failed";
  error?: string;
  dataSourceId: string;
};

type AuditEvent = {
  id: string;
  action: "query" | "schema" | "explain" | "activate_source";
  dataSourceId: string;
  timestamp: string;
  detail?: string;
};

type ExportJob = {
  id: string;
  status: "queued" | "ready" | "failed";
  filePath?: string;
  createdAt: string;
  error?: string;
};

type Notebook = {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

type Snapshot = {
  id: string;
  name: string;
  sql: string;
  summary: string;
  createdAt: string;
};

type AlertRule = {
  id: string;
  name: string;
  sql: string;
  comparison: ">" | "<" | ">=" | "<=";
  threshold: number;
  lastValue?: number;
  lastTriggeredAt?: string;
  createdAt: string;
};

const dataDir = path.join(process.cwd(), "data");
const historyFile = path.join(dataDir, "history.json");
const auditFile = path.join(dataDir, "audit.json");
const notebooksFile = path.join(dataDir, "notebooks.json");
const snapshotsFile = path.join(dataDir, "snapshots.json");
const alertsFile = path.join(dataDir, "alerts.json");

let queryHistory: QueryHistoryItem[] = [];
let auditEvents: AuditEvent[] = [];
let notebooks: Notebook[] = [];
let snapshots: Snapshot[] = [];
let alerts: AlertRule[] = [];
const exportJobs: Record<string, ExportJob> = {};
const maxHistory = 200;
const maxAudit = 500;

const metrics = {
  totalQueries: 0,
  queryErrors: 0,
  cacheHits: 0,
  exports: 0
};

type CacheEntry = {
  createdAt: number;
  payload: { columns: { name: string; type: string }[]; rows: unknown[][]; rowCount: number };
};

const queryCache = new Map<string, CacheEntry>();

const getRole = (headers: Record<string, unknown>) => {
  const value = headers["x-trace-role"];
  const role = Array.isArray(value) ? value[0] : value;
  return typeof role === "string" && role.length ? role : "user";
};

const hashKey = (value: string) => createHash("sha256").update(value).digest("hex");

const maskRows = (
  columns: { name: string; type: string }[],
  rows: unknown[][],
  role: string
) => {
  if (role === "admin" || maskColumns.length === 0) {
    return rows;
  }

  const maskIndexes = columns
    .map((column, index) => (maskColumns.includes(column.name) ? index : -1))
    .filter((index) => index >= 0);

  if (!maskIndexes.length) {
    return rows;
  }

  return rows.map((row) => {
    const next = [...row];
    maskIndexes.forEach((index) => {
      if (index < next.length) {
        next[index] = "***";
      }
    });
    return next;
  });
};

const readJson = async <T>(filePath: string, fallback: T) => {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const writeJson = async (filePath: string, payload: unknown) => {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2));
};

const initStores = async () => {
  queryHistory = await readJson<QueryHistoryItem[]>(historyFile, []);
  auditEvents = await readJson<AuditEvent[]>(auditFile, []);
  notebooks = await readJson<Notebook[]>(notebooksFile, []);
  snapshots = await readJson<Snapshot[]>(snapshotsFile, []);
  alerts = await readJson<AlertRule[]>(alertsFile, []);
};

await initStores();

const addHistory = (item: QueryHistoryItem) => {
  queryHistory.unshift(item);
  if (queryHistory.length > maxHistory) {
    queryHistory.pop();
  }
  void writeJson(historyFile, queryHistory);
};

const addAudit = (event: AuditEvent) => {
  auditEvents.unshift(event);
  if (auditEvents.length > maxAudit) {
    auditEvents.pop();
  }
  void writeJson(auditFile, auditEvents);
};

const saveNotebooks = () => writeJson(notebooksFile, notebooks);
const saveSnapshots = () => writeJson(snapshotsFile, snapshots);
const saveAlerts = () => writeJson(alertsFile, alerts);

const fetchTrinoStatement = async (sql: string) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), trinoTimeoutMs);
  const response = await fetch(`${trinoUrl}/v1/statement`, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      ...trinoBaseHeaders
    },
    body: sql,
    signal: controller.signal
  });

  clearTimeout(timeout);

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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), trinoTimeoutMs);
  const response = await fetch(nextUri, {
    headers: {
      "X-Trino-User": "trace"
    },
    signal: controller.signal
  });

  clearTimeout(timeout);

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


if (rateLimitMax > 0) {
  await server.register(rateLimit, {
    max: rateLimitMax,
    timeWindow: "1 minute"
  });
}

server.addHook("preHandler", async (request, reply) => {
  if (!authRequired) {
    return;
  }

  const authHeader = request.headers.authorization ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token || token !== apiKey) {
    return reply.status(401).send({ error: { code: "UNAUTHORIZED", message: "Invalid API key" } });
  }
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
    activeSourceId,
    trino: { ok: trinoOk, version: trinoVersion, error: trinoError },
    postgres: { ok: postgresOk, error: postgresError }
  };
});

server.get("/api/v1/history", async () => ({ items: queryHistory }));

server.get("/api/v1/audit", async () => ({ items: auditEvents }));

server.get("/api/v1/metrics", async () => metrics);

server.get("/api/v1/notebooks", async () => ({ items: notebooks }));

server.post("/api/v1/notebooks", async (request, reply) => {
  const body = request.body as { title?: string; content?: string } | undefined;
  const title = body?.title?.trim() || "Untitled";
  const content = body?.content ?? "";
  const now = new Date().toISOString();
  const notebook: Notebook = { id: randomUUID(), title, content, createdAt: now, updatedAt: now };
  notebooks.unshift(notebook);
  await saveNotebooks();
  return notebook;
});

server.get("/api/v1/notebooks/:id", async (request, reply) => {
  const params = request.params as { id?: string } | undefined;
  const id = params?.id;
  const notebook = notebooks.find((item) => item.id === id);
  if (!notebook) {
    return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Notebook not found" } });
  }
  return notebook;
});

server.put("/api/v1/notebooks/:id", async (request, reply) => {
  const params = request.params as { id?: string } | undefined;
  const id = params?.id;
  const body = request.body as { title?: string; content?: string } | undefined;
  const notebook = notebooks.find((item) => item.id === id);
  if (!notebook) {
    return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Notebook not found" } });
  }
  if (body?.title) {
    notebook.title = body.title.trim();
  }
  if (body?.content !== undefined) {
    notebook.content = body.content;
  }
  notebook.updatedAt = new Date().toISOString();
  await saveNotebooks();
  return notebook;
});

server.get("/api/v1/snapshots", async () => ({ items: snapshots }));

server.post("/api/v1/snapshots", async (request) => {
  const body = request.body as { name?: string; sql?: string; summary?: string } | undefined;
  const snapshot: Snapshot = {
    id: randomUUID(),
    name: body?.name?.trim() || "Snapshot",
    sql: body?.sql?.trim() || "",
    summary: body?.summary?.trim() || "",
    createdAt: new Date().toISOString()
  };
  snapshots.unshift(snapshot);
  await saveSnapshots();
  addAudit({
    id: randomUUID(),
    action: "query",
    dataSourceId: activeSourceId ?? "unknown",
    timestamp: new Date().toISOString(),
    detail: `snapshot:${snapshot.id}`
  });
  return snapshot;
});

server.post("/api/v1/assistant/summary", async (request, reply) => {
  const body = request.body as { sql?: string } | undefined;
  const sql = body?.sql?.trim();
  if (!sql) {
    return reply.status(400).send({ error: { code: "BAD_REQUEST", message: "sql is required" } });
  }

  try {
    const payload = await collectTrino(sql, 3);
    const columns = payload.columns;
    const numericIndexes = columns
      .map((column, index) => ({
        index,
        isNumeric: /int|double|decimal|real|float|numeric/i.test(column.type)
      }))
      .filter((item) => item.isNumeric)
      .map((item) => item.index);

    const stats = numericIndexes.map((index) => {
      const values = payload.rows
        .map((row) => Number(row[index]))
        .filter((value) => Number.isFinite(value));
      if (!values.length) {
        return {
          column: columns[index]?.name ?? `col_${index}`,
          min: null,
          max: null,
          avg: null
        };
      }
      const sum = values.reduce((acc, value) => acc + value, 0);
      return {
        column: columns[index]?.name ?? `col_${index}`,
        min: Math.min(...values),
        max: Math.max(...values),
        avg: Number((sum / values.length).toFixed(2))
      };
    });

    return {
      rowCount: payload.rows.length,
      columns: columns.map((column) => column.name),
      numericStats: stats
    };
  } catch (error) {
    return reply.status(502).send({
      error: {
        code: "TRINO_ERROR",
        message: "Assistant summary failed",
        details: error instanceof Error ? error.message : "Unknown error"
      }
    });
  }
});

server.get("/api/v1/alerts", async () => ({ items: alerts }));

server.post("/api/v1/alerts", async (request, reply) => {
  const body = request.body as { name?: string; sql?: string; comparison?: string; threshold?: number } | undefined;
  const sql = body?.sql?.trim();
  if (!sql) {
    return reply.status(400).send({ error: { code: "BAD_REQUEST", message: "sql is required" } });
  }
  const comparison = body?.comparison as AlertRule["comparison"] | undefined;
  if (!comparison || ![">", "<", ">=", "<="].includes(comparison)) {
    return reply.status(400).send({ error: { code: "BAD_REQUEST", message: "Invalid comparison" } });
  }
  const threshold = Number(body?.threshold);
  if (!Number.isFinite(threshold)) {
    return reply.status(400).send({ error: { code: "BAD_REQUEST", message: "Invalid threshold" } });
  }

  const alert: AlertRule = {
    id: randomUUID(),
    name: body?.name?.trim() || "Alert",
    sql,
    comparison,
    threshold,
    createdAt: new Date().toISOString()
  };
  alerts.unshift(alert);
  await saveAlerts();
  return alert;
});

server.post("/api/v1/alerts/:id/evaluate", async (request, reply) => {
  const params = request.params as { id?: string } | undefined;
  const id = params?.id;
  const alert = alerts.find((item) => item.id === id);
  if (!alert) {
    return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Alert not found" } });
  }

  try {
    const payload = await collectTrino(alert.sql, 1);
    const value = Number(payload.rows?.[0]?.[0]);
    const triggered = Number.isFinite(value)
      ? (alert.comparison === ">" && value > alert.threshold) ||
        (alert.comparison === ">=" && value >= alert.threshold) ||
        (alert.comparison === "<" && value < alert.threshold) ||
        (alert.comparison === "<=" && value <= alert.threshold)
      : false;

    alert.lastValue = Number.isFinite(value) ? value : undefined;
    alert.lastTriggeredAt = triggered ? new Date().toISOString() : alert.lastTriggeredAt;
    await saveAlerts();

    return { id: alert.id, value: alert.lastValue ?? null, triggered };
  } catch (error) {
    return reply.status(502).send({
      error: {
        code: "TRINO_ERROR",
        message: "Alert evaluation failed",
        details: error instanceof Error ? error.message : "Unknown error"
      }
    });
  }
});

server.get("/api/v1/data-sources", async () => ({
  activeSourceId,
  items: dataSources
}));

server.post("/api/v1/data-sources/:id/activate", async (request, reply) => {
  const params = request.params as { id?: string } | undefined;
  const id = params?.id;

  if (!id) {
    return reply.status(400).send({ error: { code: "BAD_REQUEST", message: "id is required" } });
  }

  const source = dataSources.find((item) => item.id === id);
  if (!source) {
    return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Data source not found" } });
  }

  activeSourceId = source.id;
  addAudit({
    id: randomUUID(),
    action: "activate_source",
    dataSourceId: source.id,
    timestamp: new Date().toISOString(),
    detail: source.name
  });

  return { activeSourceId };
});

server.post("/api/v1/query", async (request, reply) => {
  const body = request.body as { sql?: string } | undefined;
  const sql = body?.sql?.trim();
  const role = getRole(request.headers as Record<string, unknown>);

  if (!sql) {
    return reply.status(400).send({ error: { code: "BAD_REQUEST", message: "sql is required" } });
  }

  const queryId = randomUUID();
  const startedAt = Date.now();
  const cacheKey = hashKey(`${activeSourceId ?? "unknown"}:${role}:${sql}`);
  const cached = queryCache.get(cacheKey);

  if (cached && Date.now() - cached.createdAt < cacheTtlMs) {
    metrics.cacheHits += 1;
    return {
      queryId,
      durationMs: 0,
      rowCount: cached.payload.rowCount,
      columns: cached.payload.columns,
      rows: cached.payload.rows,
      nextUri: null,
      cacheHit: true,
      maskColumns: role === "admin" ? [] : maskColumns
    };
  }

  try {
    metrics.totalQueries += 1;
    const payload = await fetchTrinoStatement(sql);
    const durationMs = Date.now() - startedAt;
    const rowCount = payload.data?.length ?? 0;
    const columns = payload.columns ?? [];
    const maskedRows = maskRows(columns, payload.data ?? [], role);

    if (cacheTtlMs > 0) {
      queryCache.set(cacheKey, {
        createdAt: Date.now(),
        payload: { columns, rows: maskedRows, rowCount }
      });
      if (queryCache.size > cacheMax) {
        const [firstKey] = queryCache.keys();
        queryCache.delete(firstKey);
      }
    }

    addHistory({
      id: queryId,
      sql,
      submittedAt: new Date().toISOString(),
      durationMs,
      rowCount,
      status: "completed",
      dataSourceId: activeSourceId ?? "unknown"
    });

    addAudit({
      id: randomUUID(),
      action: "query",
      dataSourceId: activeSourceId ?? "unknown",
      timestamp: new Date().toISOString(),
      detail: sql
    });

    return {
      queryId,
      durationMs,
      rowCount,
      columns,
      rows: maskedRows,
      nextUri: payload.nextUri ?? null,
      cacheHit: false,
      maskColumns: role === "admin" ? [] : maskColumns
    };
  } catch (error) {
    metrics.totalQueries += 1;
    metrics.queryErrors += 1;
    const durationMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : "Unknown error";

    addHistory({
      id: queryId,
      sql,
      submittedAt: new Date().toISOString(),
      durationMs,
      rowCount: null,
      status: "failed",
      error: message,
      dataSourceId: activeSourceId ?? "unknown"
    });

    return reply.status(502).send({
      error: {
        code: "TRINO_ERROR",
        message: "Trino request failed",
        details: message
      }
    });
  }
});

server.post("/api/v1/query/next", async (request, reply) => {
  const body = request.body as { nextUri?: string; columns?: { name: string; type: string }[] } | undefined;
  const nextUri = body?.nextUri?.trim();
  const role = getRole(request.headers as Record<string, unknown>);

  if (!nextUri) {
    return reply.status(400).send({ error: { code: "BAD_REQUEST", message: "nextUri is required" } });
  }

  try {
    const payload = await fetchTrinoNext(nextUri);
    const columns = body?.columns ?? payload.columns ?? [];
    const rows = maskRows(columns, payload.data ?? [], role);
    return {
      columns,
      rows,
      nextUri: payload.nextUri ?? null
    };
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
      addAudit({
        id: randomUUID(),
        action: "schema",
        dataSourceId: activeSourceId ?? "unknown",
        timestamp: new Date().toISOString()
      });
      return { tables: payload.rows.map((row) => String(row[0])) };
    }

    const payload = await collectTrino(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${table}' ORDER BY ordinal_position`,
      3
    );

    addAudit({
      id: randomUUID(),
      action: "schema",
      dataSourceId: activeSourceId ?? "unknown",
      timestamp: new Date().toISOString(),
      detail: table
    });

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
    addAudit({
      id: randomUUID(),
      action: "explain",
      dataSourceId: activeSourceId ?? "unknown",
      timestamp: new Date().toISOString(),
      detail: sql
    });
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

server.post("/api/v1/exports", async (request, reply) => {
  const role = getRole(request.headers as Record<string, unknown>);
  if (role !== "admin") {
    return reply.status(403).send({ error: { code: "FORBIDDEN", message: "Export requires admin" } });
  }

  const body = request.body as { sql?: string; format?: "csv" } | undefined;
  const sql = body?.sql?.trim();
  const format = body?.format ?? "csv";

  if (!sql) {
    return reply.status(400).send({ error: { code: "BAD_REQUEST", message: "sql is required" } });
  }

  if (format !== "csv") {
    return reply.status(400).send({ error: { code: "BAD_REQUEST", message: "Only csv is supported" } });
  }

  const exportId = randomUUID();
  exportJobs[exportId] = { id: exportId, status: "queued", createdAt: new Date().toISOString() };

  try {
    metrics.exports += 1;
    const payload = await collectTrino(sql, 5);
    const header = payload.columns.map((column) => column.name).join(",");
    const lines = payload.rows.map((row) =>
      row
        .map((cell) => {
          const text = String(cell ?? "");
          if (text.includes(",") || text.includes("\n") || text.includes("\"")) {
            return `"${text.replace(/"/g, "\"\"")}"`;
          }
          return text;
        })
        .join(",")
    );

    await fs.mkdir(path.join(dataDir, "exports"), { recursive: true });
    const filePath = path.join(dataDir, "exports", `${exportId}.csv`);
    await fs.writeFile(filePath, [header, ...lines].join("\n"));
    exportJobs[exportId] = {
      id: exportId,
      status: "ready",
      createdAt: exportJobs[exportId].createdAt,
      filePath
    };

    return { exportId, status: "ready", downloadUrl: `/api/v1/exports/${exportId}/download` };
  } catch (error) {
    exportJobs[exportId] = {
      id: exportId,
      status: "failed",
      createdAt: exportJobs[exportId].createdAt,
      error: error instanceof Error ? error.message : "Export failed"
    };
    return reply.status(502).send({
      error: {
        code: "TRINO_ERROR",
        message: "Export failed",
        details: error instanceof Error ? error.message : "Unknown error"
      }
    });
  }
});

server.get("/api/v1/exports/:id", async (request, reply) => {
  const params = request.params as { id?: string } | undefined;
  const id = params?.id;
  if (!id || !exportJobs[id]) {
    return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Export not found" } });
  }
  const job = exportJobs[id];
  return { id: job.id, status: job.status, downloadUrl: job.filePath ? `/api/v1/exports/${id}/download` : null };
});

server.get("/api/v1/exports/:id/download", async (request, reply) => {
  const params = request.params as { id?: string } | undefined;
  const id = params?.id;
  if (!id || !exportJobs[id]?.filePath) {
    return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Export not found" } });
  }
  const job = exportJobs[id];
  const file = await fs.readFile(job.filePath as string);
  reply.header("Content-Type", "text/csv");
  reply.header("Content-Disposition", `attachment; filename=trace-export-${id}.csv`);
  return reply.send(file);
});

server.post("/api/v1/exports", async (request, reply) => {
  const role = getRole(request.headers as Record<string, unknown>);
  if (role !== "admin") {
    return reply.status(403).send({ error: { code: "FORBIDDEN", message: "Export requires admin" } });
  }

  const body = request.body as { sql?: string; format?: "csv" } | undefined;
  const sql = body?.sql?.trim();
  const format = body?.format ?? "csv";

  if (!sql) {
    return reply.status(400).send({ error: { code: "BAD_REQUEST", message: "sql is required" } });
  }

  if (format !== "csv") {
    return reply.status(400).send({ error: { code: "BAD_REQUEST", message: "Only csv is supported" } });
  }

  const exportId = randomUUID();
  exportJobs[exportId] = { id: exportId, status: "queued", createdAt: new Date().toISOString() };

  try {
    metrics.exports += 1;
    const payload = await collectTrino(sql, 5);
    const header = payload.columns.map((column) => column.name).join(",");
    const lines = payload.rows.map((row) =>
      row
        .map((cell) => {
          const text = String(cell ?? "");
          if (text.includes(",") || text.includes("\n") || text.includes("\"")) {
            return `"${text.replace(/"/g, "\"\"")}"`;
          }
          return text;
        })
        .join(",")
    );

    await fs.mkdir(path.join(dataDir, "exports"), { recursive: true });
    const filePath = path.join(dataDir, "exports", `${exportId}.csv`);
    await fs.writeFile(filePath, [header, ...lines].join("\n"));
    exportJobs[exportId] = {
      id: exportId,
      status: "ready",
      createdAt: exportJobs[exportId].createdAt,
      filePath
    };

    return { exportId, status: "ready", downloadUrl: `/api/v1/exports/${exportId}/download` };
  } catch (error) {
    exportJobs[exportId] = {
      id: exportId,
      status: "failed",
      createdAt: exportJobs[exportId].createdAt,
      error: error instanceof Error ? error.message : "Export failed"
    };
    return reply.status(502).send({
      error: {
        code: "TRINO_ERROR",
        message: "Export failed",
        details: error instanceof Error ? error.message : "Unknown error"
      }
    });
  }
});

server.get("/api/v1/exports/:id", async (request, reply) => {
  const params = request.params as { id?: string } | undefined;
  const id = params?.id;
  if (!id || !exportJobs[id]) {
    return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Export not found" } });
  }
  const job = exportJobs[id];
  return { id: job.id, status: job.status, downloadUrl: job.filePath ? `/api/v1/exports/${id}/download` : null };
});

server.post("/api/v1/query", async (request, reply) => {
  const body = request.body as { sql?: string } | undefined;
  const sql = body?.sql?.trim();
  const role = getRole(request.headers as Record<string, unknown>);

  if (!sql) {
    return reply.status(400).send({ error: { code: "BAD_REQUEST", message: "sql is required" } });
  }

  const queryId = randomUUID();
  const startedAt = Date.now();
  const cacheKey = hashKey(`${activeSourceId ?? "unknown"}:${role}:${sql}`);
  const cached = queryCache.get(cacheKey);

  if (cached && Date.now() - cached.createdAt < cacheTtlMs) {
    metrics.cacheHits += 1;
    return {
      queryId,
      durationMs: 0,
      rowCount: cached.payload.rowCount,
      columns: cached.payload.columns,
      rows: cached.payload.rows,
      nextUri: null,
      cacheHit: true,
      maskColumns: role === "admin" ? [] : maskColumns
    };
  }

  try {
    metrics.totalQueries += 1;
    const payload = await fetchTrinoStatement(sql);
    const durationMs = Date.now() - startedAt;
    const rowCount = payload.data?.length ?? 0;
    const columns = payload.columns ?? [];
    const maskedRows = maskRows(columns, payload.data ?? [], role);

    if (cacheTtlMs > 0) {
      queryCache.set(cacheKey, {
        createdAt: Date.now(),
        payload: { columns, rows: maskedRows, rowCount }
      });
      if (queryCache.size > cacheMax) {
        const [firstKey] = queryCache.keys();
        queryCache.delete(firstKey);
      }
    }

    addHistory({
      id: queryId,
      sql,
      submittedAt: new Date().toISOString(),
      durationMs,
      rowCount,
      status: "completed",
      dataSourceId: activeSourceId ?? "unknown"
    });

    addAudit({
      id: randomUUID(),
      action: "query",
      dataSourceId: activeSourceId ?? "unknown",
      timestamp: new Date().toISOString(),
      detail: sql
    });

    return {
      queryId,
      durationMs,
      rowCount,
      columns,
      rows: maskedRows,
      nextUri: payload.nextUri ?? null,
      cacheHit: false,
      maskColumns: role === "admin" ? [] : maskColumns
    };
  } catch (error) {
    metrics.totalQueries += 1;
    metrics.queryErrors += 1;
    const durationMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : "Unknown error";

    addHistory({
      id: queryId,
      sql,
      submittedAt: new Date().toISOString(),
      durationMs,
      rowCount: null,
      status: "failed",
      error: message,
      dataSourceId: activeSourceId ?? "unknown"
    });

    return reply.status(502).send({
      error: {
        code: "TRINO_ERROR",
        message: "Trino request failed",
        details: message
      }
    });
  }
});
