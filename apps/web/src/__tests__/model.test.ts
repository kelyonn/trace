import { describe, it, expect } from "vitest";
import { buildGrid, drillAxis, isValidFor, olapFromModel, olapRequest, OTHER, pivotAxes, rollUpAxis, setAxisDim } from "../cube/olap";
import type { AutoModel } from "../lib/model";
import { planChart } from "../components/AutoChart";
import { tokenizeSql } from "../components/SqlEditor";
import { niceTicks } from "../lib/format";

describe("olap state", () => {
  const model = {
    sourceId: "s",
    dialect: "postgres",
    fact: { table: "sales", alias: "f", rowCount: 10 },
    factCandidates: [],
    joins: [],
    measures: [{ key: "count", label: "Rows", format: "number", sql: "COUNT(*)" }],
    dimensions: [
      { key: "r.region", label: "Region", group: "r", groupLabel: "R", table: "r", column: "region", kind: "category", cardinality: 3, next: "r.city", sql: "" },
      { key: "r.city", label: "City", group: "r", groupLabel: "R", table: "r", column: "city", kind: "category", cardinality: 9, next: null, sql: "" },
      { key: "p.cat", label: "Category", group: "p", groupLabel: "P", table: "p", column: "cat", kind: "category", cardinality: 4, next: null, sql: "" },
      { key: "__all", label: "All", group: "__all", groupLabel: "", table: "sales", column: "", kind: "category", cardinality: 1, next: null, sql: "'All'" }
    ],
    defaults: { x: "r.region", y: "p.cat", z: "__all", measure: "count" },
    hiddenColumns: [],
    tableCount: 3
  } satisfies AutoModel;

  it("starts from the model defaults", () => {
    const s = olapFromModel(model);
    expect(olapRequest(s)).toEqual({ dims: ["r.region", "p.cat", "__all"], measures: ["count"], filters: [], fact: "sales" });
  });

  it("drills by pinning the member and stepping to the next dimension, and rolls back up", () => {
    const s = drillAxis(olapFromModel(model), model, "x", "North");
    expect(s.x).toEqual({ dim: "r.city", pins: [{ dim: "r.region", value: "North" }] });
    expect(olapRequest(s).filters).toEqual([{ dim: "r.region", value: "North" }]);
    expect(drillAxis(s, model, "x", "Oslo")).toBe(s); // leaf: no further drill
    expect(rollUpAxis(s, "x").x).toEqual({ dim: "r.region", pins: [] });
  });

  it("swaps axes when a dimension is already in use and pivots", () => {
    const s = setAxisDim(olapFromModel(model), "z", "r.region");
    expect(s.z.dim).toBe("r.region");
    expect(s.x.dim).toBe("__all");
    expect(pivotAxes(s).x.dim).toBe(s.z.dim);
  });

  it("detects state that no longer fits a new model", () => {
    expect(isValidFor({ ...olapFromModel(model), measure: "sum:gone" }, model)).toBe(false);
  });
});

describe("grid building", () => {
  it("caps members into Other and keeps time axes chronological", () => {
    const rows: unknown[][] = [];
    for (let i = 0; i < 15; i++) rows.push([`m${i}`, "a", "2025", i + 1]);
    rows.push(["m0", "a", "2024", 5]);
    const g = buildGrid(rows, { x: false, y: false, z: true }, 12);
    expect(g.members.x).toHaveLength(12);
    expect(g.members.x[11].key).toBe(OTHER);
    expect(g.members.z.map((m) => m.key)).toEqual(["2024", "2025"]);
    expect(g.total).toBe(rows.reduce((a, r) => a + Number(r[3]), 0));
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
