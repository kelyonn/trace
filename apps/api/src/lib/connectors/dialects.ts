import type { Dialect } from "./types.js";

const dq = (id: string) => `"${id.replace(/"/g, '""')}"`;

export const postgresDialect: Dialect = {
  name: "postgres",
  quote: dq,
  label: (e) => `COALESCE(CAST(${e} AS TEXT), '(null)')`,
  year: (e) => `TO_CHAR(${e}, 'YYYY')`,
  quarter: (e) => `TO_CHAR(${e}, 'YYYY-"Q"Q')`,
  month: (e) => `TO_CHAR(${e}, 'YYYY-MM')`,
  explain: (sql) => `EXPLAIN ${sql}`,
  sample: (t, cols, n) => `SELECT ${cols.join(", ")} FROM ${dq(t)} LIMIT ${n}`
};

export const mysqlDialect: Dialect = {
  name: "mysql",
  quote: (id) => `\`${id.replace(/`/g, "``")}\``,
  label: (e) => `COALESCE(CAST(${e} AS CHAR), '(null)')`,
  year: (e) => `DATE_FORMAT(${e}, '%Y')`,
  quarter: (e) => `CONCAT(YEAR(${e}), '-Q', QUARTER(${e}))`,
  month: (e) => `DATE_FORMAT(${e}, '%Y-%m')`,
  explain: (sql) => `EXPLAIN ${sql}`,
  sample: (t, cols, n) => `SELECT ${cols.join(", ")} FROM \`${t.replace(/`/g, "``")}\` LIMIT ${n}`
};

export const sqliteDialect: Dialect = {
  name: "sqlite",
  quote: dq,
  label: (e) => `COALESCE(CAST(${e} AS TEXT), '(null)')`,
  year: (e) => `strftime('%Y', ${e})`,
  quarter: (e) => `(strftime('%Y', ${e}) || '-Q' || ((CAST(strftime('%m', ${e}) AS INTEGER) + 2) / 3))`,
  month: (e) => `strftime('%Y-%m', ${e})`,
  explain: (sql) => `EXPLAIN QUERY PLAN ${sql}`,
  sample: (t, cols, n) => `SELECT ${cols.join(", ")} FROM ${dq(t)} LIMIT ${n}`
};

export const trinoDialect: Dialect = {
  name: "trino",
  quote: dq,
  label: (e) => `COALESCE(CAST(${e} AS VARCHAR), '(null)')`,
  year: (e) => `CAST(year(${e}) AS VARCHAR)`,
  quarter: (e) => `CAST(year(${e}) AS VARCHAR) || '-Q' || CAST(quarter(${e}) AS VARCHAR)`,
  month: (e) => `date_format(${e}, '%Y-%m')`,
  explain: (sql) => `EXPLAIN (TYPE DISTRIBUTED) ${sql}`,
  sample: (t, cols, n) => `SELECT ${cols.join(", ")} FROM ${dq(t)} LIMIT ${n}`
};
