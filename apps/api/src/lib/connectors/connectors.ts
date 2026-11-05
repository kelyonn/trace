/**
 * Concrete connectors. Each wraps a driver, enforces read-only access where the
 * engine supports it, normalizes values to JSON-safe primitives, and reports
 * column types in a common vocabulary.
 */
import type { PGlite } from "@electric-sql/pglite";
import { postgresDialect, mysqlDialect, sqliteDialect, trinoDialect } from "./dialects.js";
import { introspectMysql, introspectPostgres, introspectTrino, inferKeys } from "./introspect-sql.js";
import { kindOf, normalizeValue, stripSemicolon, type Connector, type QueryResult, type TableInfo } from "./types.js";

const DEFAULT_MAX_ROWS = Number(process.env.MAX_RESULT_ROWS ?? "50000");
const STATEMENT_TIMEOUT_MS = Number(process.env.STATEMENT_TIMEOUT_MS ?? "30000");

export const PG_TYPE_NAMES: Record<number, string> = {
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
  19: "varchar",
  114: "json",
  3802: "json",
  2950: "uuid"
};

// ---------------------------------------------------------------------------
// PGlite (embedded demo + uploads workspace)
// ---------------------------------------------------------------------------

export class PgliteConnector implements Connector {
  readonly dialect = postgresDialect;
  constructor(
    readonly kind: "demo" | "files",
    private readonly db: () => Promise<PGlite>
  ) {}

  async query(sql: string, maxRows = DEFAULT_MAX_ROWS): Promise<QueryResult> {
    const db = await this.db();
    const res = await db.transaction(async (tx) => {
      await tx.exec("SET TRANSACTION READ ONLY");
      return tx.query<unknown[]>(stripSemicolon(sql), [], { rowMode: "array" });
    });
    return {
      columns: res.fields.map((f) => ({ name: f.name, type: PG_TYPE_NAMES[f.dataTypeID] ?? "varchar" })),
      rows: (res.rows as unknown[][]).slice(0, maxRows).map((r) => r.map(normalizeValue))
    };
  }

  async introspect(): Promise<TableInfo[]> {
    const tables = await introspectPostgres(async (sql) => (await this.query(sql)).rows);
    if (this.kind === "files") inferKeys(tables);
    return tables;
  }

  async explain(sql: string) {
    return (await this.query(this.dialect.explain(stripSemicolon(sql)))).rows.map((r) => String(r[0])).join("\n");
  }

  async ping() {
    await this.query("SELECT 1");
  }

  async close() {
    /* shared embedded instances stay open */
  }
}

// ---------------------------------------------------------------------------
// PostgreSQL (pg)
// ---------------------------------------------------------------------------

export type PostgresConfig = {
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  schema?: string;
  ssl?: boolean;
  poolSize?: number;
};

export class PostgresConnector implements Connector {
  readonly kind = "postgres" as const;
  readonly dialect = postgresDialect;
  private pool: import("pg").Pool | null = null;
  constructor(private readonly cfg: PostgresConfig) {}

  private async getPool() {
    if (this.pool) return this.pool;
    const pg = (await import("pg")).default;
    pg.types.setTypeParser(1700, (v: string) => Number(v));
    pg.types.setTypeParser(20, (v: string) => Number(v));
    pg.types.setTypeParser(1082, (v: string) => v);
    pg.types.setTypeParser(1114, (v: string) => v);
    pg.types.setTypeParser(1184, (v: string) => v);
    const schema = this.cfg.schema || "public";
    this.pool = new pg.Pool({
      connectionString: this.cfg.connectionString || undefined,
      host: this.cfg.host,
      port: this.cfg.port,
      database: this.cfg.database,
      user: this.cfg.user,
      password: this.cfg.password,
      ssl: this.cfg.ssl ? { rejectUnauthorized: false } : undefined,
      max: this.cfg.poolSize ?? 4,
      connectionTimeoutMillis: 8000
    });
    // Session guards via SET (startup "options" are rejected by poolers such as PgBouncer).
    const ident = `"${schema.replace(/"/g, '""')}"`;
    this.pool.on("connect", (client) => {
      client
        .query(
          `SET default_transaction_read_only = on; SET statement_timeout = ${STATEMENT_TIMEOUT_MS}; SET search_path = ${ident}, public`
        )
        .catch(() => undefined);
    });
    return this.pool;
  }

  async query(sql: string, maxRows = DEFAULT_MAX_ROWS): Promise<QueryResult> {
    const pool = await this.getPool();
    const res = await pool.query({ text: stripSemicolon(sql), rowMode: "array" });
    const result = Array.isArray(res) ? res[res.length - 1] : res;
    return {
      columns: (result.fields ?? []).map((f: { name: string; dataTypeID: number }) => ({
        name: f.name,
        type: PG_TYPE_NAMES[f.dataTypeID] ?? "varchar"
      })),
      rows: ((result.rows ?? []) as unknown[][]).slice(0, maxRows).map((r) => r.map(normalizeValue))
    };
  }

