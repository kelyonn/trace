import { kindOf, type TableInfo } from "./types.js";

type Run = (sql: string) => Promise<unknown[][]>;

const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;

/** Introspection over information_schema for Postgres-family engines (Postgres, PGlite). */
export async function introspectPostgres(run: Run, schema = "public"): Promise<TableInfo[]> {
  const s = lit(schema);
  const [tables, columns, constraints, estimates] = await Promise.all([
    run(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = ${s} AND table_type IN ('BASE TABLE', 'VIEW') ORDER BY table_name`
    ),
    run(
      `SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = ${s} ORDER BY table_name, ordinal_position`
    ),
    run(`SELECT tc.table_name, kcu.column_name, tc.constraint_type, ccu.table_name AS ref_table, ccu.column_name AS ref_column
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      LEFT JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name AND tc.constraint_type = 'FOREIGN KEY'
      WHERE tc.table_schema = ${s} AND tc.constraint_type IN ('PRIMARY KEY', 'FOREIGN KEY')`),
    run(
      `SELECT c.relname, c.reltuples FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = ${s} AND c.relkind = 'r'`
    ).catch(() => [] as unknown[][])
  ]);

  const estimate = new Map(estimates.map((r) => [String(r[0]), Number(r[1])]));
  const out: TableInfo[] = tables.map((r) => ({
    name: String(r[0]),
    rowCount: null,
    columns: [],
    primaryKey: [],
    foreignKeys: []
  }));
  const byName = new Map(out.map((t) => [t.name, t]));
  for (const r of columns) {
    const t = byName.get(String(r[0]));
    if (t) t.columns.push({ name: String(r[1]), type: String(r[2]), kind: kindOf(String(r[2])) });
  }
  for (const r of constraints) {
    const t = byName.get(String(r[0]));
    if (!t) continue;
    if (r[2] === "PRIMARY KEY") t.primaryKey.push(String(r[1]));
    else if (r[3]) t.foreignKeys.push({ column: String(r[1]), refTable: String(r[3]), refColumn: String(r[4]) });
  }
  for (const t of out) {
    const est = estimate.get(t.name);
    if (est !== undefined && est > 1000) {
      t.rowCount = Math.round(est);
    } else {
      const c = await run(`SELECT COUNT(*) FROM "${t.name.replace(/"/g, '""')}"`).catch(() => null);
      t.rowCount = c ? Number(c[0]?.[0] ?? 0) : null;
    }
  }
  return out;
}

export async function introspectMysql(run: Run): Promise<TableInfo[]> {
  const [tables, columns, keys] = await Promise.all([
    run(
      `SELECT table_name, table_rows FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type IN ('BASE TABLE', 'VIEW') ORDER BY table_name`
    ),
    run(
      `SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = DATABASE() ORDER BY table_name, ordinal_position`
    ),
    run(`SELECT table_name, column_name, constraint_name, referenced_table_name, referenced_column_name
      FROM information_schema.key_column_usage WHERE table_schema = DATABASE()`)
  ]);
  const out: TableInfo[] = tables.map((r) => ({
    name: String(r[0]),
    rowCount: r[1] === null ? null : Number(r[1]),
    columns: [],
    primaryKey: [],
    foreignKeys: []
  }));
  const byName = new Map(out.map((t) => [t.name, t]));
  for (const r of columns) {
    const t = byName.get(String(r[0]));
    if (t) t.columns.push({ name: String(r[1]), type: String(r[2]), kind: kindOf(String(r[2])) });
  }
  for (const r of keys) {
    const t = byName.get(String(r[0]));
    if (!t) continue;
    if (r[2] === "PRIMARY") t.primaryKey.push(String(r[1]));
    else if (r[3]) t.foreignKeys.push({ column: String(r[1]), refTable: String(r[3]), refColumn: String(r[4]) });
  }
  for (const t of out) {
    if (t.rowCount !== null && t.rowCount > 1000) continue;
    const c = await run(`SELECT COUNT(*) FROM \`${t.name.replace(/`/g, "``")}\``).catch(() => null);
    t.rowCount = c ? Number(c[0]?.[0] ?? 0) : t.rowCount;
  }
  return out;
}

export async function introspectTrino(run: Run, schema: string): Promise<TableInfo[]> {
  const rows = await run(
    `SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = ${lit(schema)} ORDER BY table_name, ordinal_position`
  );
  const byName = new Map<string, TableInfo>();
  for (const r of rows) {
    const name = String(r[0]);
    const t = byName.get(name) ?? { name, rowCount: null, columns: [], primaryKey: [], foreignKeys: [] };
    t.columns.push({ name: String(r[1]), type: String(r[2]), kind: kindOf(String(r[2])) });
    byName.set(name, t);
  }
  const out = [...byName.values()];
  // Trino exposes no constraints; infer keys from naming conventions (id, <table>_id).
  inferKeys(out);
  return out;
}

/**
 * For sources without declared constraints (Trino, CSV uploads, loose SQLite files):
 * treat `id` as the primary key and `<name>_id` columns as foreign keys to a table
 * named `<name>` / `<name>s` / `<name>es` when that table exists.
 */
export function inferKeys(tables: TableInfo[]): void {
  const names = new Map(tables.map((t) => [t.name.toLowerCase(), t]));
  for (const t of tables) {
    if (!t.primaryKey.length && t.columns.some((c) => c.name.toLowerCase() === "id")) {
      t.primaryKey = [t.columns.find((c) => c.name.toLowerCase() === "id")!.name];
    }
    if (t.foreignKeys.length) continue;
    for (const c of t.columns) {
      const m = /^(.*)_id$/i.exec(c.name);
      if (!m) continue;
      const base = m[1].toLowerCase();
      const target =
        names.get(base) ?? names.get(`${base}s`) ?? names.get(`${base}es`) ?? names.get(base.replace(/y$/, "ies"));
      if (target && target !== t && target.columns.some((x) => x.name.toLowerCase() === "id")) {
        t.foreignKeys.push({ column: c.name, refTable: target.name, refColumn: target.columns.find((x) => x.name.toLowerCase() === "id")!.name });
      }
    }
  }
}
