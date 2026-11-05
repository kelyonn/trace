/**
 * Three-axis OLAP model for the Cube Explorer.
 *
 * Each axis is bound to a hierarchy (Customer, Product, Time, Status) at some
 * depth, with a drill path pinning the members above that depth. The server
 * query groups by the three current levels; slice and dice are applied
 * client-side so they respond instantly.
 */
import { dim, measure as getMeasure, type DimensionKey, type MeasureKey } from "./model";

export type AxisKey = "x" | "y" | "z";
export const AXES: AxisKey[] = ["x", "y", "z"];

export type HierarchyKey = "customer" | "product" | "time" | "status";

export const HIERARCHIES: Record<HierarchyKey, { label: string; levels: DimensionKey[]; ordered?: boolean }> = {
  customer: { label: "Customer", levels: ["region", "industry", "customer"] },
  product: { label: "Product", levels: ["category", "sku"] },
  time: { label: "Time", levels: ["year", "quarter", "month"], ordered: true },
  status: { label: "Order status", levels: ["status"] }
};

export type AxisState = { hier: HierarchyKey; depth: number; path: string[] };

export type OlapState = {
  x: AxisState;
  y: AxisState;
  z: AxisState;
  measure: MeasureKey;
};

export const DEFAULT_OLAP: OlapState = {
  x: { hier: "product", depth: 0, path: [] },
  y: { hier: "customer", depth: 0, path: [] },
  z: { hier: "time", depth: 0, path: [] },
  measure: "revenue"
};

export const levelOf = (a: AxisState): DimensionKey => HIERARCHIES[a.hier].levels[a.depth];
export const canDrill = (a: AxisState) => a.depth < HIERARCHIES[a.hier].levels.length - 1;
export const canRollUp = (a: AxisState) => a.depth > 0;

const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;

export function buildOlapSql(s: OlapState): string {
  const m = getMeasure(s.measure);
  const where: string[] = [];
  for (const k of AXES) {
    const a = s[k];
    a.path.forEach((value, i) => where.push(`${dim(HIERARCHIES[a.hier].levels[i]).sql} = ${lit(value)}`));
  }
  const [x, y, z] = AXES.map((k) => dim(levelOf(s[k])));
  return [
    `SELECT ${x.sql} AS x_${x.key}, ${y.sql} AS y_${y.key}, ${z.sql} AS z_${z.key}, ${m.sql} AS ${m.key}`,
    "FROM order_lines ol",
    "JOIN orders o ON o.id = ol.order_id",
    "JOIN customers c ON c.id = o.customer_id",
    "JOIN products p ON p.id = ol.product_id",
    where.length ? `WHERE ${where.join("\n  AND ")}` : null,
    "GROUP BY 1, 2, 3"
  ]
    .filter(Boolean)
    .join("\n");
}

/** Drill one axis into a member: pin it on the path and step one level down. */
export function drillAxis(s: OlapState, axis: AxisKey, member: string): OlapState {
  const a = s[axis];
  if (!canDrill(a)) return s;
  return { ...s, [axis]: { ...a, depth: a.depth + 1, path: [...a.path, member] } };
}

export function rollUpAxis(s: OlapState, axis: AxisKey): OlapState {
  const a = s[axis];
  if (!canRollUp(a)) return s;
  return { ...s, [axis]: { ...a, depth: a.depth - 1, path: a.path.slice(0, -1) } };
}

/** Rotate axis bindings x→y→z→x (the classic "pivot"). */
export function pivotAxes(s: OlapState): OlapState {
  return { ...s, x: s.z, y: s.x, z: s.y };
}

export function swapAxes(s: OlapState, a: AxisKey, b: AxisKey): OlapState {
  return { ...s, [a]: s[b], [b]: s[a] };
}

/** Bind a hierarchy to an axis; if another axis holds it, the two swap. */
export function assignHierarchy(s: OlapState, axis: AxisKey, hier: HierarchyKey): OlapState {
  const holder = AXES.find((k) => s[k].hier === hier);
  if (holder === axis) return s;
  if (holder) return swapAxes(s, axis, holder);
  return { ...s, [axis]: { hier, depth: 0, path: [] } };
}

export const unusedHierarchy = (s: OlapState): HierarchyKey | undefined =>
  (Object.keys(HIERARCHIES) as HierarchyKey[]).find((h) => !AXES.some((k) => s[k].hier === h));

