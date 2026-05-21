import { promises as fs } from "fs";
import path from "path";
import type {
  HistoryItem as QueryHistoryItem,
  AuditEvent,
  Notebook,
  Snapshot,
  AlertRule
} from "@trace/shared-types";

export type { QueryHistoryItem, AuditEvent, Notebook, Snapshot, AlertRule };

export const dataDir = path.join(process.cwd(), "data");

const historyFile = path.join(dataDir, "history.json");
const auditFile = path.join(dataDir, "audit.json");
const notebooksFile = path.join(dataDir, "notebooks.json");
const snapshotsFile = path.join(dataDir, "snapshots.json");
const alertsFile = path.join(dataDir, "alerts.json");

const maxHistory = 200;
const maxAudit = 500;

export let queryHistory: QueryHistoryItem[] = [];
export let auditEvents: AuditEvent[] = [];
export let notebooks: Notebook[] = [];
export let snapshots: Snapshot[] = [];
export let alerts: AlertRule[] = [];

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function writeJson(filePath: string, payload: unknown): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2));
}

export async function initStores(): Promise<void> {
  queryHistory = await readJson<QueryHistoryItem[]>(historyFile, []);
  auditEvents = await readJson<AuditEvent[]>(auditFile, []);
  notebooks = await readJson<Notebook[]>(notebooksFile, []);
  snapshots = await readJson<Snapshot[]>(snapshotsFile, []);
  alerts = await readJson<AlertRule[]>(alertsFile, []);
}

export function addHistory(item: QueryHistoryItem): void {
  queryHistory.unshift(item);
  if (queryHistory.length > maxHistory) queryHistory.pop();
  void writeJson(historyFile, queryHistory);
}

export function addAudit(event: AuditEvent): void {
  auditEvents.unshift(event);
  if (auditEvents.length > maxAudit) auditEvents.pop();
  void writeJson(auditFile, auditEvents);
}

export const saveNotebooks = () => writeJson(notebooksFile, notebooks);
export const saveSnapshots = () => writeJson(snapshotsFile, snapshots);
export const saveAlerts = () => writeJson(alertsFile, alerts);
