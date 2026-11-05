import type { TableInfo } from "./connectors/types.js";
import { buildModel, type AutoModel } from "./automodel.js";
import { activeConnector, activeSourceId, onSourceChange } from "./sources.js";

const TTL_MS = 10 * 60 * 1000;
const models = new Map<string, { model: AutoModel; at: number }>();
const schemas = new Map<string, { tables: TableInfo[]; at: number }>();
const inflight = new Map<string, Promise<AutoModel>>();

export function invalidateModels(sourceId?: string): void {
  for (const key of [...models.keys()]) if (!sourceId || key.startsWith(`${sourceId}|`)) models.delete(key);
  if (sourceId) schemas.delete(sourceId);
  else schemas.clear();
}

onSourceChange(() => {
  /* models stay cached per source; nothing to drop on a switch */
});

export async function getTables(): Promise<TableInfo[]> {
  const id = activeSourceId();
  const hit = schemas.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.tables;
  const tables = await activeConnector().introspect();
  schemas.set(id, { tables, at: Date.now() });
  return tables;
}

export async function getModel(opts: { fact?: string; hiddenColumns?: string[] }): Promise<AutoModel> {
  const id = activeSourceId();
  const key = `${id}|${opts.fact ?? ""}|${(opts.hiddenColumns ?? []).join(",")}`;
  const hit = models.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.model;
  const pending = inflight.get(key);
  if (pending) return pending;
  const p = (async () => {
    const tables = await getTables();
    const model = await buildModel(id, activeConnector(), { ...opts, tables });
    models.set(key, { model, at: Date.now() });
    return model;
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
