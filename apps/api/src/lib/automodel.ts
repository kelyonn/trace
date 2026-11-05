/**
 * Automatic semantic model.
 *
 * Given any connected source, infer a star/snowflake model:
 *  - fact table: the table with the most outbound foreign keys, numeric
 *    measures and rows (overridable);
 *  - joins: follow foreign keys out of the fact table, two hops deep;
 *  - dimensions: low/medium-cardinality text, boolean and small-integer
 *    columns, plus year → quarter → month for every date column;
 *  - drill paths: within a table, dimensions ordered by cardinality
 *    (e.g. region → industry → customer);
 *  - measures: row count, SUM/AVG of numeric fact columns, distinct counts
 *    of joined entities.
 * All SQL is generated through the source's dialect.
 */
import type { Connector, Dialect, TableInfo } from "./connectors/types.js";

export type Grain = "year" | "quarter" | "month";

export type ModelDimension = {
  key: string;
  label: string;
  group: string;
  groupLabel: string;
  table: string;
  alias: string;
  column: string;
  kind: "category" | "time";
  grain?: Grain;
  cardinality: number | null;
  /** Next (finer) dimension in this dimension's drill path. */
  next: string | null;
  /** Derived from a numeric column (e.g. a small integer code). */
  numeric?: boolean;
  sql: string;
};

export type ModelMeasure = {
  key: string;
  label: string;
  format: "money" | "number";
  /** Currency symbol for money measures, inferred from the column name (e.g. *_eur → €). */
  currency?: string;
  sql: string;
  aliases: string[];
};

export type ModelJoin = { table: string; alias: string; parent: string; on: string };

export type AutoModel = {
  sourceId: string;
  dialect: Dialect["name"];
  fact: { table: string; alias: string; rowCount: number | null };
  factCandidates: { table: string; rowCount: number | null; score: number }[];
  joins: ModelJoin[];
  dimensions: ModelDimension[];
  measures: ModelMeasure[];
  defaults: { x: string; y: string; z: string; measure: string };
  hiddenColumns: string[];
  tableCount: number;
  generatedAt: string;
};

const MONEY_RE = /amount|revenue|price|cost|sales|total|value|spend|fare|fee|salary|income|profit|budget|payment/i;
const KEY_RE = /(^id$|_id$|^uuid$|_uuid$|_key$|^pk$)/i;
const DATE_NAME_RE = /(date|time|_at$|_on$|day|month|period|timestamp)/i;
const RE_ISO = /^\d{4}-\d{2}-\d{2}/;
/** Columns whose name says little on its own; they take their table's name ("cities.name" → "City"). */
const GENERIC_NAME_RE = /^(name|title|label|display_name|full_name)$/i;
const GENERIC_RE = /^(code|type|kind|description|category|status)$/i;

export const titleCase = (s: string) =>
  s
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());

const CURRENCIES: [RegExp, string][] = [
  [/(^|_)(eur|euro)s?(_|$)/i, "€"],
  [/(^|_)(gbp|pound)s?(_|$)/i, "£"],
  [/(^|_)(jpy|yen)(_|$)/i, "¥"],
  [/(^|_)(inr|rupee)s?(_|$)/i, "₹"],
  [/(^|_)(chf)(_|$)/i, "CHF "]
];
const currencyOf = (col: string) => CURRENCIES.find(([re]) => re.test(col))?.[1] ?? "$";

const singular = (s: string) => s.replace(/ies$/i, "y").replace(/(ses|xes)$/i, (m) => m.slice(0, -2)).replace(/s$/i, "");

function factScore(t: TableInfo, inbound: number): number {
  const keys = new Set([...t.primaryKey, ...t.foreignKeys.map((f) => f.column)]);
  const numeric = t.columns.filter((c) => c.kind === "number" && !keys.has(c.name) && !KEY_RE.test(c.name)).length;
  const dates = t.columns.filter((c) => c.kind === "date").length;
  return t.foreignKeys.length * 4 + numeric * 1.5 + dates + Math.log10((t.rowCount ?? 0) + 1) - inbound * 0.5;
}

type Candidate = {
  table: TableInfo;
  alias: string;
  column: string;
  kind: "text" | "number" | "boolean" | "date" | "datetext";
};

