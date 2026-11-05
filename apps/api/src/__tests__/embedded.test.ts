import { describe, it, expect, beforeAll } from "vitest";
import { generateDemoData, DEMO_START, DEMO_END } from "../lib/demo-data.js";
import { translateSql } from "../lib/embedded.js";

describe("demo data generator", () => {
  const small = { customers: 120, products: 48, ordersPerDay: 4 };

  it("is deterministic for a given seed", () => {
    const a = generateDemoData(small, 7);
    const b = generateDemoData(small, 7);
    expect(a.orders.length).toBe(b.orders.length);
    expect(a.orders.slice(0, 20)).toEqual(b.orders.slice(0, 20));
  });

  it("keeps referential integrity and consistent totals", () => {
    const d = generateDemoData(small, 11);
    const customerIds = new Set(d.customers.map((c) => c.id));
    const productIds = new Set(d.products.map((p) => p.id));
    const lineTotals = new Map<number, number>();
    for (const l of d.orderLines) {
      expect(productIds.has(l.product_id)).toBe(true);
      lineTotals.set(l.order_id, (lineTotals.get(l.order_id) ?? 0) + l.line_amount);
    }
    for (const o of d.orders) {
      expect(customerIds.has(o.customer_id)).toBe(true);
      expect(o.order_date >= DEMO_START && o.order_date <= DEMO_END).toBe(true);
      expect(Math.abs((lineTotals.get(o.id) ?? 0) - o.amount)).toBeLessThan(0.05);
    }
  });

  it("produces year-over-year growth", () => {
    const d = generateDemoData({ customers: 300, products: 60, ordersPerDay: 12 }, 3);
    const byYear = (y: string) => d.orders.filter((o) => o.order_date.startsWith(y)).length;
    expect(byYear("2025")).toBeGreaterThan(byYear("2024"));
  });
});

describe("translateSql", () => {
  it("rewrites Trino EXPLAIN options and strips catalog prefixes and semicolons", () => {
    expect(translateSql("EXPLAIN (TYPE DISTRIBUTED) SELECT * FROM postgres.public.orders;")).toBe(
      "EXPLAIN SELECT * FROM orders"
    );
  });
});

describe("embedded engine (PGlite)", () => {
  let mod: typeof import("../lib/embedded.js");

  beforeAll(async () => {
    process.env.EMBEDDED_PERSIST = "false";
    process.env.EMBEDDED_PAGE_SIZE = "1000";
    mod = await import("../lib/embedded.js");
    await mod.getEmbeddedDb(() => undefined);
  }, 120_000);

  it("runs aggregate queries with Trino-style column metadata", async () => {
    const page = await mod.embeddedStatement(
      "SELECT c.region, SUM(o.amount) AS total_amount, COUNT(*) AS n FROM orders o JOIN customers c ON c.id = o.customer_id GROUP BY 1 ORDER BY 2 DESC"
    );
    expect(page.columns?.map((c) => c.type)).toEqual(["varchar", "decimal", "bigint"]);
    expect(page.data?.length).toBe(6);
    expect(typeof page.data?.[0]?.[1]).toBe("number");
    expect(typeof page.data?.[0]?.[2]).toBe("number");
  });

  it("pages large results through embedded:// next URIs", async () => {
    const first = await mod.embeddedStatement("SELECT id FROM orders ORDER BY id LIMIT 2500");
    expect(first.data?.length).toBe(1000);
    expect(first.nextUri?.startsWith(mod.EMBEDDED_URI_PREFIX)).toBe(true);
    const second = await mod.embeddedNext(first.nextUri!);
    const third = await mod.embeddedNext(second.nextUri!);
    expect(third.data?.length).toBe(500);
    expect(third.nextUri).toBeUndefined();
  });

  it("rejects writes (read-only transactions)", async () => {
    await expect(mod.embeddedStatement("DELETE FROM orders")).rejects.toThrow();
    const count = await mod.embeddedStatement("SELECT COUNT(*) FROM orders");
    expect(Number(count.data?.[0]?.[0])).toBeGreaterThan(0);
  });
});
