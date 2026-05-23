import type { DataSource } from "@trace/shared-types";

export type { DataSource };

export type ExportJob = {
  id: string;
  status: "queued" | "ready" | "failed";
  filePath?: string;
  createdAt: string;
  error?: string;
};

export type Metrics = {
  totalQueries: number;
  queryErrors: number;
  cacheHits: number;
  exports: number;
};

export const dataSources: DataSource[] = [
  { id: "postgres-local", name: "Local Postgres", type: "postgres", status: "connected" },
  {
    id: "snowflake-demo",
    name: "Snowflake (demo)",
    type: "snowflake",
    status: "auth_required"
  }
];

export let activeSourceId: string = dataSources[0]?.id ?? "postgres-local";

export function setActiveSourceId(id: string): void {
  activeSourceId = id;
}

export const exportJobs: Record<string, ExportJob> = {};

export const metrics: Metrics = {
  totalQueries: 0,
  queryErrors: 0,
  cacheHits: 0,
  exports: 0
};
