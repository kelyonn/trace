/** Client-side view of the API's automatic semantic model. */
import type { Requester } from "./api";
import { formatCompact, formatCurrency } from "./format";

export type ModelDimension = {
  key: string;
  label: string;
  group: string;
  groupLabel: string;
  table: string;
  column: string;
  kind: "category" | "time";
  grain?: "year" | "quarter" | "month";
  cardinality: number | null;
  next: string | null;
  numeric?: boolean;
  sql: string;
};

export type ModelMeasure = { key: string; label: string; format: "money" | "number"; currency?: string; sql: string };

export type AutoModel = {
  sourceId: string;
  dialect: string;
  fact: { table: string; alias: string; rowCount: number | null };
  factCandidates: { table: string; rowCount: number | null; score: number }[];
  joins: { table: string; alias: string; parent: string; on: string }[];
  dimensions: ModelDimension[];
  measures: ModelMeasure[];
  defaults: { x: string; y: string; z: string; measure: string };
  hiddenColumns: string[];
  tableCount: number;
};

export type Filter = { dim: string; value: string };

export type AggregateResult = {
  sql: string;
  columns: { name: string; type: string }[];
  rows: unknown[][];
  durationMs: number;
  cacheHit: boolean;
};

export type AggregateRequest = {
  dims: string[];
  measures: string[];
  filters?: Filter[];
  order?: { by: "measure" | "dim"; index?: number; dir?: "asc" | "desc" };
  limit?: number;
  fact?: string;
};

export const aggregate = (request: Requester, body: AggregateRequest) =>
  request<AggregateResult>("/aggregate", { body });

export const aggregateSql = async (request: Requester, body: AggregateRequest) =>
  (await request<{ sql: string }>("/aggregate", { body: { ...body, sqlOnly: true } })).sql;

export function measureFormatter(m: ModelMeasure | undefined, compact = true): (n: number) => string {
  if (m?.format === "money") return (n) => formatCurrency(n, compact, m.currency ?? "$");
  return (n) => (compact ? formatCompact(n) : n.toLocaleString("en-US", { maximumFractionDigits: 2 }));
}

/** Additive measures can be summed across periods; distinct counts and averages cannot. */
export const isAdditive = (m: ModelMeasure) => m.key === "count" || m.key.startsWith("sum:");

export const dimByKey = (model: AutoModel, key: string) => model.dimensions.find((d) => d.key === key);

/** Category dimensions usable as chart series or axes, coarsest first. */
export function categoryDims(model: AutoModel, maxCardinality = Infinity): ModelDimension[] {
  return model.dimensions
    .filter((d) => d.kind === "category" && d.key !== "__all" && (d.cardinality ?? 0) <= maxCardinality)
    .sort((a, b) => Number(!!a.numeric) - Number(!!b.numeric) || (a.cardinality ?? 1e9) - (b.cardinality ?? 1e9));
}

export const monthDim = (model: AutoModel) => model.dimensions.find((d) => d.kind === "time" && d.grain === "month");

/** Groups dimensions for <optgroup> pickers. */
export function groupedDims(model: AutoModel): { label: string; dims: ModelDimension[] }[] {
  const groups = new Map<string, { label: string; dims: ModelDimension[] }>();
  for (const d of model.dimensions) {
    const g = groups.get(d.group) ?? { label: d.groupLabel, dims: [] };
    g.dims.push(d);
    groups.set(d.group, g);
  }
  return [...groups.values()];
}
