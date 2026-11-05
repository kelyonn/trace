import { describe, it, expect, beforeAll } from "vitest";
import os from "os";
import path from "path";
import { mkdtempSync } from "fs";
import { buildAggregateSql, buildModel, chooseDefaults } from "../lib/automodel.js";
import { SqliteConnector, PgliteConnector } from "../lib/connectors/connectors.js";
import { mysqlDialect, postgresDialect, sqliteDialect, trinoDialect } from "../lib/connectors/dialects.js";
import { inferKeys } from "../lib/connectors/introspect-sql.js";
import { inferType, parseUpload, sanitizeIdentifier } from "../lib/uploads.js";
import { ensureFleetSample } from "../lib/samples.js";
import { redact } from "../lib/sources.js";
import type { TableInfo } from "../lib/connectors/types.js";

const tmp = mkdtempSync(path.join(os.tmpdir(), "trace-test-"));

describe("SQLite source → automatic model", () => {
  let connector: SqliteConnector;

  beforeAll(async () => {
    const file = await ensureFleetSample(path.join(tmp, "fleet.sqlite"), 3000);
    connector = new SqliteConnector({ path: file });
  }, 60_000);

  it("introspects tables, keys and foreign keys", async () => {
    const tables = await connector.introspect();
    const trips = tables.find((t) => t.name === "trips")!;
    expect(trips.rowCount).toBe(3000);
    expect(trips.primaryKey).toEqual(["id"]);
    expect(trips.foreignKeys.map((f) => f.refTable).sort()).toEqual(["cities", "drivers", "vehicles"]);
  });

  it("picks the fact table, joins dimensions and orders drill paths by cardinality", async () => {
    const model = await buildModel("fleet", connector, { hiddenColumns: ["drivers.name"] });
    expect(model.fact.table).toBe("trips");
    expect(model.joins.map((j) => j.table).sort()).toEqual(["cities", "drivers", "vehicles"]);
    const region = model.dimensions.find((d) => d.key === "cities.region")!;
    expect(region.next).toBe("cities.country");
    expect(model.dimensions.find((d) => d.key === "cities.country")?.next).toBe("cities.name");
    expect(model.dimensions.find((d) => d.key === "cities.name")?.label).toBe("City");
    expect(model.dimensions.find((d) => d.key === "trips.started_at:year")?.next).toBe("trips.started_at:quarter");
    expect(model.dimensions.some((d) => d.key === "drivers.name")).toBe(false);
    expect(model.hiddenColumns).toContain("drivers.name");
    expect(model.measures[0].key).toBe("sum:fare");
    expect(model.measures[0].format).toBe("money");
    const { x, y, z } = model.defaults;
    expect(new Set([x, y, z]).size).toBe(3);
  });

  it("generates SQLite SQL that runs and aggregates correctly", async () => {
    const model = await buildModel("fleet", connector);
    const sql = buildAggregateSql(
      model,
      { dims: ["cities.region", "trips.started_at:year"], measures: ["count"], filters: [{ dim: "trips.status", value: "completed" }] },
      sqliteDialect
    );
    expect(sql).toContain("LEFT JOIN \"cities\" t1");
    expect(sql).not.toContain("\"vehicles\"");
    const res = await connector.query(sql);
    const total = res.rows.reduce((a, r) => a + Number(r[2]), 0);
    const check = await connector.query("SELECT COUNT(*) FROM trips WHERE status = 'completed'");
    expect(total).toBe(Number(check.rows[0][0]));
  });

  it("is read-only", async () => {
    await expect(connector.query("DELETE FROM trips")).rejects.toThrow();
  });
});

