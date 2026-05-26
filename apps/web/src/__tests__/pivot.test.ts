import { describe, it, expect } from "vitest";
import { detectPivot, pivotRows, canPivot } from "../cube/pivot";

const columns = [
  { name: "status", type: "varchar" },
  { name: "region", type: "varchar" },
  { name: "total_amount", type: "numeric" }
];

const rows = [
  ["shipped", "North America", 12000],
  ["shipped", "Europe", 15000],
  ["pending", "North America", 8400],
  ["pending", "APAC", 6200],
  ["cancelled", "APAC", 0]
];

describe("pivotRows / detectPivot", () => {
  it("returns null for insufficient columns", () => {
    expect(pivotRows([{ name: "a", type: "varchar" }], [[1, 2]])).toBeNull();
    expect(detectPivot([{ name: "a", type: "varchar" }], [[1]])).toBeNull();
  });

  it("returns null for empty rows", () => {
    expect(pivotRows(columns, [])).toBeNull();
  });

  it("produces correct row and column labels", () => {
    const pivot = pivotRows(columns, rows);
    expect(pivot).not.toBeNull();
    expect(pivot!.rowLabels).toEqual(["shipped", "pending", "cancelled"]);
    expect(pivot!.colLabels).toContain("North America");
    expect(pivot!.colLabels).toContain("Europe");
    expect(pivot!.colLabels).toContain("APAC");
  });

  it("places values correctly in the matrix", () => {
    const pivot = pivotRows(columns, rows)!;
    const shippedIdx = pivot.rowLabels.indexOf("shipped");
    const naIdx = pivot.colLabels.indexOf("North America");
    expect(pivot.values[shippedIdx][naIdx]).toBe(12000);
  });

  it("computes min and max values", () => {
    const pivot = pivotRows(columns, rows)!;
    expect(pivot.minValue).toBe(0);
    expect(pivot.maxValue).toBe(15000);
  });

  it("sets dimension and measure names from column headers", () => {
    const pivot = pivotRows(columns, rows)!;
    expect(pivot.rowDim).toBe("status");
    expect(pivot.colDim).toBe("region");
    expect(pivot.measureName).toBe("total_amount");
  });

  it("aggregates duplicate row/col keys", () => {
    const dupRows = [
      ["shipped", "Europe", 100],
      ["shipped", "Europe", 50]
    ];
    const pivot = detectPivot(columns, dupRows)!;
    expect(pivot.values[pivot.rowLabels.indexOf("shipped")][pivot.colLabels.indexOf("Europe")]).toBe(150);
  });

  it("detects measure when 4 columns with extra field", () => {
    const cols = [
      { name: "status", type: "varchar" },
      { name: "region", type: "varchar" },
      { name: "note", type: "varchar" },
      { name: "total_amount", type: "double" }
    ];
    const pivot = detectPivot(cols, [["shipped", "Europe", "x", 200]])!;
    expect(pivot.measureName).toBe("total_amount");
    expect(pivot.values[0][0]).toBe(200);
  });

  it("canPivot reflects detectPivot", () => {
    expect(canPivot(columns, rows)).toBe(true);
    expect(canPivot([{ name: "a", type: "varchar" }], rows)).toBe(false);
  });

  it("caps grid at 25x25 and sets truncated flag", () => {
    const bigRows: unknown[][] = [];
    for (let r = 0; r < 30; r++) {
      for (let c = 0; c < 30; c++) {
        bigRows.push([`r${r}`, `c${c}`, r * c]);
      }
    }
    const pivot = detectPivot(columns, bigRows)!;
    expect(pivot.rowLabels.length).toBeLessThanOrEqual(25);
    expect(pivot.colLabels.length).toBeLessThanOrEqual(25);
    expect(pivot.truncated).toBe(true);
  });
});