// ---------------------------------------------------------------------------
// Grid construction
// ---------------------------------------------------------------------------

export const OTHER = "Other";

export type Member = { key: string; label: string; total: number; merged?: number };

export type CubeGrid = {
  members: Record<AxisKey, Member[]>;
  /** values[x][y][z]; null = no data at that coordinate */
  values: (number | null)[][][];
  min: number;
  max: number;
  total: number;
  cellCount: number;
};

export function buildGrid(rows: unknown[][], ordered: Record<AxisKey, boolean>, cap = 12): CubeGrid {
  const totals: Record<AxisKey, Map<string, number>> = { x: new Map(), y: new Map(), z: new Map() };
  for (const r of rows) {
    const v = Number(r[3]) || 0;
    AXES.forEach((k, i) => {
      const key = String(r[i] ?? "∅");
      totals[k].set(key, (totals[k].get(key) ?? 0) + v);
    });
  }

  const members = {} as Record<AxisKey, Member[]>;
  const index = {} as Record<AxisKey, Map<string, number>>;
  for (const k of AXES) {
    const entries = [...totals[k].entries()];
    let kept: [string, number][];
    let rest: [string, number][] = [];
    if (ordered[k]) {
      // Time axes keep chronological order; when capped, keep the most recent members.
      entries.sort((a, b) => a[0].localeCompare(b[0]));
      kept = entries.length > cap ? entries.slice(-cap) : entries;
      rest = entries.length > cap ? entries.slice(0, entries.length - cap) : [];
    } else {
      entries.sort((a, b) => b[1] - a[1]);
      kept = entries.length > cap ? entries.slice(0, cap - 1) : entries;
      rest = entries.length > cap ? entries.slice(cap - 1) : [];
    }
    const list: Member[] = kept.map(([key, total]) => ({ key, label: key, total }));
    if (rest.length) {
      const otherTotal = rest.reduce((a, [, t]) => a + t, 0);
      const other: Member = { key: OTHER, label: `${OTHER} (${rest.length})`, total: otherTotal, merged: rest.length };
      if (ordered[k]) list.unshift({ ...other, label: `Earlier (${rest.length})` });
      else list.push(other);
    }
    members[k] = list;
    const idx = new Map<string, number>();
    list.forEach((m, i) => idx.set(m.key, i));
    for (const [key] of rest) idx.set(key, list.findIndex((m) => m.key === OTHER));
    index[k] = idx;
  }

  const values: (number | null)[][][] = members.x.map(() => members.y.map(() => members.z.map(() => null)));
  for (const r of rows) {
    const xi = index.x.get(String(r[0] ?? "∅"))!;
    const yi = index.y.get(String(r[1] ?? "∅"))!;
    const zi = index.z.get(String(r[2] ?? "∅"))!;
    const v = Number(r[3]) || 0;
    values[xi][yi][zi] = (values[xi][yi][zi] ?? 0) + v;
  }

  let min = Infinity;
  let max = -Infinity;
  let total = 0;
  let cellCount = 0;
  for (const plane of values)
    for (const row of plane)
      for (const v of row) {
        if (v === null) continue;
        min = Math.min(min, v);
        max = Math.max(max, v);
        total += v;
        cellCount++;
      }
  if (!Number.isFinite(min)) {
    min = 0;
    max = 0;
  }
  return { members, values, min, max, total, cellCount };
}

/** Sum the cube along one axis (used by the linked pivot table and marginals). */
export function collapse(
  grid: CubeGrid,
  visible: Record<AxisKey, boolean[]>,
  slice: { axis: AxisKey; index: number } | null
): number[][] {
  const { x: X, y: Y, z: Z } = grid.members;
  const out = X.map(() => Y.map(() => 0));
  for (let xi = 0; xi < X.length; xi++)
    for (let yi = 0; yi < Y.length; yi++)
      for (let zi = 0; zi < Z.length; zi++) {
        if (!visible.x[xi] || !visible.y[yi] || !visible.z[zi]) continue;
        if (slice && [xi, yi, zi][AXES.indexOf(slice.axis)] !== slice.index) continue;
        out[xi][yi] += grid.values[xi][yi][zi] ?? 0;
      }
  return out;
}
