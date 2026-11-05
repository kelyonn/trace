export type ColumnKind = "number" | "date" | "text" | "boolean" | "other";

export type ColumnInfo = { name: string; type: string; kind: ColumnKind };

export type ForeignKey = { column: string; refTable: string; refColumn: string };

export type TableInfo = {
  name: string;
  rowCount: number | null;
  columns: ColumnInfo[];
  primaryKey: string[];
  foreignKeys: ForeignKey[];
};

export type ResultColumn = { name: string; type: string };
export type QueryResult = { columns: ResultColumn[]; rows: unknown[][] };

export type SourceKind = "demo" | "files" | "postgres" | "mysql" | "sqlite" | "trino";

export interface Dialect {
  name: "postgres" | "mysql" | "sqlite" | "trino";
  quote(identifier: string): string;
  /** Text label for a dimension value (NULL-safe). */
  label(expr: string): string;
  year(expr: string): string;
  quarter(expr: string): string;
  month(expr: string): string;
  explain(sql: string): string;
  /** Wraps a query so only the first n rows are read (for sampling). */
  sample(table: string, columns: string[], n: number): string;
}

export interface Connector {
  readonly kind: SourceKind;
  readonly dialect: Dialect;
  query(sql: string, maxRows?: number): Promise<QueryResult>;
  introspect(): Promise<TableInfo[]>;
  explain(sql: string): Promise<string>;
  ping(): Promise<void>;
  close(): Promise<void>;
}

/** Normalizes a database type name into a coarse kind used by the semantic model. */
export function kindOf(type: string): ColumnKind {
  const t = type.toLowerCase();
  if (/bool/.test(t)) return "boolean";
  if (/(timestamp|datetime|date|time)/.test(t) && !/interval/.test(t)) return "date";
  if (/(int|numeric|decimal|double|real|float|money|number|serial)/.test(t)) return "number";
  if (/(char|text|string|varchar|enum|uuid|clob|name)/.test(t)) return "text";
  return "other";
}

export function normalizeValue(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return Number(v);
  if (v instanceof Date) {
    const iso = v.toISOString();
    return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso.replace("T", " ").replace(/\.000Z$/, "");
  }
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(v)) return `<${v.length} bytes>`;
  if (typeof v === "object") return JSON.stringify(v);
  return v;
}

export const stripSemicolon = (sql: string) => sql.trim().replace(/;\s*$/, "");