/** Profiles candidate columns of one table with a single sampled query. */
async function profile(
  connector: Connector,
  table: TableInfo,
  columns: { name: string; kind: string }[]
): Promise<Map<string, { distinct: number | null; avgLen: number | null; sample: unknown }>> {
  const out = new Map<string, { distinct: number | null; avgLen: number | null; sample: unknown }>();
  if (!columns.length) return out;
  const d = connector.dialect;
  const sampleSize = Number(process.env.PROFILE_SAMPLE_ROWS ?? "50000");
  const parts: string[] = [];
  columns.forEach((c, i) => {
    const q = d.quote(c.name);
    parts.push(`COUNT(DISTINCT s.${q}) AS d${i}`);
    parts.push(c.kind === "text" ? `AVG(LENGTH(s.${q})) AS l${i}` : `NULL AS l${i}`);
    parts.push(c.kind === "text" ? `MIN(s.${q}) AS m${i}` : `NULL AS m${i}`);
  });
  const inner = d.sample(table.name, columns.map((c) => d.quote(c.name)), sampleSize);
  try {
    const res = await connector.query(`SELECT ${parts.join(", ")} FROM (${inner}) s`, 1);
    const row = res.rows[0] ?? [];
    columns.forEach((c, i) => {
      const dv = row[i * 3];
      const lv = row[i * 3 + 1];
      out.set(c.name, {
        distinct: dv === null || dv === undefined ? null : Number(dv),
        avgLen: lv === null || lv === undefined ? null : Number(lv),
        sample: row[i * 3 + 2]
      });
    });
  } catch {
    columns.forEach((c) => out.set(c.name, { distinct: null, avgLen: null, sample: null }));
  }
  return out;
}

