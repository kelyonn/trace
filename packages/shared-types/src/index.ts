// Shared TypeScript types for @trace/api and @trace/web.
// Import from this package: import type { QueryResponse } from "@trace/shared-types";

export type Column = {
  name: string;
  type: string;
};

export type QueryRequest = {
  sql: string;
};

export type QueryResponse = {
  queryId: string;
  durationMs: number;
  rowCount: number;
  columns: Column[];
  rows: unknown[][];
  nextUri: string | null;
  cacheHit: boolean;
  maskColumns: string[];
};

export type HistoryItem = {
  id: string;
  sql: string;
  submittedAt: string;
  durationMs: number;
  rowCount: number | null;
  status: "completed" | "failed";
  error?: string;
  dataSourceId: string;
};

export type AuditEvent = {
  id: string;
  action: "query" | "schema" | "explain" | "activate_source";
  dataSourceId: string;
  timestamp: string;
  detail?: string;
};

export type AlertRule = {
  id: string;
  name: string;
  sql: string;
  comparison: ">" | "<" | ">=" | "<=";
  threshold: number;
  lastValue?: number;
  lastTriggeredAt?: string;
  createdAt: string;
};

export type Snapshot = {
  id: string;
  name: string;
  sql: string;
  summary: string;
  createdAt: string;
};

export type Notebook = {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export type DataSource = {
  id: string;
  name: string;
  type: "postgres" | "snowflake" | "bigquery" | "sqlserver";
  status: "connected" | "auth_required" | "error";
};

export type SemanticMeasure = {
  name: string;
  sql: string;
  type: "sum" | "count" | "avg" | "min" | "max" | "count_distinct";
  description?: string;
};

export type SemanticDimension = {
  name: string;
  sql: string;
  type: "string" | "number" | "time" | "boolean";
  description?: string;
};

export type SemanticJoin = {
  name: string;
  sql: string;
  relationship?: "many_to_one" | "one_to_many" | "one_to_one";
};

export type SemanticCube = {
  name: string;
  sql: string;
  joins?: SemanticJoin[];
  measures: SemanticMeasure[];
  dimensions: SemanticDimension[];
};

export type SemanticModel = {
  version: string;
  cubes: SemanticCube[];
};

export type EngineInfo = {
  kind: "trino" | "embedded";
  mode: string;
  label: string;
  dataset?: {
    seeded: boolean;
    seedMs: number;
    counts: Record<string, number>;
    range: { start: string; end: string };
  };
};

export type StatusResponse = {
  activeSourceId: string;
  engine?: EngineInfo;
  trino: { ok: boolean; version: string | null; error: string | null };
  postgres: { ok: boolean; error: string | null };
  demo?: {
    orderCount: number;
    seeded: boolean;
  };
};

export type AssistantSummary = {
  rowCount: number;
  columns: string[];
  numericStats: { column: string; min: number | null; max: number | null; avg: number | null }[];
};
