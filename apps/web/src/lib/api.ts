import { apiBase } from "../config";

export type Requester = <T>(path: string, init?: { method?: string; body?: unknown }) => Promise<T>;

export class ApiError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

export function makeRequester(getHeaders: () => Record<string, string>): Requester {
  return async function request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
    const response = await fetch(`${apiBase}${path}`, {
      method: init?.method ?? (init?.body !== undefined ? "POST" : "GET"),
      headers: getHeaders(),
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const err = payload?.error ?? {};
      const msg = err.details
        ? `${err.message ?? "Request failed"}: ${String(err.details).slice(0, 400)}`
        : err.message;
      throw new ApiError(msg ?? `Request failed (${response.status})`, err.code);
    }
    return (await response.json()) as T;
  };
}

export type QueryPayload = {
  queryId?: string;
  durationMs?: number;
  rowCount?: number;
  columns: { name: string; type: string }[];
  rows: unknown[][];
  nextUri: string | null;
  cacheHit?: boolean;
  maskColumns?: string[];
};