export async function buildModel(
  sourceId: string,
  connector: Connector,
  opts: { fact?: string; hiddenColumns?: string[]; tables?: TableInfo[] } = {}
): Promise<AutoModel> {
  const d = connector.dialect;
  const tables = opts.tables ?? (await connector.introspect());
  if (!tables.length) throw new Error("This source has no tables yet. Upload a file or point it at a schema with data.");
  const byName = new Map(tables.map((t) => [t.name, t]));

  const inbound = new Map<string, number>();
  for (const t of tables) for (const fk of t.foreignKeys) inbound.set(fk.refTable, (inbound.get(fk.refTable) ?? 0) + 1);
  const factCandidates = tables
    .map((t) => ({ table: t.name, rowCount: t.rowCount, score: Number(factScore(t, inbound.get(t.name) ?? 0).toFixed(2)) }))
    .sort((a, b) => b.score - a.score);
  const factName = opts.fact && byName.has(opts.fact) ? opts.fact : factCandidates[0].table;
  const fact = byName.get(factName)!;

  // Snowflake joins: follow FKs out of the fact table, two hops deep.
  const joins: ModelJoin[] = [];
  const aliasOf = new Map<string, string>([[fact.name, "f"]]);
  const frontier: { table: TableInfo; alias: string; depth: number }[] = [{ table: fact, alias: "f", depth: 0 }];
  let n = 1;
  while (frontier.length) {
    const { table, alias, depth } = frontier.shift()!;
    if (depth >= 2) continue;
    for (const fk of table.foreignKeys) {
      const target = byName.get(fk.refTable);
      if (!target || aliasOf.has(target.name)) continue;
      const a = `t${n++}`;
      aliasOf.set(target.name, a);
      joins.push({
        table: target.name,
        alias: a,
        parent: alias,
        on: `${a}.${d.quote(fk.refColumn)} = ${alias}.${d.quote(fk.column)}`
      });
      frontier.push({ table: target, alias: a, depth: depth + 1 });
    }
  }

  const hidden = new Set((opts.hiddenColumns ?? []).map((c) => c.toLowerCase()));
  const hiddenColumns: string[] = [];

  // Candidate dimension columns per table.
  const candidates: Candidate[] = [];
  for (const [tableName, alias] of aliasOf) {
    const t = byName.get(tableName)!;
    const keys = new Set([...t.primaryKey, ...t.foreignKeys.map((f) => f.column)]);
    for (const c of t.columns) {
      if (keys.has(c.name) || KEY_RE.test(c.name)) continue;
      if (hidden.has(c.name.toLowerCase()) || hidden.has(`${tableName}.${c.name}`.toLowerCase())) {
        hiddenColumns.push(`${tableName}.${c.name}`);
        continue;
      }
      if (c.kind === "date") candidates.push({ table: t, alias, column: c.name, kind: "date" });
      else if (c.kind === "text") candidates.push({ table: t, alias, column: c.name, kind: DATE_NAME_RE.test(c.name) ? "datetext" : "text" });
      else if (c.kind === "boolean") candidates.push({ table: t, alias, column: c.name, kind: "boolean" });
      else if (c.kind === "number" && t === fact) candidates.push({ table: t, alias, column: c.name, kind: "number" });
      else if (c.kind === "number" && !MONEY_RE.test(c.name)) candidates.push({ table: t, alias, column: c.name, kind: "number" });
    }
  }

  // Profile cardinality / text length per table (one sampled query each).
  const stats = new Map<string, { distinct: number | null; avgLen: number | null; sample: unknown }>();
  await Promise.all(
    [...aliasOf.keys()].map(async (tableName) => {
      const t = byName.get(tableName)!;
      const cols = candidates.filter((c) => c.table === t && c.kind !== "date").map((c) => ({ name: c.column, kind: c.kind === "datetext" ? "text" : c.kind }));
      const res = await profile(connector, t, cols);
      for (const [col, s] of res) stats.set(`${tableName}.${col}`, s);
    })
  );

  const factLabel = titleCase(fact.name);
  const groupLabelOf = (t: TableInfo) => titleCase(t === fact ? fact.name : singular(t.name));
  const colRef = (alias: string, col: string) => `${alias}.${d.quote(col)}`;
  const dimensions: ModelDimension[] = [];

  // Category dimensions.
  const categoryByTable = new Map<string, ModelDimension[]>();
  for (const c of candidates) {
    const s = stats.get(`${c.table.name}.${c.column}`);
    let kind = c.kind;
    if (kind === "datetext" && typeof s?.sample === "string" && RE_ISO.test(s.sample)) kind = "date";
    if (kind === "date") continue;
    const distinct = s?.distinct ?? null;
    if (distinct !== null && distinct < 2) continue;
    if (kind === "number" && (distinct === null || distinct > 24 || MONEY_RE.test(c.column))) continue;
    if (kind !== "number" && distinct !== null && distinct > 200000) continue;
    if ((s?.avgLen ?? 0) > 80) continue; // free text, not a dimension
    const tableWord = titleCase(singular(c.table.name));
    const dim: ModelDimension = {
      key: `${c.table.name}.${c.column}`,
      label:
        GENERIC_NAME_RE.test(c.column) && c.table !== fact
          ? tableWord
          : GENERIC_RE.test(c.column) && c.table !== fact && !c.table.name.toLowerCase().includes(c.column.toLowerCase())
            ? `${tableWord} ${titleCase(c.column)}`
            : titleCase(c.column),
      group: c.table.name,
      groupLabel: groupLabelOf(c.table),
      table: c.table.name,
      alias: c.alias,
      column: c.column,
      kind: "category",
      cardinality: distinct,
      next: null,
      numeric: kind === "number",
      sql: d.label(colRef(c.alias, c.column))
    };
    const list = categoryByTable.get(c.table.name) ?? [];
    list.push(dim);
    categoryByTable.set(c.table.name, list);
  }
  for (const list of categoryByTable.values()) {
    // Coarse → fine; on ties, entity names (name/title) come last as the leaf.
    list.sort(
      (a, b) =>
        (a.cardinality ?? 1e9) - (b.cardinality ?? 1e9) ||
        Number(GENERIC_NAME_RE.test(a.column)) - Number(GENERIC_NAME_RE.test(b.column))
    );
    list.forEach((dim, i) => (dim.next = list[i + 1]?.key ?? null));
    dimensions.push(...list);
  }

  // Time dimensions: year → quarter → month per date column.
  for (const c of candidates) {
    const s = stats.get(`${c.table.name}.${c.column}`);
    const isDate = c.kind === "date" || (c.kind === "datetext" && typeof s?.sample === "string" && RE_ISO.test(s.sample));
    if (!isDate) continue;
    const ref = colRef(c.alias, c.column);
    const base = `${c.table.name}.${c.column}`;
    const grains: Grain[] = ["year", "quarter", "month"];
    grains.forEach((g, i) => {
      dimensions.push({
        key: `${base}:${g}`,
        label: `${titleCase(c.column)} · ${titleCase(g)}`,
        group: `${base}:time`,
        groupLabel: `${titleCase(c.column)} (time)`,
        table: c.table.name,
        alias: c.alias,
        column: c.column,
        kind: "time",
        grain: g,
        cardinality: null,
        next: i < grains.length - 1 ? `${base}:${grains[i + 1]}` : null,
        sql: d.label(g === "year" ? d.year(ref) : g === "quarter" ? d.quarter(ref) : d.month(ref))
      });
    });
  }

  // Disambiguate duplicate labels across tables.
  const labelCount = new Map<string, number>();
  dimensions.forEach((x) => labelCount.set(x.label, (labelCount.get(x.label) ?? 0) + 1));
  dimensions.forEach((x) => {
    if ((labelCount.get(x.label) ?? 0) > 1) x.label = `${titleCase(singular(x.table))} ${x.label}`;
  });

  // Measures.
  const measures: ModelMeasure[] = [];
  const factKeys = new Set([...fact.primaryKey, ...fact.foreignKeys.map((f) => f.column)]);
  const numericFact = fact.columns.filter((c) => c.kind === "number" && !factKeys.has(c.name) && !KEY_RE.test(c.name));
  const moneyFirst = [...numericFact].sort((a, b) => Number(MONEY_RE.test(b.name)) - Number(MONEY_RE.test(a.name)));
  for (const c of moneyFirst) {
    measures.push({
      key: `sum:${c.name}`,
      label: /^total/i.test(c.name) ? titleCase(c.name) : `Total ${titleCase(c.name)}`,
      format: MONEY_RE.test(c.name) || currencyOf(c.name) !== "$" ? "money" : "number",
      currency: currencyOf(c.name),
      sql: `SUM(${colRef("f", c.name)})`,
      aliases: ["f"]
    });
  }
  measures.push({ key: "count", label: `${factLabel} (rows)`, format: "number", sql: "COUNT(*)", aliases: ["f"] });
  for (const j of joins) {
    const t = byName.get(j.table)!;
    const pk = t.primaryKey[0];
    if (!pk) continue;
    measures.push({
      key: `distinct:${j.table}`,
      label: `Distinct ${titleCase(j.table)}`,
      format: "number",
      sql: `COUNT(DISTINCT ${colRef(j.alias, pk)})`,
      aliases: [j.alias]
    });
  }
  for (const c of moneyFirst) {
    measures.push({
      key: `avg:${c.name}`,
      label: `Average ${titleCase(c.name)}`,
      format: MONEY_RE.test(c.name) || currencyOf(c.name) !== "$" ? "money" : "number",
      currency: currencyOf(c.name),
      sql: `AVG(${colRef("f", c.name)})`,
      aliases: ["f"]
    });
  }

  // Constant dimension so a cube always has three axes.
  dimensions.push({
    key: "__all",
    label: "All",
    group: "__all",
    groupLabel: "Total",
    table: fact.name,
    alias: "f",
    column: "",
    kind: "category",
    cardinality: 1,
    next: null,
    sql: "'All'"
  });

  return {
    sourceId,
    dialect: d.name,
    fact: { table: fact.name, alias: "f", rowCount: fact.rowCount },
    factCandidates,
    joins,
    dimensions,
    measures,
    defaults: chooseDefaults(dimensions, measures),
    hiddenColumns,
    tableCount: tables.length,
    generatedAt: new Date().toISOString()
  };
}

