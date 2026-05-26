import { describe, it, expect } from "vitest";
import { buildDrillSql, pivotContextFromClick } from "../cube/drill";
import type { PivotShape } from "../cube/pivot";

const pivot: PivotShape = {
  rowDim: "status",
  colDim: "region",
  measureName: "total_amount",
  rowLabels: ["shipped"],
  colLabels: ["Europe"],
  values: [[100]],
  minValue: 0,
  maxValue: 100
};

describe("buildDrillSql", () => {
  it("builds status/region drill for cube template", () => {
    const ctx = pivotContextFromClick(pivot, "shipped", "Europe");
    const sql = buildDrillSql(
      ctx,
      `SELECT o.status, c.region, SUM(o.amount) AS total_amount
       FROM orders o JOIN customers c ON c.id = o.customer_id
       GROUP BY o.status, c.region`
    );
    expect(sql).toContain("WHERE o.status = 'shipped'");
    expect(sql).toContain("c.region = 'Europe'");
    expect(sql).not.toContain("SELECT * FROM (");
  });

  it("escapes quotes in values", () => {
    const ctx = pivotContextFromClick(pivot, "O'Brien", "Europe");
    const sql = buildDrillSql(ctx, "from orders o join customers c")!;
    expect(sql).toContain("O''Brien");
  });
});
