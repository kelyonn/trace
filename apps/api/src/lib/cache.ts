import { createHash } from "crypto";

const cacheTtlMs = Number(process.env.CACHE_TTL_MS ?? "30000");
const cacheMax = Number(process.env.CACHE_MAX ?? "30");

export type QueryPayload = {
  columns: { name: string; type: string }[];
  rows: unknown[][];
  rowCount: number;
};

type CacheEntry = {
  createdAt: number;
  payload: QueryPayload;
};

export const queryCache = new Map<string, CacheEntry>();

export function makeCacheKey(sourceId: string, role: string, sql: string): string {
  return createHash("sha256").update(`${sourceId}:${role}:${sql}`).digest("hex");
}

export function getCached(key: string): QueryPayload | null {
  const entry = queryCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.createdAt >= cacheTtlMs) {
    queryCache.delete(key);
    return null;
  }
  return entry.payload;
}

export function setCached(key: string, payload: QueryPayload): void {
  if (cacheTtlMs <= 0) return;
  queryCache.set(key, { createdAt: Date.now(), payload });
  if (queryCache.size > cacheMax) {
    const [firstKey] = queryCache.keys();
    queryCache.delete(firstKey);
  }
}
