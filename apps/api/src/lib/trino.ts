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

export async function fetchTrinoStatement(sql: string): Promise<TrinoPage> {
  const response = await fetchWithTimeout(`${trinoUrl}/v1/statement`, {
    method: "POST",
    headers: { "Content-Type": "text/plain", ...trinoBaseHeaders },
    body: sql
  });
  if (!response.ok) {
    throw new Error((await response.text()) || "Trino request failed");
  }
  return (await response.json()) as TrinoPage;
}

export async function fetchTrinoNext(nextUri: string): Promise<TrinoPage> {
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
