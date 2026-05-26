import type { Column } from "@trace/shared-types";

export type PivotShape = {
  rowDim: string;
  colDim: string;
  measureName: string;
  rowLabels: string[];
  colLabels: string[];
  /** values[rowIndex][colIndex] */
  values: number[][];
  minValue: number;
  maxValue: number;
  truncated?: boolean;
  totalCells?: number;
};

const MEASURE_NAME_RE = /amount|total|sum|count|revenue|qty|quantity|value|avg|average/i;
const NUMERIC_TYPES = new Set(["integer", "bigint", "smallint", "tinyint", "decimal", "numeric", "double", "real", "float"]);

const MAX_GRID = 25;

function isNumericColumn(col: Column): boolean {
  const t = (col.type ?? "").toLowerCase();
  if (NUMERIC_TYPES.has(t) || t.includes("int") || t.includes("decimal") || t.includes("double") || t.includes("numeric")) {
    return true;
  }
  return MEASURE_NAME_RE.test(col.name);
}

function isLikelyMeasure(col: Column, index: number, columns: Column[]): boolean {
  if (MEASURE_NAME_RE.test(col.name)) return true;
  if (isNumericColumn(col)) {
    const numericCount = columns.filter(isNumericColumn).length;
    if (numericCount === 1) return true;
    return index === columns.length - 1;
  }
  return false;
}

export function canPivot(columns: Column[], rows: unknown[][]): boolean {
  return detectPivot(columns, rows) !== null;
}

/**
 * Infers row/col dimensions and measure, aggregates duplicates, caps grid at 25×25.
 */
export function detectPivot(columns: Column[], rows: unknown[][]): PivotShape | null {
  if (columns.length < 2 || rows.length === 0) return null;

  let measureIdx = -1;
  for (let i = columns.length - 1; i >= 0; i--) {
    if (isLikelyMeasure(columns[i], i, columns)) {
      measureIdx = i;
      break;
    }
  }
  if (measureIdx < 0) {
    for (let i = 0; i < columns.length; i++) {
      if (isNumericColumn(columns[i])) {
        measureIdx = i;
        break;
      }
    }
  }
  if (measureIdx < 0) return null;

  const dimIndices: number[] = [];
  for (let i = 0; i < columns.length; i++) {
    if (i !== measureIdx && !isNumericColumn(columns[i])) {
      dimIndices.push(i);
    }
  }
  if (dimIndices.length === 0) {
    for (let i = 0; i < columns.length; i++) {
      if (i !== measureIdx) dimIndices.push(i);
    }
  }
  if (dimIndices.length < 1) return null;

  const rowIdx = dimIndices[0];
  const colIdx = dimIndices.length > 1 ? dimIndices[1] : dimIndices[0];

  return buildPivot(
    columns[rowIdx]?.name ?? "row",
    columns[colIdx]?.name ?? "col",
    columns[measureIdx]?.name ?? "value",
    rows,
    rowIdx,
    colIdx,
    measureIdx
  );
}

/** @deprecated Use detectPivot — kept for tests and backward compatibility */
export function pivotRows(columns: Column[], rows: unknown[][]): PivotShape | null {
  if (columns.length >= 3) {
    const legacy = buildPivot(
      columns[0]?.name ?? "row",
      columns[1]?.name ?? "col",
      columns[2]?.name ?? "value",
      rows,
      0,
      1,
      2
    );
    if (legacy) return legacy;
  }
  return detectPivot(columns, rows);
}

function buildPivot(
  rowDim: string,
  colDim: string,
  measureName: string,
  rows: unknown[][],
  rowIdx: number,
  colIdx: number,
  measureIdx: number
): PivotShape | null {
  const agg = new Map<string, number>();
  const rowSet = new Map<string, number>();
  const colSet = new Map<string, number>();
  const rowTotals = new Map<string, number>();
  const colTotals = new Map<string, number>();

  for (const row of rows) {
    const r = String(row[rowIdx] ?? "");
    const c = String(row[colIdx] ?? "");
    const v = Number(row[measureIdx]);
    if (!Number.isFinite(v)) continue;

    const key = `${r}\0${c}`;
    agg.set(key, (agg.get(key) ?? 0) + v);
    if (!rowSet.has(r)) rowSet.set(r, rowSet.size);
    if (!colSet.has(c)) colSet.set(c, colSet.size);
    rowTotals.set(r, (rowTotals.get(r) ?? 0) + v);
    colTotals.set(c, (colTotals.get(c) ?? 0) + v);
  }

  if (agg.size === 0) return null;

  let rowLabels = [...rowSet.keys()];
  let colLabels = [...colSet.keys()];
  const totalCells = rowLabels.length * colLabels.length;
  let truncated = false;

  if (rowLabels.length > MAX_GRID || colLabels.length > MAX_GRID) {
    truncated = true;
    rowLabels = rowLabels
      .sort((a, b) => (rowTotals.get(b) ?? 0) - (rowTotals.get(a) ?? 0))
      .slice(0, MAX_GRID);
    colLabels = colLabels
      .sort((a, b) => (colTotals.get(b) ?? 0) - (colTotals.get(a) ?? 0))
      .slice(0, MAX_GRID);
  }

  const rowIndex = new Map(rowLabels.map((l, i) => [l, i]));
  const colIndex = new Map(colLabels.map((l, i) => [l, i]));
  const matrix: number[][] = rowLabels.map(() => new Array(colLabels.length).fill(0));

  let minValue = Infinity;
  let maxValue = -Infinity;

  for (const [key, v] of agg) {
    const [r, c] = key.split("\0");
    const ri = rowIndex.get(r);
    const ci = colIndex.get(c);
    if (ri === undefined || ci === undefined) continue;
    matrix[ri][ci] = v;
    if (v < minValue) minValue = v;
    if (v > maxValue) maxValue = v;
  }

  if (!Number.isFinite(minValue)) minValue = 0;
  if (!Number.isFinite(maxValue)) maxValue = 0;

  return {
    rowDim,
    colDim,
    measureName,
    rowLabels,
    colLabels,
    values: matrix,
    minValue,
    maxValue,
    truncated,
    totalCells
  };
}
