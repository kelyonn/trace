/**
 * "Files" workspace: CSV / JSON uploads become typed tables in an embedded
 * Postgres (PGlite), so uploaded data can be joined, aggregated and explored in
 * the cube exactly like a database source.
 */
import { mkdirSync } from "fs";
import Papa from "papaparse";
import type { PGlite } from "@electric-sql/pglite";
import { resolveRepoPath } from "./paths.js";

const MAX_ROWS = Number(process.env.UPLOAD_MAX_ROWS ?? "500000");

let dbPromise: Promise<PGlite> | null = null;

export function getFilesDb(): Promise<PGlite> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const { PGlite, types } = await import("@electric-sql/pglite");
      const persist = (process.env.EMBEDDED_PERSIST ?? "true") !== "false";
      let dataDir: string | undefined;
      if (persist) {
        dataDir = process.env.UPLOADS_DATA_DIR ?? resolveRepoPath("data", "uploads");
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
      return db;
    })().catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

export function sanitizeIdentifier(raw: string, fallback = "col"): string {
  let s = raw
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!s) s = fallback;
  if (/^[0-9]/.test(s)) s = `${fallback}_${s}`;
  return s.slice(0, 60);
}

type ColType = "BOOLEAN" | "BIGINT" | "DOUBLE PRECISION" | "DATE" | "TIMESTAMP" | "TEXT";

const RE_INT = /^-?\d{1,15}$/;
const RE_NUM = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RE_TS = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;
const RE_BOOL = /^(true|false|yes|no)$/i;

/** Infers the narrowest column type that fits every non-empty value. */
export function inferType(values: unknown[]): ColType {
  let int = true;
  let num = true;
  let date = true;
  let ts = true;
  let bool = true;
  let seen = 0;
  for (const raw of values) {
    if (raw === null || raw === undefined || raw === "") continue;
    seen++;
    if (typeof raw === "boolean") {
      int = num = date = ts = false;
      continue;
    }
    if (typeof raw === "number") {
      bool = date = ts = false;
      if (!Number.isInteger(raw)) int = false;
      continue;
    }
    const v = String(raw).trim();
    if (int && !RE_INT.test(v)) int = false;
    if (num && !RE_NUM.test(v)) num = false;
    if (date && !RE_DATE.test(v)) date = false;
    if (ts && !RE_TS.test(v)) ts = false;
    if (bool && !RE_BOOL.test(v)) bool = false;
    if (!int && !num && !date && !ts && !bool) return "TEXT";
  }
  if (!seen) return "TEXT";
  if (bool) return "BOOLEAN";
  if (int) return "BIGINT";
  if (num) return "DOUBLE PRECISION";
  if (date) return "DATE";
  if (ts) return "TIMESTAMP";
  return "TEXT";
}

function literal(v: unknown, t: ColType): string {
  if (v === null || v === undefined || v === "") return "NULL";
  if (t === "BOOLEAN") return /^(true|yes)$/i.test(String(v)) || v === true ? "TRUE" : "FALSE";
  if (t === "BIGINT" || t === "DOUBLE PRECISION") {
    const n = Number(v);
    return Number.isFinite(n) ? String(n) : "NULL";
  }
  return `'${String(v).replace(/'/g, "''")}'`;
}

export type ParsedTable = { columns: string[]; rows: unknown[][] };

export function parseUpload(filename: string, content: string): ParsedTable {
  const trimmed = content.trimStart();
  if (/\.json$/i.test(filename) || trimmed.startsWith("[") || trimmed.startsWith("{")) {
    let data = JSON.parse(content) as unknown;
    if (!Array.isArray(data) && data && typeof data === "object") {
      // Accept { "rows": [...] } or the first array-valued property.
      const arr = Object.values(data as Record<string, unknown>).find(Array.isArray);
      data = arr ?? [data];
    }
    const records = (data as Record<string, unknown>[]).filter((r) => r && typeof r === "object");
    const columns = [...new Set(records.flatMap((r) => Object.keys(r)))];
    return {
      columns,
      rows: records.map((r) => columns.map((c) => (typeof r[c] === "object" && r[c] !== null ? JSON.stringify(r[c]) : r[c])))
    };
  }
  const parsed = Papa.parse<string[]>(content, { skipEmptyLines: true });
  if (parsed.errors.length && !parsed.data.length) throw new Error(parsed.errors[0].message);
  const [header, ...rows] = parsed.data;
  if (!header?.length) throw new Error("The file has no header row");
  return { columns: header, rows };
}

export async function loadTable(
  rawName: string,
  table: ParsedTable
): Promise<{ table: string; rows: number; columns: { name: string; type: string }[] }> {
  if (table.rows.length > MAX_ROWS) throw new Error(`File has ${table.rows.length} rows; the limit is ${MAX_ROWS}`);
  const name = sanitizeIdentifier(rawName.replace(/\.[a-z0-9]+$/i, ""), "t");
  const used = new Set<string>();
  const cols = table.columns.map((c, i) => {
    let n = sanitizeIdentifier(c || `column_${i + 1}`, "c");
    while (used.has(n)) n = `${n}_${i + 1}`;
    used.add(n);
    return n;
  });
  const types = cols.map((_, i) => inferType(table.rows.map((r) => r[i])));
  const db = await getFilesDb();
  await db.exec("BEGIN");
  try {
    await db.exec(`DROP TABLE IF EXISTS "${name}" CASCADE`);
    await db.exec(`CREATE TABLE "${name}" (${cols.map((c, i) => `"${c}" ${types[i]}`).join(", ")})`);
    for (let i = 0; i < table.rows.length; i += 1000) {
      const chunk = table.rows.slice(i, i + 1000);
      const values = chunk.map((r) => `(${cols.map((_, ci) => literal(r[ci], types[ci])).join(",")})`).join(",");
      await db.exec(`INSERT INTO "${name}" VALUES ${values}`);
    }
    await db.exec("COMMIT");
  } catch (err) {
    await db.exec("ROLLBACK").catch(() => undefined);
    throw err;
  }
  await db.exec(`ANALYZE "${name}"`);
  return { table: name, rows: table.rows.length, columns: cols.map((c, i) => ({ name: c, type: types[i].toLowerCase() })) };
}

export async function dropTable(name: string): Promise<void> {
  const db = await getFilesDb();
  await db.exec(`DROP TABLE IF EXISTS "${sanitizeIdentifier(name, "t")}" CASCADE`);
}
