/**
 * Embedded query engine: an in-process Postgres (PGlite / WASM) seeded with the
 * synthetic demo dataset. Used when Trino is not reachable so Trace runs end to
 * end without Docker. Results are paged to mimic Trino's nextUri protocol, so
 * streaming and "load more" work unchanged.
 */
import { randomUUID } from "crypto";
import { mkdirSync } from "fs";
import type { PGlite as PGliteType } from "@electric-sql/pglite";
import { generateDemoData, DEMO_START, DEMO_END } from "./demo-data.js";
import { resolveRepoPath } from "./paths.js";

const SEED_VERSION = "trace-demo-v2";
const PAGE_SIZE = Number(process.env.EMBEDDED_PAGE_SIZE ?? "1000");
const PAGE_TTL_MS = 10 * 60 * 1000;

export const EMBEDDED_URI_PREFIX = "embedded://";

type Column = { name: string; type: string };
export type EmbeddedPage = { data?: unknown[][]; columns?: Column[]; nextUri?: string };

const pages = new Map<string, { columns: Column[]; rows: unknown[][]; expires: number }>();

let dbPromise: Promise<PGliteType> | null = null;
let seedInfo: { seeded: boolean; seedMs: number; counts: Record<string, number> } = {
  seeded: false,
  seedMs: 0,
  counts: {}
};

const TYPE_NAMES: Record<number, string> = {
  16: "boolean",
  20: "bigint",
  21: "smallint",
  23: "integer",
  25: "varchar",
  700: "real",
  701: "double",
  1042: "char",
  1043: "varchar",
  1082: "date",
  1114: "timestamp",
  1184: "timestamp with time zone",
  1700: "decimal",
  19: "varchar"
};

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS customers (
  id INT PRIMARY KEY,
  name TEXT NOT NULL,
  industry TEXT NOT NULL,
  region TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
  id INT PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  unit_price NUMERIC(12, 2) NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  id INT PRIMARY KEY,
  customer_id INT NOT NULL REFERENCES customers(id),
  order_date DATE NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  status TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS order_lines (
  id INT PRIMARY KEY,
  order_id INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INT NOT NULL REFERENCES products(id),
  quantity INT NOT NULL CHECK (quantity > 0),
  line_amount NUMERIC(12, 2) NOT NULL
);
CREATE SCHEMA IF NOT EXISTS trace_meta;
CREATE TABLE IF NOT EXISTS trace_meta.seed (version TEXT PRIMARY KEY, seeded_at TIMESTAMP NOT NULL);
`;

const INDEX_SQL = `
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_order_date ON orders(order_date);
CREATE INDEX IF NOT EXISTS idx_order_lines_order_id ON order_lines(order_id);
CREATE INDEX IF NOT EXISTS idx_order_lines_product_id ON order_lines(product_id);
`;

const esc = (s: string) => `'${s.replace(/'/g, "''")}'`;

async function bulkInsert<T>(
  db: PGliteType,
  table: string,
  cols: string[],
  rows: T[],
  toValues: (row: T) => string,
  chunk = 2000
): Promise<void> {
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    await db.exec(`INSERT INTO ${table} (${cols.join(", ")}) VALUES ${slice.map(toValues).join(",")};`);
  }
}

async function seed(db: PGliteType, log: (msg: string) => void): Promise<void> {
  const started = Date.now();
  await db.exec(SCHEMA_SQL);
  const meta = await db.query<{ version: string }>("SELECT version FROM trace_meta.seed");
  if (meta.rows.some((r) => r.version === SEED_VERSION)) {
    seedInfo = { seeded: true, seedMs: 0, counts: await tableCounts(db) };
    log(`embedded engine: reusing seeded data (${seedInfo.counts.orders} orders)`);
    return;
  }

  log("embedded engine: generating demo dataset…");
  await db.exec("TRUNCATE order_lines, orders, products, customers, trace_meta.seed CASCADE;");
  const data = generateDemoData();
  await db.exec("BEGIN;");
  await bulkInsert(db, "customers", ["id", "name", "industry", "region"], data.customers, (c) =>
    `(${c.id},${esc(c.name)},${esc(c.industry)},${esc(c.region)})`
  );
  await bulkInsert(db, "products", ["id", "sku", "category", "unit_price"], data.products, (p) =>
    `(${p.id},${esc(p.sku)},${esc(p.category)},${p.unit_price})`
  );
  await bulkInsert(db, "orders", ["id", "customer_id", "order_date", "amount", "status"], data.orders, (o) =>
    `(${o.id},${o.customer_id},'${o.order_date}',${o.amount},${esc(o.status)})`
  );
  await bulkInsert(
    db,
    "order_lines",
    ["id", "order_id", "product_id", "quantity", "line_amount"],
    data.orderLines,
    (l) => `(${l.id},${l.order_id},${l.product_id},${l.quantity},${l.line_amount})`
  );
  await db.exec(`INSERT INTO trace_meta.seed VALUES (${esc(SEED_VERSION)}, now());`);
  await db.exec("COMMIT;");
  await db.exec(INDEX_SQL);
  await db.exec("ANALYZE;");
  seedInfo = { seeded: true, seedMs: Date.now() - started, counts: await tableCounts(db) };
  log(
    `embedded engine: seeded ${data.orders.length} orders / ${data.orderLines.length} lines in ${seedInfo.seedMs} ms`
  );
}

