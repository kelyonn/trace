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
};

/**
 * Converts a flat 3-column QueryResponse into a pivot table.
 * Expects the query to return: [rowDimension, colDimension, measureValue].
 * Returns null if the shape doesn't match.
 */
export function pivotRows(
  columns: Column[],
  rows: unknown[][]
): PivotShape | null {
  if (columns.length < 3 || rows.length === 0) return null;

  const [rowCol, colCol, measureCol] = columns;
  const rowDim = rowCol?.name ?? "row";
  const colDim = colCol?.name ?? "col";
  const measureName = measureCol?.name ?? "value";

  // Collect unique labels preserving insertion order
  const rowSet = new Map<string, number>();
  const colSet = new Map<string, number>();

  for (const row of rows) {
    const r = String(row[0] ?? "");
    const c = String(row[1] ?? "");
    if (!rowSet.has(r)) rowSet.set(r, rowSet.size);
    if (!colSet.has(c)) colSet.set(c, colSet.size);
  }

  const rowLabels = [...rowSet.keys()];
  const colLabels = [...colSet.keys()];
  const matrix: number[][] = rowLabels.map(() => new Array(colLabels.length).fill(0));

  let minValue = Infinity;
  let maxValue = -Infinity;

  for (const row of rows) {
    const r = String(row[0] ?? "");
    const c = String(row[1] ?? "");
    const v = Number(row[2]);
    const ri = rowSet.get(r) ?? 0;
    const ci = colSet.get(c) ?? 0;
    if (Number.isFinite(v)) {
      matrix[ri][ci] = v;
      if (v < minValue) minValue = v;
      if (v > maxValue) maxValue = v;
    }
  }

  if (!Number.isFinite(minValue)) minValue = 0;
  if (!Number.isFinite(maxValue)) maxValue = 0;

  return { rowDim, colDim, measureName, rowLabels, colLabels, values: matrix, minValue, maxValue };
}