/** Pick three axes from different groups with readable cardinality, and a headline measure. */
export function chooseDefaults(dims: ModelDimension[], measures: ModelMeasure[]) {
  const roots = dims.filter((x) => x.key !== "__all" && (x.kind === "time" ? x.grain === "year" : true));
  const score = (x: ModelDimension) => {
    if (x.kind === "time") return 5;
    const c = x.cardinality ?? 50;
    if (c < 2) return -10;
    return 10 - Math.abs(Math.log2(c / 7)) * 2 - (x.numeric ? 4 : 0);
  };
  const picked: ModelDimension[] = [];
  const usedGroups = new Set<string>();
  const time = roots.find((x) => x.kind === "time");
  for (const x of [...roots].filter((r) => r.kind === "category").sort((a, b) => score(b) - score(a))) {
    if (usedGroups.has(x.group) && roots.some((r) => !usedGroups.has(r.group) && r.kind === "category" && score(r) > 0)) continue;
    if (picked.some((p) => p.key === x.key)) continue;
    picked.push(x);
    usedGroups.add(x.group);
    if (picked.length === (time ? 2 : 3)) break;
  }
  if (time) picked.push(time);
  while (picked.length < 3) picked.push(dims.find((x) => x.key === "__all")!);
  return { x: picked[0].key, y: picked[1].key, z: picked[2].key, measure: measures[0]?.key ?? "count" };
}

