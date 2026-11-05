/**
 * Query engine facade over the active data source. Results are paged with
 * opaque `page://` next URIs so streaming and "load more" work for every
 * connector, not just Trino.
 */
import { randomUUID } from "crypto";
import { activeConnector, activeSourceId, getSource } from "./sources.js";
import type { ResultColumn } from "./connectors/types.js";

const PAGE_SIZE = Number(process.env.PAGE_SIZE ?? process.env.EMBEDDED_PAGE_SIZE ?? "1000");
const PAGE_TTL_MS = 10 * 60 * 1000;
export const PAGE_URI_PREFIX = "page://";

export type Page = { data?: unknown[][]; columns?: ResultColumn[]; nextUri?: string };
export type EngineResult = { columns: ResultColumn[]; rows: unknown[][]; nextUri?: string };

const pages = new Map<string, { columns: ResultColumn[]; rows: unknown[][]; expires: number }>();

function sweep() {
  const now = Date.now();
  for (const [k, v] of pages) if (v.expires < now) pages.delete(k);
}

function pageFrom(id: string, offset: number): Page {
  const entry = pages.get(id);
  if (!entry) throw new Error("Result page expired");
  const next = offset + PAGE_SIZE;
  const more = next < entry.rows.length;
  if (!more) pages.delete(id);
  return {
    columns: entry.columns,
    data: entry.rows.slice(offset, next),
    nextUri: more ? `${PAGE_URI_PREFIX}${id}/${next}` : undefined
  };
}

/** Runs SQL on the active source and returns the first page. */
export async function fetchStatement(sql: string): Promise<Page> {
  const result = await activeConnector().query(sql);
  sweep();
  const id = randomUUID();
  pages.set(id, { columns: result.columns, rows: result.rows, expires: Date.now() + PAGE_TTL_MS });
  return pageFrom(id, 0);
}

export async function fetchNext(nextUri: string): Promise<Page> {
  if (!nextUri.startsWith(PAGE_URI_PREFIX)) throw new Error("Invalid page cursor");
  const [id, offset] = nextUri.slice(PAGE_URI_PREFIX.length).split("/");
  return pageFrom(id, Number(offset) || 0);
}

/** Collects up to `maxPages` pages; the rest stays reachable through `nextUri`. */
export async function collect(sql: string, maxPages = 10): Promise<EngineResult> {
  let page = await fetchStatement(sql);
  const columns = page.columns ?? [];
  const rows = [...(page.data ?? [])];
  let count = 1;
  while (page.nextUri && count < maxPages) {
    page = await fetchNext(page.nextUri);
    rows.push(...(page.data ?? []));
    count++;
  }
  return { columns, rows, nextUri: page.nextUri };
}

export async function explainSql(sql: string): Promise<string> {
  return activeConnector().explain(sql);
}

export function activeSourceInfo() {
  const id = activeSourceId();
  const src = getSource(id);
  return { id, name: src?.name ?? id, kind: src?.kind ?? "demo" };
}
