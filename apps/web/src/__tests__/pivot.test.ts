import { describe, it, expect } from "vitest";
import { pivotRows } from "../cube/pivot";

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

describe("pivotRows", () => {
  it("returns null for insufficient columns", () => {
    expect(pivotRows([{ name: "a", type: "varchar" }], [[1, 2]])).toBeNull();
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
});