// ---------------------------------------------------------------------------
// SQL generation
// ---------------------------------------------------------------------------

export type Filter = { dim: string; value: string };

export type AggregateRequest = {
  dims: string[];
  measures: string[];
  filters?: Filter[];
  order?: { by: "measure" | "dim"; index?: number; dir?: "asc" | "desc" };
  limit?: number;
};

const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;

export function buildAggregateSql(model: AutoModel, req: AggregateRequest, dialect: Dialect): string {
  const dimMap = new Map(model.dimensions.map((x) => [x.key, x]));
  const measureMap = new Map(model.measures.map((m) => [m.key, m]));
  const dims = req.dims.map((k) => {
    const x = dimMap.get(k);
    if (!x) throw new Error(`Unknown dimension: ${k}`);
    return x;
  });
  const measures = req.measures.map((k) => {
    const m = measureMap.get(k);
    if (!m) throw new Error(`Unknown measure: ${k}`);
    return m;
  });
  const filters = (req.filters ?? []).map((f) => {
    const x = dimMap.get(f.dim);
    if (!x) throw new Error(`Unknown filter dimension: ${f.dim}`);
    return { dim: x, value: f.value };
  });

  // Only join what the query needs (plus each join's parents).
  const needed = new Set<string>();
  const joinByAlias = new Map(model.joins.map((j) => [j.alias, j]));
  const need = (alias: string) => {
    while (alias !== "f" && !needed.has(alias)) {
      needed.add(alias);
      alias = joinByAlias.get(alias)?.parent ?? "f";
    }
  };
  dims.forEach((x) => need(x.alias));
  filters.forEach((f) => need(f.dim.alias));
  measures.forEach((m) => m.aliases.forEach(need));

  const select = [
    ...dims.map((x, i) => `${x.sql} AS ${dialect.quote(`d${i}`)}`),
    ...measures.map((m, i) => `${m.sql} AS ${dialect.quote(`m${i}`)}`)
  ];
  const lines = [
    `SELECT ${select.join(", ")}`,
    `FROM ${dialect.quote(model.fact.table)} f`,
    ...model.joins.filter((j) => needed.has(j.alias)).map((j) => `LEFT JOIN ${dialect.quote(j.table)} ${j.alias} ON ${j.on}`)
  ];
  if (filters.length) lines.push(`WHERE ${filters.map((f) => `${f.dim.sql} = ${lit(f.value)}`).join("\n  AND ")}`);
  if (dims.length) lines.push(`GROUP BY ${dims.map((_, i) => i + 1).join(", ")}`);
  if (req.order) {
    const idx = req.order.by === "measure" ? dims.length + (req.order.index ?? 0) + 1 : (req.order.index ?? 0) + 1;
    lines.push(`ORDER BY ${idx} ${req.order.dir === "asc" ? "ASC" : "DESC"}`);
  }
  if (req.limit) lines.push(`LIMIT ${Math.max(1, Math.min(100000, Math.floor(req.limit)))}`);
  return lines.join("\n");
}