  async introspect() {
    return introspectPostgres(async (sql) => (await this.query(sql)).rows, this.cfg.schema || "public");
  }

  async explain(sql: string) {
    return (await this.query(this.dialect.explain(stripSemicolon(sql)))).rows.map((r) => String(r[0])).join("\n");
  }

  async ping() {
    await this.query("SELECT 1");
  }

  async close() {
    await this.pool?.end().catch(() => undefined);
    this.pool = null;
  }
}

// ---------------------------------------------------------------------------
// MySQL / MariaDB (mysql2)
// ---------------------------------------------------------------------------

export type MysqlConfig = {
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean;
};

const MYSQL_TYPES: Record<number, string> = {
  0: "decimal",
  1: "tinyint",
  2: "smallint",
  3: "integer",
  4: "float",
  5: "double",
  7: "timestamp",
  8: "bigint",
  9: "integer",
  10: "date",
  12: "datetime",
  13: "integer",
  16: "boolean",
  245: "json",
  246: "decimal",
  252: "text",
  253: "varchar",
  254: "varchar"
};

export class MysqlConnector implements Connector {
  readonly kind = "mysql" as const;
  readonly dialect = mysqlDialect;
  private pool: import("mysql2/promise").Pool | null = null;
  constructor(private readonly cfg: MysqlConfig) {}

  private async getPool() {
    if (this.pool) return this.pool;
    const mysql = await import("mysql2/promise");
    const common = {
      dateStrings: true,
      decimalNumbers: true,
      supportBigNumbers: true,
      bigNumberStrings: false,
      connectionLimit: 4,
      connectTimeout: 8000,
      multipleStatements: false
    } as const;
    this.pool = this.cfg.connectionString
      ? mysql.createPool({ uri: this.cfg.connectionString, ...common })
      : mysql.createPool({
          host: this.cfg.host,
          port: this.cfg.port,
          database: this.cfg.database,
          user: this.cfg.user,
          password: this.cfg.password,
          ssl: this.cfg.ssl ? {} : undefined,
          ...common
        });
    this.pool.on("connection", (conn) => {
      conn.query("SET SESSION TRANSACTION READ ONLY");
      conn.query(`SET SESSION MAX_EXECUTION_TIME = ${STATEMENT_TIMEOUT_MS}`);
    });
    return this.pool;
  }

  async query(sql: string, maxRows = DEFAULT_MAX_ROWS): Promise<QueryResult> {
    const pool = await this.getPool();
    const [rows, fields] = await pool.query({ sql: stripSemicolon(sql), rowsAsArray: true });
    const list = Array.isArray(rows) ? (rows as unknown[][]) : [];
    return {
      columns: (fields ?? []).map((f) => ({ name: f.name, type: MYSQL_TYPES[f.columnType ?? f.type ?? 253] ?? "varchar" })),
      rows: list.slice(0, maxRows).map((r) => r.map(normalizeValue))
    };
  }

  async introspect() {
    return introspectMysql(async (sql) => (await this.query(sql)).rows);
  }

  async explain(sql: string) {
    const res = await this.query(this.dialect.explain(stripSemicolon(sql)));
    return [res.columns.map((c) => c.name).join(" | "), ...res.rows.map((r) => r.join(" | "))].join("\n");
  }

  async ping() {
    await this.query("SELECT 1");
  }

  async close() {
    await this.pool?.end().catch(() => undefined);
    this.pool = null;
  }
}

// ---------------------------------------------------------------------------
// SQLite (node:sqlite, read-only)
// ---------------------------------------------------------------------------

export type SqliteConfig = { path: string };

/** The parts of node:sqlite (Node ≥ 22.13) used here; @types/node lags behind the runtime. */
type SqliteStatement = {
  setReturnArrays(on: boolean): void;
  columns(): { name: string; type: string | null }[];
  all(): unknown[];
};
type SqliteDb = { prepare(sql: string): SqliteStatement; close(): void };
type SqliteCtor = new (path: string, opts?: { readOnly?: boolean }) => SqliteDb;

export class SqliteConnector implements Connector {
  readonly kind = "sqlite" as const;
  readonly dialect = sqliteDialect;
  private db: SqliteDb | null = null;
  constructor(private readonly cfg: SqliteConfig) {}

  private async getDb() {
    if (this.db) return this.db;
    const DatabaseSync = (await import("node:sqlite")).DatabaseSync as unknown as SqliteCtor;
    const { existsSync } = await import("fs");
    if (!existsSync(this.cfg.path)) throw new Error(`SQLite file not found: ${this.cfg.path}`);
    this.db = new DatabaseSync(this.cfg.path, { readOnly: true });
    return this.db;
  }