describe("uploads", () => {
  it("infers column types", () => {
    expect(inferType(["1", "2", ""])).toBe("BIGINT");
    expect(inferType(["1.5", "2"])).toBe("DOUBLE PRECISION");
    expect(inferType(["2025-01-02", "2024-12-31"])).toBe("DATE");
    expect(inferType(["2025-01-02 10:00:00"])).toBe("TIMESTAMP");
    expect(inferType(["True", "false"])).toBe("BOOLEAN");
    expect(inferType(["a", "1"])).toBe("TEXT");
  });

  it("parses CSV and JSON", () => {
    expect(parseUpload("a.csv", 'x,"y, z"\n1,"q ""w"""\n').rows).toEqual([["1", 'q "w"']]);
    const j = parseUpload("a.json", JSON.stringify({ rows: [{ a: 1, b: { c: 2 } }, { a: 3 }] }));
    expect(j.columns).toEqual(["a", "b"]);
    expect(j.rows[0]).toEqual([1, '{"c":2}']);
  });

  it("sanitizes identifiers", () => {
    expect(sanitizeIdentifier("Freight Cost (EUR)")).toBe("freight_cost_eur");
    expect(sanitizeIdentifier("2024 sales", "t")).toBe("t_2024_sales");
  });

  it("loads a CSV into the files workspace and models it", async () => {
    process.env.EMBEDDED_PERSIST = "false";
    const { loadTable, getFilesDb } = await import("../lib/uploads.js");
    const csv = ["Region,Product,Sold On,Units,Revenue", ...Array.from({ length: 60 }, (_, i) =>
      `${["North", "South", "East"][i % 3]},${["A", "B"][i % 2]},2025-0${(i % 9) + 1}-15,${i},${(i * 9.5).toFixed(2)}`)].join("\n");
    const loaded = await loadTable("sales.csv", parseUpload("sales.csv", csv));
    expect(loaded).toMatchObject({ table: "sales", rows: 60 });
    const connector = new PgliteConnector("files", () => getFilesDb());
    const model = await buildModel("files", connector);
    expect(model.fact.table).toBe("sales");
    expect(model.measures.map((m) => m.key)).toContain("sum:revenue");
    expect(model.measures.find((m) => m.key === "sum:revenue")?.currency).toBe("$");
    expect(model.dimensions.map((d) => d.key)).toEqual(
      expect.arrayContaining(["sales.region", "sales.product", "sales.sold_on:month"])
    );
    const sql = buildAggregateSql(model, { dims: ["sales.region"], measures: ["sum:units"] }, postgresDialect);
    const res = await connector.query(sql);
    expect(res.rows.reduce((a, r) => a + Number(r[1]), 0)).toBe((59 * 60) / 2);
  }, 60_000);
});

describe("dialects and helpers", () => {
  it("formats time grains per engine", () => {
    expect(postgresDialect.quarter("d")).toBe(`TO_CHAR(d, 'YYYY-"Q"Q')`);
    expect(mysqlDialect.month("d")).toBe("DATE_FORMAT(d, '%Y-%m')");
    expect(trinoDialect.year("d")).toBe("CAST(year(d) AS VARCHAR)");
    expect(mysqlDialect.quote("a`b")).toBe("`a``b`");
  });

  it("infers foreign keys from *_id naming when none are declared", () => {
    const t = (name: string, cols: string[]): TableInfo => ({
      name,
      rowCount: 1,
      primaryKey: [],
      foreignKeys: [],
      columns: cols.map((c) => ({ name: c, type: "integer", kind: "number" }))
    });
    const tables = [t("orders", ["id", "customer_id", "category_id"]), t("customers", ["id"]), t("categories", ["id"])];
    inferKeys(tables);
    expect(tables[0].foreignKeys.map((f) => f.refTable)).toEqual(["customers", "categories"]);
  });

  it("redacts secrets", () => {
    expect(redact({ password: "x", connectionString: "postgres://u:secret@h/db", host: "h" })).toEqual({
      password: "••••••",
      connectionString: "postgres://u:••••••@h/db",
      host: "h"
    });
  });

  it("always yields three distinct default axes", () => {
    const d = chooseDefaults(
      [
        { key: "t.a", label: "A", group: "t", groupLabel: "T", table: "t", alias: "f", column: "a", kind: "category", cardinality: 5, next: null, sql: "a" },
        { key: "__all", label: "All", group: "__all", groupLabel: "", table: "t", alias: "f", column: "", kind: "category", cardinality: 1, next: null, sql: "'All'" }
      ],
      []
    );
    expect(d.x).toBe("t.a");
    expect(d.measure).toBe("count");
  });
});
