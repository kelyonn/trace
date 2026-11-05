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

export const exportJobs: Record<string, ExportJob> = {};

export const metrics: Metrics = {
  totalQueries: 0,
  queryErrors: 0,
  cacheHits: 0,
  exports: 0
};
