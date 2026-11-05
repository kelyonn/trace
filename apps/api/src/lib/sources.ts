/**
 * Data source registry. Sources are hot-swappable: they can be added, tested,
 * activated and removed at runtime. Exactly one source is active; switching
 * closes the previous connector and invalidates its cached semantic model.
 */
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import type { Connector, SourceKind } from "./connectors/types.js";
import {
  MysqlConnector,
  PgliteConnector,
  PostgresConnector,
  SqliteConnector,
  TrinoConnector,
  type MysqlConfig,
  type PostgresConfig,
  type SqliteConfig,
  type TrinoConfig
} from "./connectors/connectors.js";
import { getEmbeddedDb } from "./embedded.js";
import { getFilesDb } from "./uploads.js";
import { ensureFleetSample, fleetSamplePath } from "./samples.js";
import { dataDir } from "./store.js";

export type SourceConfig = {
  id: string;
  name: string;
  kind: SourceKind;
  config: Record<string, unknown>;
  builtin?: boolean;
  /** Requires a verified Keycloak JWT before it can be activated (FR-2). */
  requiresAuth?: boolean;
  createdAt: string;
};

export type SourceStatus = "connected" | "auth_required" | "error" | "available";

export const KIND_LABELS: Record<SourceKind, string> = {
  demo: "Demo (embedded Postgres)",
  files: "Uploaded files",
  postgres: "PostgreSQL",
  mysql: "MySQL / MariaDB",
  sqlite: "SQLite",
  trino: "Trino"
};

const trinoUrl = process.env.TRINO_URL ?? "http://localhost:8080";

const BUILTINS: SourceConfig[] = [
  { id: "demo", name: "Retail demo", kind: "demo", config: {}, builtin: true, createdAt: "2024-01-01T00:00:00Z" },
  { id: "files", name: "Uploaded files", kind: "files", config: {}, builtin: true, createdAt: "2024-01-01T00:00:00Z" },
  {
    id: "fleet-sample",
    name: "Fleet trips (SQLite sample)",
    kind: "sqlite",
    config: { path: "(generated on first use)" },
    builtin: true,
    createdAt: "2024-01-01T00:00:00Z"
  },
  {
    id: "trino-local",
    name: "Trino (docker compose)",
    kind: "trino",
    config: { url: trinoUrl, catalog: "postgres", schema: "public" },
    builtin: true,
    createdAt: "2024-01-01T00:00:00Z"
  }
];

let custom: SourceConfig[] = [];
let activeId = "demo";
const connectors = new Map<string, Connector>();
const lastError = new Map<string, string>();
const listeners = new Set<(id: string) => void>();
const sourcesFile = () => path.join(dataDir, "sources.json");

export function allSources(): SourceConfig[] {
  return [...BUILTINS, ...custom];
}

export function getSource(id: string): SourceConfig | undefined {
  return allSources().find((s) => s.id === id);
}

export function activeSourceId(): string {
  return activeId;
}

