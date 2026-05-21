import { describe, it, expect, beforeEach, vi } from "vitest";
import { makeCacheKey, getCached, setCached, queryCache } from "../lib/cache.js";

describe("query cache", () => {
  beforeEach(() => {
    queryCache.clear();
  });

  it("returns null for a missing key", () => {
    expect(getCached("does-not-exist")).toBeNull();
  });

  it("stores and retrieves a payload", () => {
    const key = makeCacheKey("src1", "user", "SELECT 1");
    const payload = { columns: [{ name: "x", type: "integer" }], rows: [[1]], rowCount: 1 };
    setCached(key, payload);
    expect(getCached(key)).toEqual(payload);
  });

  it("generates different keys for different roles", () => {
    const k1 = makeCacheKey("src", "admin", "SELECT 1");
    const k2 = makeCacheKey("src", "user", "SELECT 1");
    expect(k1).not.toBe(k2);
  });

  it("returns null after TTL expires", () => {
    vi.useFakeTimers();
    const key = makeCacheKey("src", "user", "SELECT ttl");
    setCached(key, { columns: [], rows: [], rowCount: 0 });
    expect(getCached(key)).not.toBeNull();
    // Advance past default TTL of 30000ms
    vi.advanceTimersByTime(31000);
    expect(getCached(key)).toBeNull();
    vi.useRealTimers();
  });
});
