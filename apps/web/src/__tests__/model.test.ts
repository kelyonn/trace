import { describe, it, expect } from "vitest";
import { buildCubeSql, drillInto, DEFAULT_CUBE } from "../cube/model";
import { planChart } from "../components/AutoChart";
import { tokenizeSql } from "../components/SqlEditor";
import { niceTicks } from "../lib/format";

describe("cube model", () => {
  it("builds a grouped star-schema query", () => {
    const sql = buildCubeSql(DEFAULT_CUBE);
    expect(sql).toContain("SELECT c.region AS region, p.category AS category, SUM(ol.line_amount) AS revenue");
    expect(sql).toContain("GROUP BY 1, 2");
    expect(sql).not.toContain("WHERE");
  });

  it("drills by pinning both coordinates and stepping down hierarchies", () => {
    const next = drillInto(DEFAULT_CUBE, "Europe", "Software");
    expect(next.filters).toEqual([
      { dim: "region", value: "Europe" },
      { dim: "category", value: "Software" }
    ]);
    expect(next.rows).toBe("industry");
    expect(next.cols).toBe("sku");
    const sql = buildCubeSql(next);
    expect(sql).toContain("WHERE c.region = 'Europe'");
    expect(sql).toContain("AND p.category = 'Software'");
  });

  it("escapes quotes in filter literals", () => {
    const sql = buildCubeSql({ ...DEFAULT_CUBE, filters: [{ dim: "customer", value: "O'Neil" }] });
    expect(sql).toContain("c.name = 'O''Neil'");
  });

  it("never assigns the same dimension to both axes", () => {
    let state = DEFAULT_CUBE;
    for (let i = 0; i < 5; i++) {
      state = drillInto(state, "a", "b");
      expect(state.rows).not.toBe(state.cols);
    }
  });
});

describe("planChart", () => {
  it("plans a line chart for a time series", () => {
    const plan = planChart(
      [
        { name: "month", type: "date" },
        { name: "revenue", type: "decimal" }
      ],
      [
        ["2025-01-01", 10],
        ["2025-02-01", 12]
      ]
    );
    expect(plan.kind).toBe("line");
  });

  it("plans ranked bars for category + measure", () => {
    const plan = planChart(
      [
        { name: "region", type: "varchar" },
        { name: "total", type: "bigint" }
      ],
      [
        ["A", 1],
        ["B", 3]
      ]
    );
    expect(plan.kind).toBe("bar");
    if (plan.kind === "bar") expect(plan.data[0].label).toBe("B");
  });
});

describe("helpers", () => {
  it("tokenizes keywords, strings and numbers", () => {
    const toks = tokenizeSql("SELECT 'x', 42 FROM t");
    expect(toks.find((t) => t.text === "SELECT")?.cls).toBe("tok-kw");
    expect(toks.find((t) => t.text === "'x'")?.cls).toBe("tok-str");
    expect(toks.find((t) => t.text === "42")?.cls).toBe("tok-num");
  });

  it("produces nice ticks", () => {
    expect(niceTicks(0, 97, 4)).toEqual([0, 20, 40, 60, 80, 100]);
  });
});
