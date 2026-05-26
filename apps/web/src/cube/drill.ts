import type { PivotShape } from "./pivot";

export type PivotContext = {
  rowDim: string;
  colDim: string;
  measureName: string;
  rowValue: string;
  colValue: string;
};

/** Maps result column names to qualified SQL expressions for demo drill-through */
const DIM_SQL: Record<string, string> = {
  status: "o.status",
  region: "c.region",
  industry: "c.industry",
  category: "p.category",
  name: "c.name",
  order_date: "o.order_date"
};

const CUBE_BY_STATUS_REGION = `
SELECT o.status, c.region, SUM(o.amount) AS total_amount
FROM orders o
JOIN customers c ON c.id = o.customer_id
`.trim();

const CUBE_BY_INDUSTRY_CATEGORY = `
SELECT c.industry, p.category, SUM(ol.line_amount) AS revenue
FROM order_lines ol
JOIN orders o ON o.id = ol.order_id
JOIN customers c ON c.id = o.customer_id
JOIN products p ON p.id = ol.product_id
`.trim();

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function dimExpr(dim: string): string {
  return DIM_SQL[dim.toLowerCase()] ?? dim;
}

export function pivotContextFromClick(
  pivot: PivotShape,
  rowLabel: string,
  colLabel: string
): PivotContext {
  return {
    rowDim: pivot.rowDim,
    colDim: pivot.colDim,
    measureName: pivot.measureName,
    rowValue: rowLabel,
    colValue: colLabel
  };
}

/**
 * Builds drill SQL against base tables when the current query matches a known cube template.
 */
export function buildDrillSql(ctx: PivotContext, currentSql: string): string | null {
  const normalized = currentSql.replace(/\s+/g, " ").trim().toLowerCase();

  if (
    normalized.includes("from orders o") &&
    normalized.includes("join customers c") &&
    ctx.rowDim.toLowerCase() === "status" &&
    ctx.colDim.toLowerCase() === "region"
  ) {
    return `${CUBE_BY_STATUS_REGION}
WHERE ${dimExpr("status")} = ${sqlLiteral(ctx.rowValue)} AND ${dimExpr("region")} = ${sqlLiteral(ctx.colValue)}
GROUP BY o.status, c.region;`;
  }

  if (
    normalized.includes("order_lines ol") &&
    normalized.includes("join products p") &&
    ctx.rowDim.toLowerCase() === "industry" &&
    ctx.colDim.toLowerCase() === "category"
  ) {
    return `${CUBE_BY_INDUSTRY_CATEGORY}
WHERE ${dimExpr("industry")} = ${sqlLiteral(ctx.rowValue)} AND ${dimExpr("category")} = ${sqlLiteral(ctx.colValue)}
GROUP BY c.industry, p.category;`;
  }

  const rowExpr = dimExpr(ctx.rowDim);
  const colExpr = dimExpr(ctx.colDim);
  if (rowExpr !== ctx.rowDim || colExpr !== ctx.colDim) {
    if (rowExpr === colExpr) {
      return `${CUBE_BY_STATUS_REGION}
WHERE ${rowExpr} = ${sqlLiteral(ctx.rowValue)}
GROUP BY o.status, c.region;`;
    }
    return `${CUBE_BY_STATUS_REGION}
WHERE ${rowExpr} = ${sqlLiteral(ctx.rowValue)} AND ${colExpr} = ${sqlLiteral(ctx.colValue)}
GROUP BY o.status, c.region;`;
  }

  return null;
}
