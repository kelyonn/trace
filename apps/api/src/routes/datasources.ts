import type { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import type { SourceKind } from "../lib/connectors/types.js";
import {
  KIND_LABELS,
  activateSource,
  activeSourceId,
  addSource,
  allSources,
  createConnector,
  getSource,
  redact,
  removeSource,
  sourceError,
  sourceStatus,
  testConnector
} from "../lib/sources.js";
import { invalidateModels } from "../lib/model-cache.js";
import { loadTable, parseUpload, dropTable } from "../lib/uploads.js";
import { addAudit } from "../lib/store.js";
import { evaluatePolicy } from "../lib/policy.js";
import { verifyJwt } from "../lib/auth.js";

const EXTERNAL_KINDS: SourceKind[] = ["postgres", "mysql", "sqlite", "trino"];

/** Admins manage sources; in local dev (AUTH_REQUIRED unset) anyone may. */
const canManage = (role: string) =>
  role === "admin" || process.env.AUTH_REQUIRED !== "true" || process.env.ALLOW_USER_SOURCES === "true";

function extractBearer(authHeader: string | undefined): string {
  return (authHeader ?? "").replace(/^Bearer\s+/i, "").trim();
}

const view = (s: ReturnType<typeof allSources>[number]) => ({
  id: s.id,
  name: s.name,
  type: s.kind,
  kind: s.kind,
  kindLabel: KIND_LABELS[s.kind],
  builtin: !!s.builtin,
  requiresAuth: !!s.requiresAuth,
  status: sourceStatus(s),
  error: sourceError(s.id) ?? null,
  config: redact(s.config),
  createdAt: s.createdAt
});

const configSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    connectionString: { type: "string", maxLength: 2000 },
    host: { type: "string", maxLength: 255 },
    port: { type: "integer", minimum: 1, maximum: 65535 },
    database: { type: "string", maxLength: 255 },
    user: { type: "string", maxLength: 255 },
    password: { type: "string", maxLength: 1000 },
    schema: { type: "string", maxLength: 255 },
    ssl: { type: "boolean" },
    path: { type: "string", maxLength: 2000 },
    url: { type: "string", maxLength: 2000 },
    catalog: { type: "string", maxLength: 255 }
  }
} as const;

