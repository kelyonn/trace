/**
 * Cube Studio model: a small star-schema catalog over the demo tables, plus SQL
 * generation that runs unchanged on Trino and Postgres. Drilling into a cell
 * pins both coordinates as filters and steps each axis down its hierarchy.
 */

export type DimensionKey =
  | "region"
  | "industry"
  | "customer"
  | "category"
  | "sku"
  | "status"
  | "year"
  | "quarter"
  | "month";

export type MeasureKey = "revenue" | "orders" | "units" | "avg_order" | "customers";

export type CubeDimension = { key: DimensionKey; label: string; sql: string; group: string; next?: DimensionKey };
export type CubeMeasure = { key: MeasureKey; label: string; sql: string; money?: boolean };

export const DIMENSIONS: CubeDimension[] = [
  { key: "region", label: "Region", sql: "c.region", group: "Customer", next: "industry" },
  { key: "industry", label: "Industry", sql: "c.industry", group: "Customer", next: "customer" },
  { key: "customer", label: "Customer", sql: "c.name", group: "Customer" },
  { key: "category", label: "Category", sql: "p.category", group: "Product", next: "sku" },
  { key: "sku", label: "SKU", sql: "p.sku", group: "Product" },
  { key: "status", label: "Order status", sql: "o.status", group: "Order", next: "region" },
  {
    key: "year",
    label: "Year",
    sql: "CAST(EXTRACT(YEAR FROM o.order_date) AS VARCHAR)",
    group: "Time",
    next: "quarter"
  },
  {
    key: "quarter",
    label: "Quarter",
    sql: "CAST(EXTRACT(YEAR FROM o.order_date) AS VARCHAR) || '-Q' || CAST(EXTRACT(QUARTER FROM o.order_date) AS VARCHAR)",
    group: "Time",
    next: "month"
  },
  { key: "month", label: "Month", sql: "SUBSTR(CAST(o.order_date AS VARCHAR), 1, 7)", group: "Time" }
];

export const MEASURES: CubeMeasure[] = [
  { key: "revenue", label: "Revenue", sql: "SUM(ol.line_amount)", money: true },
  { key: "orders", label: "Orders", sql: "COUNT(DISTINCT o.id)" },
  { key: "units", label: "Units", sql: "SUM(ol.quantity)" },
  {
    key: "avg_order",
    label: "Avg order value",
    sql: "ROUND(SUM(ol.line_amount) / COUNT(DISTINCT o.id), 2)",
    money: true
  },
  { key: "customers", label: "Active customers", sql: "COUNT(DISTINCT o.customer_id)" }
];

export const dim = (k: DimensionKey) => DIMENSIONS.find((d) => d.key === k)!;
export const measure = (k: MeasureKey) => MEASURES.find((m) => m.key === k)!;

export type CubeFilter = { dim: DimensionKey; value: string };

export type CubeState = {
  rows: DimensionKey;
  cols: DimensionKey;
  measure: MeasureKey;
  filters: CubeFilter[];
};

const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;

export function buildCubeSql(state: CubeState, limit = 2000): string {
  const r = dim(state.rows);
  const c = dim(state.cols);
  const m = measure(state.measure);
  const where = state.filters.map((f) => `${dim(f.dim).sql} = ${lit(f.value)}`);
  return [
    `SELECT ${r.sql} AS ${r.key}, ${c.sql} AS ${c.key}, ${m.sql} AS ${m.key}`,
    "FROM order_lines ol",
    "JOIN orders o ON o.id = ol.order_id",
    "JOIN customers c ON c.id = o.customer_id",
    "JOIN products p ON p.id = ol.product_id",
    where.length ? `WHERE ${where.join("\n  AND ")}` : null,
    "GROUP BY 1, 2",
    `ORDER BY 3 DESC`,
    `LIMIT ${limit}`
  ]
    .filter(Boolean)
    .join("\n");
}

/** Next dimension down an axis's hierarchy that isn't already pinned or used by the other axis. */
function stepDown(current: DimensionKey, other: DimensionKey, pinned: Set<DimensionKey>): DimensionKey {
  let k: DimensionKey | undefined = dim(current).next;
  while (k && (pinned.has(k) || k === other)) k = dim(k).next;
  if (k) return k;
  // Hierarchy exhausted: fall back to any free dimension.
  const free = DIMENSIONS.find((d) => d.key !== other && !pinned.has(d.key) && d.key !== current);
  return free?.key ?? current;
}

export function drillInto(state: CubeState, rowValue: string, colValue: string): CubeState {
  const filters = [
    ...state.filters.filter((f) => f.dim !== state.rows && f.dim !== state.cols),
    { dim: state.rows, value: rowValue },
    { dim: state.cols, value: colValue }
  ];
  const pinned = new Set(filters.map((f) => f.dim));
  const rows = stepDown(state.rows, state.cols, pinned);
  const cols = stepDown(state.cols, rows, pinned);
  return { ...state, rows, cols: cols === rows ? state.cols : cols, filters };
}

export const DEFAULT_CUBE: CubeState = { rows: "region", cols: "category", measure: "revenue", filters: [] };