  async query(sql: string, maxRows = DEFAULT_MAX_ROWS): Promise<QueryResult> {
    const db = await this.getDb();
    const stmt = db.prepare(stripSemicolon(sql));
    stmt.setReturnArrays(true);
    const meta = stmt.columns();
    const rows = (stmt.all() as unknown as unknown[][]).slice(0, maxRows).map((r) => r.map(normalizeValue));
    const columns = meta.map((c, i) => {
      let type = c.type ?? "";
      if (!type) {
        const sample = rows.find((r) => r[i] !== null)?.[i];
        type = typeof sample === "number" ? (Number.isInteger(sample) ? "integer" : "double") : "varchar";
      }
      return { name: c.name, type: type.toLowerCase() };
    });
    return { columns, rows };
  }

  async introspect(): Promise<TableInfo[]> {
    const tables = (await this.query(
      "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )).rows.map((r) => String(r[0]));
    const out: TableInfo[] = [];
    for (const name of tables) {
      const q = name.replace(/"/g, '""');
      const cols = (await this.query(`PRAGMA table_info("${q}")`)).rows;
      const fks = (await this.query(`PRAGMA foreign_key_list("${q}")`)).rows;
      const count = (await this.query(`SELECT COUNT(*) FROM "${q}"`)).rows[0]?.[0];
      out.push({
        name,
        rowCount: Number(count ?? 0),
        columns: cols.map((c) => ({ name: String(c[1]), type: String(c[2] || "text"), kind: kindOf(String(c[2] || "text")) })),
        primaryKey: cols.filter((c) => Number(c[5]) > 0).map((c) => String(c[1])),
        foreignKeys: fks.map((f) => ({ column: String(f[3]), refTable: String(f[2]), refColumn: String(f[4] ?? "id") }))
      });
    }
    inferKeys(out);
    return out;
  }

  async explain(sql: string) {
    return (await this.query(this.dialect.explain(stripSemicolon(sql)))).rows.map((r) => String(r[r.length - 1])).join("\n");
  }

  async ping() {
    await this.query("SELECT 1");
  }

  async close() {
    this.db?.close();
    this.db = null;
  }
}

// ---------------------------------------------------------------------------
// Trino (HTTP protocol)
// ---------------------------------------------------------------------------

export type TrinoConfig = { url: string; catalog: string; schema: string; user?: string };

type TrinoPage = { data?: unknown[][]; columns?: { name: string; type: string }[]; nextUri?: string; error?: { message: string } };

export class TrinoConnector implements Connector {
  readonly kind = "trino" as const;
  readonly dialect = trinoDialect;
  constructor(private readonly cfg: TrinoConfig) {}

  private async fetchJson(url: string, init?: RequestInit): Promise<TrinoPage> {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), STATEMENT_TIMEOUT_MS);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      if (!res.ok) throw new Error((await res.text()) || `Trino HTTP ${res.status}`);
      return (await res.json()) as TrinoPage;
    } finally {
      clearTimeout(t);
    }
  }

  async query(sql: string, maxRows = DEFAULT_MAX_ROWS): Promise<QueryResult> {
    const user = this.cfg.user || "trace";
    let page = await this.fetchJson(`${this.cfg.url.replace(/\/$/, "")}/v1/statement`, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        "X-Trino-User": user,
        "X-Trino-Catalog": this.cfg.catalog,
        "X-Trino-Schema": this.cfg.schema
      },
      body: stripSemicolon(sql)
    });
    let columns = page.columns ?? [];
    const rows: unknown[][] = [...(page.data ?? [])];
    while (page.nextUri && rows.length < maxRows) {
      page = await this.fetchJson(page.nextUri, { headers: { "X-Trino-User": user } });
      if (page.error) throw new Error(page.error.message);
      if (!columns.length && page.columns) columns = page.columns;
      if (page.data) rows.push(...page.data);
    }
    if (page.error) throw new Error(page.error.message);
    return { columns, rows: rows.slice(0, maxRows).map((r) => r.map(normalizeValue)) };
  }

  async introspect() {
    return introspectTrino(async (sql) => (await this.query(sql)).rows, this.cfg.schema);
  }

  async explain(sql: string) {
    return (await this.query(this.dialect.explain(stripSemicolon(sql)))).rows.map((r) => String(r[0])).join("\n");
  }

  async ping() {
    const res = await fetch(`${this.cfg.url.replace(/\/$/, "")}/v1/info`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) throw new Error(`Trino HTTP ${res.status}`);
    const info = (await res.json()) as { starting?: boolean };
    if (info.starting) throw new Error("Trino is still starting");
  }

  async close() {
    /* stateless */
  }
}
