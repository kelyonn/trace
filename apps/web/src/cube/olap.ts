/**
 * Three-axis OLAP state over the automatic semantic model.
 *
 * Each axis is bound to a model dimension plus the drill path that led there
 * (pinned members of coarser dimensions). The server groups by the three
 * current dimensions; slice and dice are applied client-side so they respond
 * instantly.
 */
import type { AggregateRequest, AutoModel, Filter } from "../lib/model";

export type AxisKey = "x" | "y" | "z";
export const AXES: AxisKey[] = ["x", "y", "z"];

export type AxisState = { dim: string; pins: Filter[] };

export type OlapState = { x: AxisState; y: AxisState; z: AxisState; measure: string; fact?: string };

export function olapFromModel(model: AutoModel): OlapState {
  return {
    x: { dim: model.defaults.x, pins: [] },
    y: { dim: model.defaults.y, pins: [] },
    z: { dim: model.defaults.z, pins: [] },
    measure: model.defaults.measure,
    fact: model.fact.table
  };
}

/** True when every axis and the measure still exist in the model (e.g. after a source swap). */
export function isValidFor(s: OlapState, model: AutoModel): boolean {
  const dims = new Set(model.dimensions.map((d) => d.key));
  return (
    model.measures.some((m) => m.key === s.measure) &&
    AXES.every((k) => dims.has(s[k].dim) && s[k].pins.every((p) => dims.has(p.dim)))
  );
}

const nextOf = (model: AutoModel, dim: string) => model.dimensions.find((d) => d.key === dim)?.next ?? null;

export const canDrill = (model: AutoModel, a: AxisState) => !!nextOf(model, a.dim);
export const canRollUp = (a: AxisState) => a.pins.length > 0;

/** Drill one axis into a member: pin it and step to the next (finer) dimension. */
export function drillAxis(s: OlapState, model: AutoModel, axis: AxisKey, member: string): OlapState {
  const a = s[axis];
  const next = nextOf(model, a.dim);
  if (!next) return s;
  return { ...s, [axis]: { dim: next, pins: [...a.pins, { dim: a.dim, value: member }] } };
}

export function rollUpAxis(s: OlapState, axis: AxisKey): OlapState {
  const a = s[axis];
  const last = a.pins[a.pins.length - 1];
  if (!last) return s;
  return { ...s, [axis]: { dim: last.dim, pins: a.pins.slice(0, -1) } };
}

/** Rotate axis bindings x→y→z→x (the classic "pivot"). */
export function pivotAxes(s: OlapState): OlapState {
  return { ...s, x: s.z, y: s.x, z: s.y };
}

/** Bind a dimension to an axis; if another axis shows it, the two swap. */
export function setAxisDim(s: OlapState, axis: AxisKey, dim: string): OlapState {
  const holder = AXES.find((k) => k !== axis && s[k].dim === dim && dim !== "__all");
  if (holder) return { ...s, [axis]: s[holder], [holder]: s[axis] };
  return { ...s, [axis]: { dim, pins: [] } };
}

export function olapRequest(s: OlapState): AggregateRequest {
  return {
    dims: [s.x.dim, s.y.dim, s.z.dim],
    measures: [s.measure],
    filters: [...s.x.pins, ...s.y.pins, ...s.z.pins],
    fact: s.fact
  };
}

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
