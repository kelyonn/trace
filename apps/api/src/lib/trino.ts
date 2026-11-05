import {
  embeddedStatement,
  embeddedNext,
  EMBEDDED_URI_PREFIX,
  embeddedInfo,
  getEmbeddedDb
} from "./embedded.js";

const trinoUrl = process.env.TRINO_URL ?? "http://localhost:8080";
const trinoBaseHeaders = {
  "X-Trino-User": "trace",
  "X-Trino-Catalog": "postgres",
  "X-Trino-Schema": "public"
};
const trinoTimeoutMs = Number(process.env.TRINO_TIMEOUT_MS ?? "10000");

export type TrinoPage = {
  data?: unknown[][];
  columns?: { name: string; type: string }[];
  nextUri?: string;
};

async function fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), trinoTimeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

export type EngineKind = "trino" | "embedded";

const engineSetting = (process.env.ENGINE ?? "auto").toLowerCase();
const PROBE_TTL_MS = 30_000;
let probeCache: { kind: EngineKind; at: number; trinoVersion: string | null; trinoError: string | null } | null =
  null;

async function probeTrino(): Promise<{ ok: boolean; version: string | null; error: string | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(`${trinoUrl}/v1/info`, { signal: controller.signal });
    if (!response.ok) return { ok: false, version: null, error: `HTTP ${response.status}` };
    const payload = (await response.json()) as { nodeVersion?: { version?: string }; starting?: boolean };
    if (payload.starting) return { ok: false, version: null, error: "Trino is starting" };
    return { ok: true, version: payload.nodeVersion?.version ?? null, error: null };
  } catch (err) {
    return { ok: false, version: null, error: err instanceof Error ? err.message : "Trino unreachable" };
  } finally {
    clearTimeout(timeout);
  }
}

/** Resolve which engine executes queries: ENGINE=trino|embedded|auto (default auto). */
export async function resolveEngine(): Promise<EngineKind> {
  return (await engineStatus()).kind;
}

export async function engineStatus() {
  if (engineSetting === "embedded") {
    return { kind: "embedded" as EngineKind, mode: engineSetting, trinoVersion: null, trinoError: "disabled" };
  }
  if (!probeCache || Date.now() - probeCache.at > PROBE_TTL_MS) {
    const probe = await probeTrino();
    const kind: EngineKind = probe.ok || engineSetting === "trino" ? "trino" : "embedded";
    probeCache = { kind, at: Date.now(), trinoVersion: probe.version, trinoError: probe.error };
  }
  return { ...probeCache, mode: engineSetting };
}

export { embeddedInfo, getEmbeddedDb };

export async function fetchTrinoStatement(sql: string): Promise<TrinoPage> {
  if ((await resolveEngine()) === "embedded") {
    return embeddedStatement(sql);
  }
  const response = await fetchWithTimeout(`${trinoUrl}/v1/statement`, {
    method: "POST",
    headers: { "Content-Type": "text/plain", ...trinoBaseHeaders },
    body: sql.trim().replace(/;\s*$/, "")
  });
  if (!response.ok) {
    throw new Error((await response.text()) || "Trino request failed");
  }
  return (await response.json()) as TrinoPage;
}

export async function fetchTrinoNext(nextUri: string): Promise<TrinoPage> {
  if (nextUri.startsWith(EMBEDDED_URI_PREFIX)) {
    return embeddedNext(nextUri);
  }
  const response = await fetchWithTimeout(nextUri, {
    headers: { "X-Trino-User": "trace" }
  });
  if (!response.ok) {
    throw new Error((await response.text()) || "Trino request failed");
  }
  return (await response.json()) as TrinoPage;
}

export type TrinoResult = {
  columns: { name: string; type: string }[];
  rows: unknown[][];
  nextUri?: string;
};

export async function collectTrino(sql: string, maxPages = 5): Promise<TrinoResult> {
  const first = await fetchTrinoStatement(sql);
  const columns = first.columns ?? [];
  const rows = [...(first.data ?? [])];
  let nextUri = first.nextUri;
  let pageCount = 1;

  while (nextUri && pageCount < maxPages) {
    const next = await fetchTrinoNext(nextUri);
    if (next.columns?.length && columns.length === 0) {
      columns.push(...next.columns);
    }
    if (next.data?.length) {
      rows.push(...next.data);
    }
    nextUri = next.nextUri;
    pageCount += 1;
  }

  return { columns, rows, nextUri };
}