async function tableCounts(db: PGliteType): Promise<Record<string, number>> {
  const res = await db.query<{ t: string; c: number }>(
    `SELECT 'customers' AS t, COUNT(*)::int AS c FROM customers
     UNION ALL SELECT 'products', COUNT(*)::int FROM products
     UNION ALL SELECT 'orders', COUNT(*)::int FROM orders
     UNION ALL SELECT 'order_lines', COUNT(*)::int FROM order_lines`
  );
  return Object.fromEntries(res.rows.map((r) => [r.t, Number(r.c)]));
}

export function getEmbeddedDb(log: (msg: string) => void = (m) => console.log(m)): Promise<PGliteType> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const { PGlite, types } = await import("@electric-sql/pglite");
      const persist = (process.env.EMBEDDED_PERSIST ?? "true") !== "false";
      let dataDir: string | undefined;
      if (persist) {
        dataDir = process.env.EMBEDDED_DATA_DIR ?? resolveRepoPath("data", "pglite");
        mkdirSync(dataDir, { recursive: true });
      }
      const db = new PGlite({
        dataDir,
        parsers: {
          [types.NUMERIC]: (v: string) => Number(v),
          [types.INT8]: (v: string) => Number(v),
          [types.DATE]: (v: string) => v,
          [types.TIMESTAMP]: (v: string) => v,
          [types.TIMESTAMPTZ]: (v: string) => v
        }
      });
      await db.waitReady;
      await seed(db, log);
      return db;
    })().catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

export function embeddedInfo() {
  return { ...seedInfo, range: { start: DEMO_START, end: DEMO_END } };
}

/** Translate Trino-only syntax to Postgres equivalents. */
export function translateSql(sql: string): string {
  let out = sql.trim().replace(/;\s*$/, "");
  out = out.replace(/^EXPLAIN\s*\(\s*TYPE\s+\w+\s*\)/i, "EXPLAIN");
  out = out.replace(/\bpostgres\.public\./gi, "");
  return out;
}

function sweepPages(): void {
  const now = Date.now();
  for (const [key, page] of pages) {
    if (page.expires < now) pages.delete(key);
  }
}

function pageFrom(id: string, offset: number): EmbeddedPage {
  const entry = pages.get(id);
  if (!entry) throw new Error("Embedded result page expired");
  const data = entry.rows.slice(offset, offset + PAGE_SIZE);
  const nextOffset = offset + PAGE_SIZE;
  const hasMore = nextOffset < entry.rows.length;
  if (!hasMore) pages.delete(id);
  return {
    columns: entry.columns,
    data,
    nextUri: hasMore ? `${EMBEDDED_URI_PREFIX}${id}/${nextOffset}` : undefined
  };
}

export async function embeddedStatement(sql: string): Promise<EmbeddedPage> {
  const db = await getEmbeddedDb();
  const translated = translateSql(sql);
  const result = await db.transaction(async (tx) => {
    await tx.exec("SET TRANSACTION READ ONLY");
    return tx.query<unknown[]>(translated, [], { rowMode: "array" });
  });
  const columns: Column[] = result.fields.map((f) => ({
    name: f.name,
    type: TYPE_NAMES[f.dataTypeID] ?? "varchar"
  }));
  const rows = (result.rows as unknown[][]).map((row) =>
    row.map((v) => (v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === "bigint" ? Number(v) : v))
  );
  sweepPages();
  const id = randomUUID();
  pages.set(id, { columns, rows, expires: Date.now() + PAGE_TTL_MS });
  return pageFrom(id, 0);
}

export async function embeddedNext(nextUri: string): Promise<EmbeddedPage> {
  const rest = nextUri.slice(EMBEDDED_URI_PREFIX.length);
  const [id, offsetRaw] = rest.split("/");
  return pageFrom(id, Number(offsetRaw) || 0);
}