export default async function datasourceRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/api/v1/data-sources", async () => ({
    activeSourceId: activeSourceId(),
    kinds: EXTERNAL_KINDS.map((k) => ({ kind: k, label: KIND_LABELS[k] })),
    items: allSources().map(view)
  }));

  fastify.post<{ Body: { kind: SourceKind; config: Record<string, unknown> } }>(
    "/api/v1/data-sources/test",
    {
      schema: {
        body: {
          type: "object",
          required: ["kind", "config"],
          properties: { kind: { type: "string", enum: EXTERNAL_KINDS }, config: configSchema }
        }
      }
    },
    async (request) => {
      const connector = createConnector(request.body.kind, request.body.config);
      try {
        return await testConnector(connector);
      } finally {
        await connector.close();
      }
    }
  );

  fastify.post<{ Body: { name: string; kind: SourceKind; config: Record<string, unknown>; requiresAuth?: boolean; activate?: boolean } }>(
    "/api/v1/data-sources",
    {
      schema: {
        body: {
          type: "object",
          required: ["name", "kind", "config"],
          properties: {
            name: { type: "string", maxLength: 120 },
            kind: { type: "string", enum: EXTERNAL_KINDS },
            config: configSchema,
            requiresAuth: { type: "boolean" },
            activate: { type: "boolean" }
          }
        }
      }
    },
    async (request, reply) => {
      const { role } = request.trace;
      if (!canManage(role)) {
        return reply.status(403).send({ error: { code: "FORBIDDEN", message: "Only admins can add data sources" } });
      }
      const probe = createConnector(request.body.kind, request.body.config);
      const test = await testConnector(probe);
      await probe.close();
      if (!test.ok) {
        return reply.status(400).send({ error: { code: "CONNECTION_FAILED", message: "Could not connect", details: test.error } });
      }
      const src = await addSource(request.body);
      addAudit({ id: randomUUID(), action: "activate_source", dataSourceId: src.id, timestamp: new Date().toISOString(), detail: `added ${src.name}` });
      if (request.body.activate) await activateSource(src.id);
      return { ...view(src), tables: test.tables };
    }
  );

  fastify.delete<{ Params: { id: string } }>("/api/v1/data-sources/:id", async (request, reply) => {
    if (!canManage(request.trace.role)) {
      return reply.status(403).send({ error: { code: "FORBIDDEN", message: "Only admins can remove data sources" } });
    }
    try {
      await removeSource(request.params.id);
      invalidateModels(request.params.id);
      return { ok: true, activeSourceId: activeSourceId() };
    } catch (err) {
      return reply.status(400).send({ error: { code: "BAD_REQUEST", message: err instanceof Error ? err.message : String(err) } });
    }
  });

  fastify.post<{ Params: { id: string } }>(
    "/api/v1/data-sources/:id/activate",
    { schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string" } } } } },
    async (request, reply) => {
      const { id } = request.params;
      const { role } = request.trace;
      const source = getSource(id);
      if (!source) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Data source not found" } });

      const allowed = await evaluatePolicy({ role, action: "activate_source" });
      if (!allowed) return reply.status(403).send({ error: { code: "FORBIDDEN", message: "Cannot activate this data source" } });

      if (source.requiresAuth) {
        const token = extractBearer(request.headers.authorization as string | undefined);
        const jwtOk = token ? await verifyJwt(token) : false;
        if (!jwtOk) {
          return reply.status(401).send({ error: { code: "AUTH_REQUIRED", message: "Sign in with Keycloak to connect to this data source" } });
        }
      }

      try {
        await activateSource(id);
      } catch (err) {
        return reply.status(502).send({
          error: { code: "CONNECTION_FAILED", message: `Could not connect to ${source.name}`, details: err instanceof Error ? err.message : String(err) }
        });
      }
      addAudit({ id: randomUUID(), action: "activate_source", dataSourceId: id, timestamp: new Date().toISOString(), detail: source.name });
      return { activeSourceId: id, status: "connected" };
    }
  );

  // File uploads: CSV / JSON become tables in the "files" workspace.
  fastify.post<{ Body: { filename: string; content: string; table?: string; activate?: boolean } }>(
    "/api/v1/data-sources/files/upload",
    {
      bodyLimit: Number(process.env.UPLOAD_MAX_BYTES ?? 60 * 1024 * 1024),
      schema: {
        body: {
          type: "object",
          required: ["filename", "content"],
          properties: {
            filename: { type: "string", maxLength: 255 },
            content: { type: "string" },
            table: { type: "string", maxLength: 60 },
            activate: { type: "boolean" }
          }
        }
      }
    },
    async (request, reply) => {
      try {
        const parsed = parseUpload(request.body.filename, request.body.content);
        const loaded = await loadTable(request.body.table || request.body.filename, parsed);
        invalidateModels("files");
        addAudit({ id: randomUUID(), action: "schema", dataSourceId: "files", timestamp: new Date().toISOString(), detail: `uploaded ${loaded.table} (${loaded.rows} rows)` });
        if (request.body.activate !== false) await activateSource("files");
        return loaded;
      } catch (err) {
        return reply.status(400).send({ error: { code: "UPLOAD_FAILED", message: "Could not load the file", details: err instanceof Error ? err.message : String(err) } });
      }
    }
  );

  fastify.delete<{ Params: { table: string } }>("/api/v1/data-sources/files/tables/:table", async (request) => {
    await dropTable(request.params.table);
    invalidateModels("files");
    return { ok: true };
  });
}
