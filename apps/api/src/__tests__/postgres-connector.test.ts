/**
 * Exercises the real `pg` driver path of PostgresConnector against PGlite served
 * over the Postgres wire protocol, so no external database is required.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { PostgresConnector } from "../lib/connectors/connectors.js";
import { buildAggregateSql, buildModel } from "../lib/automodel.js";
import { postgresDialect } from "../lib/connectors/dialects.js";

const PORT = 54329;

describe("PostgresConnector over the wire", () => {
  let db: PGlite;
  let server: PGLiteSocketServer;
  let connector: PostgresConnector;

  beforeAll(async () => {
    db = await PGlite.create();
    await db.exec(`
      CREATE TABLE teams (id INT PRIMARY KEY, name TEXT, league TEXT);
      CREATE TABLE matches (
        id INT PRIMARY KEY,
        team_id INT REFERENCES teams(id),
        played_on DATE,
        venue TEXT,
        goals INT,
        ticket_revenue NUMERIC(10, 2)
      );
      INSERT INTO teams VALUES (1, 'Ajax', 'Eredivisie'), (2, 'PSV', 'Eredivisie'), (3, 'Porto', 'Primeira'), (4, 'Benfica', 'Primeira');
      INSERT INTO matches
      SELECT g, 1 + (g % 4), DATE '2025-01-01' + g * 3, CASE WHEN g % 2 = 0 THEN 'home' ELSE 'away' END, g % 5, 1000 + g * 10.5
      FROM generate_series(1, 120) g;
    `);
    server = new PGLiteSocketServer({ db, port: PORT, host: "127.0.0.1" });
    await server.start();
    connector = new PostgresConnector({ host: "127.0.0.1", port: PORT, user: "postgres", database: "postgres", poolSize: 1 });
  }, 60_000);

  afterAll(async () => {
    await connector?.close();
    await server?.stop();
    await db?.close();
  });

  it("queries with typed columns and JSON-safe values", async () => {
    const res = await connector.query("SELECT venue, COUNT(*) AS n, SUM(ticket_revenue) AS rev, MIN(played_on) AS first FROM matches GROUP BY 1 ORDER BY 1");
    expect(res.columns.map((c) => c.type)).toEqual(["varchar", "bigint", "decimal", "date"]);
    expect(res.rows[0]).toEqual(["away", 60, expect.any(Number), expect.stringMatching(/^2025-01-/)]);
  });

  it("introspects constraints and builds a model", async () => {
    const tables = await connector.introspect();
    expect(tables.find((t) => t.name === "matches")?.foreignKeys).toEqual([{ column: "team_id", refTable: "teams", refColumn: "id" }]);
    const model = await buildModel("pg", connector, { tables });
    expect(model.fact.table).toBe("matches");
    expect(model.dimensions.find((d) => d.key === "teams.league")?.next).toBe("teams.name");
    const sql = buildAggregateSql(model, { dims: ["teams.league", "matches.played_on:quarter"], measures: ["sum:ticket_revenue"] }, postgresDialect);
    const res = await connector.query(sql);
    expect(res.rows.some((r) => /^2025-Q[1-4]$/.test(String(r[1])))).toBe(true);
  });

  it("enforces read-only sessions", async () => {
    await expect(connector.query("DELETE FROM matches")).rejects.toThrow(/read-only/);
  });
});
