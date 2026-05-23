import { randomUUID } from "crypto";

export type StreamJob = {
  sql: string;
  role: string;
  maskColumns: string[];
};

export const pendingQueries = new Map<string, StreamJob>();

export function enqueueStreamJob(job: StreamJob): string {
  const id = randomUUID();
  pendingQueries.set(id, job);
  setTimeout(() => pendingQueries.delete(id), 300_000);
  return id;
}