export function onSourceChange(fn: (id: string) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function createConnector(kind: SourceKind, config: Record<string, unknown>): Connector {
  switch (kind) {
    case "demo":
      return new PgliteConnector("demo", () => getEmbeddedDb());
    case "files":
      return new PgliteConnector("files", () => getFilesDb());
    case "postgres":
      return new PostgresConnector(config as PostgresConfig);
    case "mysql":
      return new MysqlConnector(config as MysqlConfig);
    case "sqlite":
      return new SqliteConnector(config as SqliteConfig);
    case "trino":
      return new TrinoConnector(config as TrinoConfig);
    default:
      throw new Error(`Unsupported source kind: ${kind as string}`);
  }
}

export function connectorFor(id: string): Connector {
  const existing = connectors.get(id);
  if (existing) return existing;
  const src = getSource(id);
  if (!src) throw new Error(`Unknown data source: ${id}`);
  const c = id === "fleet-sample" ? lazySample() : createConnector(src.kind, src.config);
  connectors.set(id, c);
  return c;
}

/** The fleet sample file is generated the first time it is used. */
function lazySample(): Connector {
  const inner = createConnector("sqlite", { path: fleetSamplePath() });
  const ready = () => ensureFleetSample();
  return {
    kind: inner.kind,
    dialect: inner.dialect,
    query: async (sql, max) => (await ready(), inner.query(sql, max)),
    introspect: async () => (await ready(), inner.introspect()),
    explain: async (sql) => (await ready(), inner.explain(sql)),
    ping: async () => (await ready(), inner.ping()),
    close: () => inner.close()
  };
}

export function activeConnector(): Connector {
  return connectorFor(activeId);
}

export async function testConnector(c: Connector): Promise<{ ok: true; tables: number } | { ok: false; error: string }> {
  try {
    await c.ping();
    const tables = await c.introspect();
    return { ok: true, tables: tables.length };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function activateSource(id: string): Promise<void> {
  const src = getSource(id);
  if (!src) throw new Error(`Unknown data source: ${id}`);
  const c = connectorFor(id);
  try {
    await c.ping();
    lastError.delete(id);
  } catch (err) {
    lastError.set(id, err instanceof Error ? err.message : String(err));
    throw err;
  }
  const previous = activeId;
  activeId = id;
  if (previous !== id) {
    // Release pooled connections of the previous external source.
    const prev = connectors.get(previous);
    if (prev && !["demo", "files"].includes(prev.kind)) {
      connectors.delete(previous);
      void prev.close();
    }
  }
  await persist();
  listeners.forEach((fn) => fn(id));
}

export async function addSource(input: {
  name: string;
  kind: SourceKind;
  config: Record<string, unknown>;
  requiresAuth?: boolean;
}): Promise<SourceConfig> {
  if (input.kind === "demo" || input.kind === "files") throw new Error("Built-in source kinds cannot be added");
  const src: SourceConfig = {
    id: `${input.kind}-${randomUUID().slice(0, 8)}`,
    name: input.name.trim() || KIND_LABELS[input.kind],
    kind: input.kind,
    config: input.config,
    requiresAuth: input.requiresAuth,
    createdAt: new Date().toISOString()
  };
  custom.push(src);
  await persist();
  return src;
}

export async function removeSource(id: string): Promise<void> {
  const src = getSource(id);
  if (!src) throw new Error(`Unknown data source: ${id}`);
  if (src.builtin) throw new Error("Built-in sources cannot be removed");
  custom = custom.filter((s) => s.id !== id);
  const c = connectors.get(id);
  connectors.delete(id);
  await c?.close();
  if (activeId === id) {
    activeId = "demo";
    listeners.forEach((fn) => fn(activeId));
  }
  await persist();
}

export function sourceStatus(src: SourceConfig): SourceStatus {
  if (lastError.has(src.id)) return "error";
  if (src.id === activeId) return "connected";
  if (src.requiresAuth) return "auth_required";
  return "available";
}

export function sourceError(id: string): string | undefined {
  return lastError.get(id);
}

const SECRET_KEYS = /password|secret|token/i;

/** Config safe to send to clients: secrets and credentials in URLs are masked. */
export function redact(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    if (SECRET_KEYS.test(k) && v) out[k] = "••••••";
    else if (typeof v === "string" && /:\/\/[^/]*:[^@/]+@/.test(v)) out[k] = v.replace(/(:\/\/[^:/]+:)[^@/]+@/, "$1••••••@");
    else out[k] = v;
  }
  return out;
}

async function persist(): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(sourcesFile(), JSON.stringify({ activeId, sources: custom }, null, 2), { mode: 0o600 });
}

export async function initSources(defaultActive?: string): Promise<void> {
  try {
    const raw = JSON.parse(await fs.readFile(sourcesFile(), "utf8")) as { activeId?: string; sources?: SourceConfig[] };
    custom = (raw.sources ?? []).filter((s) => s && s.id && s.kind);
    if (raw.activeId && getSource(raw.activeId)) activeId = raw.activeId;
  } catch {
    custom = [];
  }
  if (defaultActive && getSource(defaultActive)) activeId = defaultActive;
}

/** Test helper: reset registry state. */
export function __resetSources(): void {
  custom = [];
  activeId = "demo";
  connectors.clear();
  lastError.clear();
}
