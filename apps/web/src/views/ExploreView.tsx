import { useEffect, useMemo, useState } from "react";
import type { Column } from "@trace/shared-types";
import type { Requester, QueryPayload } from "../lib/api";
import type { StreamState } from "../hooks/useQueryStream";
import { columnKind, formatDuration } from "../lib/format";
import SqlEditor from "../components/SqlEditor";
import DataTable from "../components/DataTable";
import AutoChart, { planChart } from "../components/AutoChart";
import ResultCube, { cubeShape } from "../cube/ResultCube";
import Icon from "../components/Icon";
import { aggregateSql, dimByKey, groupedDims, monthDim, type AggregateRequest, type AutoModel } from "../lib/model";

type TableInfo = {
  name: string;
  rowCount: number | null;
  primaryKey: string[];
  foreignKeys: { column: string; refTable: string; refColumn: string }[];
  columns: { name: string; type: string; kind: string }[];
};

type Preset = { label: string; req?: AggregateRequest; sql?: string };

/** Starter queries derived from the active source's model. */
function presetsFor(model: AutoModel | null): Preset[] {
  if (!model) return [];
  const m = model.measures[0];
  const out: Preset[] = [{ label: `Sample ${model.fact.table}`, sql: `SELECT *\nFROM ${model.fact.table}\nLIMIT 100` }];
  if (!m) return out;
  const { x, y, z } = model.defaults;
  const label = (k: string) => dimByKey(model, k)?.label ?? k;
  const fact = model.fact.table;
  if (x !== "__all" && y !== "__all")
    out.push({ label: `${m.label} by ${label(x)} × ${label(y)} × ${label(z)}`, req: { dims: [x, y, z], measures: [m.key], fact } });
  const month = monthDim(model);
  if (month && x !== "__all") out.push({ label: `${m.label} by month × ${label(x)}`, req: { dims: [month.key, x], measures: [m.key], fact } });
  for (const k of [x, y]) {
    if (k !== "__all")
      out.push({ label: `${m.label} by ${label(k)}`, req: { dims: [k], measures: [m.key, "count"], order: { by: "measure", dir: "desc" }, fact } });
  }
  return out;
}

type View = "table" | "chart" | "cube";

type Props = {
  request: Requester;
  theme: string;
  model: AutoModel | null;
  sql: string;
  onSqlChange: (s: string) => void;
  result: QueryPayload | null;
  loading: boolean;
  error: string | null;
  plan: string | null;
  streamState: StreamState;
  onRun: (sql?: string) => void;
  onExplain: () => void;
  onStream: () => void;
  onCancelStream: () => void;
  onLoadMore: () => void;
  onExport: () => void;
  onSnapshot: () => void;
};

const TypeIcon = ({ col }: { col: Column }) => {
  const k = columnKind(col);
  return <span className={`type-icon ${k === "number" ? "num" : k}`}>{k === "number" ? "#" : k === "date" ? "D" : "Aa"}</span>;
};

const ExploreView = (p: Props) => {
  const [schema, setSchema] = useState<TableInfo[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [measure, setMeasure] = useState("");
  const [dims, setDims] = useState<string[]>([]);
  const [builderTab, setBuilderTab] = useState<"semantic" | "visual">("semantic");
  const [vbTable, setVbTable] = useState<string>("");
  const [vbCols, setVbCols] = useState<string[]>([]);
  const [vbLimit, setVbLimit] = useState(50);
  const [view, setView] = useState<View>("table");

  useEffect(() => {
    setSchemaError(null);
    p.request<{ tables: TableInfo[] }>("/schema?full=true")
      .then((r) => setSchema(r.tables ?? []))
      .catch((err) => setSchemaError(err instanceof Error ? err.message : "Schema fetch failed"));
  }, [p.request, p.model?.sourceId]);

  useEffect(() => {
    setMeasure(p.model?.measures[0]?.key ?? "");
    setDims([]);
  }, [p.model]);

  const tables = schema.map((t) => t.name);
  const columns: Record<string, Column[]> = Object.fromEntries(schema.map((t) => [t.name, t.columns]));
  const loadColumns = async (table: string) => columns[table] ?? [];
  const toggleTable = (t: string) => setOpen((prev) => (prev === t ? null : t));
  const presets = useMemo(() => presetsFor(p.model), [p.model]);

  const applyPreset = async (preset: Preset) => {
    const sql = preset.sql ?? (preset.req ? await aggregateSql(p.request, preset.req) : "");
    if (!sql) return;
    p.onSqlChange(sql);
    p.onRun(sql);
  };

  const pivot = useMemo(() => (p.result ? cubeShape(p.result.columns, p.result.rows) : null), [p.result]);
  const chartable = useMemo(() => (p.result ? planChart(p.result.columns, p.result.rows).kind !== "none" : false), [p.result]);

  // Pick the most expressive view automatically when a new result lands.
  useEffect(() => {
    if (!p.result) return;
    const dimsCount = p.result.columns.filter((c, i) => columnKind(c, p.result!.rows[0]?.[i]) !== "number").length;
    if (pivot && dimsCount >= 2 && !p.result.columns.some((c, i) => columnKind(c, p.result!.rows[0]?.[i]) === "date")) setView("cube");
    else if (chartable && p.result.rows.length > 1 && p.result.rows.length <= 400) setView("chart");
    else setView("table");
  }, [p.result, pivot, chartable]);

  const buildSemantic = async () => {
    if (!p.model || !measure) return;
    const sql = await aggregateSql(p.request, {
      dims,
      measures: [measure],
      order: dims.length ? { by: "measure", dir: "desc" } : undefined,
      fact: p.model.fact.table
    });
    p.onSqlChange(sql);
  };

  const buildVisual = () => {
    if (!vbTable) return;
    p.onSqlChange(`SELECT ${vbCols.length ? vbCols.join(", ") : "*"}\nFROM ${vbTable}\nLIMIT ${Math.max(1, vbLimit || 50)}`);
  };

  const r = p.result;
  const streaming = p.streamState.status === "streaming";

  return (
    <div className="workspace">
      <div className="workspace-left">
        <section className="card">
          <div className="card-header">
            <h2>Schema</h2>
            <span className="muted small mono">{tables.length}</span>
          </div>
          {schemaError ? <p className="error">{schemaError}</p> : null}
          <div className="tree">
            {tables.map((t) => (
              <div key={t}>
                <button type="button" className={open === t ? "tree-table active" : "tree-table"} onClick={() => toggleTable(t)}>
                  <Icon name="tableIcon" />
                  {t}
                  {t === p.model?.fact.table ? <span className="pill" style={{ color: "var(--select)" }}>fact</span> : null}
                  <span className="muted small" style={{ marginLeft: "auto" }}>
                    {schema.find((x) => x.name === t)?.rowCount?.toLocaleString() ?? ""}
                  </span>
                  <Icon name="chevron" className="chev" />
                </button>
                {open === t ? (
                  <div className="tree-columns fade-in">
                    {(columns[t] ?? []).map((c) => (
                      <button
                        key={c.name}
                        type="button"
                        className="tree-col"
                        title="Insert into editor"
                        onClick={() => p.onSqlChange(`${p.sql.replace(/\s*$/, "")} ${c.name}`)}
                      >
                        <TypeIcon col={c} />
                        {c.name}
                        {schema.find((x) => x.name === t)?.primaryKey.includes(c.name) ? <span className="muted">pk</span> : null}
                        {schema.find((x) => x.name === t)?.foreignKeys.find((f) => f.column === c.name) ? (
                          <span className="muted">→ {schema.find((x) => x.name === t)!.foreignKeys.find((f) => f.column === c.name)!.refTable}</span>
                        ) : null}
                        <span className="type">{c.type}</span>
                      </button>
                    ))}
                    <button
                      type="button"
                      className="tree-col"
                      style={{ color: "var(--select)", fontFamily: "var(--font-sans)" }}
                      onClick={() => {
                        const sql = `SELECT *\nFROM ${t}\nLIMIT 50`;
                        p.onSqlChange(sql);
                        p.onRun(sql);
                      }}
                    >
                      Preview 50 rows →
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
            {!tables.length && !schemaError ? <div className="skeleton" style={{ height: 120 }} /> : null}
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <h2>Query builder</h2>
            <div className="segmented">
              <button type="button" className={builderTab === "semantic" ? "active" : ""} onClick={() => setBuilderTab("semantic")}>
                Semantic
              </button>
              <button type="button" className={builderTab === "visual" ? "active" : ""} onClick={() => setBuilderTab("visual")}>
                Visual
              </button>
            </div>
          </div>
          {builderTab === "semantic" ? (
            p.model ? (
              <div className="builder">
                <label>
                  Measure
                  <select value={measure} onChange={(e) => setMeasure(e.target.value)}>
                    {p.model.measures.map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </label>
                {groupedDims(p.model)
                  .filter((g) => g.dims.some((d) => d.key !== "__all"))
                  .map((g) => (
                    <div key={g.label}>
                      <p className="section-label" style={{ marginBottom: 4 }}>
                        {g.label}
                      </p>
                      <div className="chip-group">
                        {g.dims.map((d) => (
                          <button
                            key={d.key}
                            type="button"
                            className={dims.includes(d.key) ? "chip on" : "chip"}
                            disabled={!dims.includes(d.key) && dims.length >= 3}
                            onClick={() => setDims((prev) => (prev.includes(d.key) ? prev.filter((x) => x !== d.key) : [...prev, d.key]))}
                          >
                            {d.label.replace(/^.* · /, "")}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                <button type="button" className="button ghost" onClick={() => void buildSemantic()}>
                  Generate SQL
                </button>
              </div>
            ) : (
              <p className="muted">Loading model…</p>
            )
          ) : (
            <div className="builder">
              <label>
                Table
                <select
                  value={vbTable}
                  onChange={async (e) => {
                    setVbTable(e.target.value);
                    const cols = await loadColumns(e.target.value);
                    setVbCols(cols.map((c) => c.name));
                  }}
                >
                  <option value="" disabled>
                    Select a table
                  </option>
                  {tables.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
              {vbTable ? (
                <div className="chip-group">
                  {(columns[vbTable] ?? []).map((c) => (
                    <button
                      key={c.name}
                      type="button"
                      className={vbCols.includes(c.name) ? "chip on" : "chip"}
                      onClick={() =>
                        setVbCols((prev) => (prev.includes(c.name) ? prev.filter((x) => x !== c.name) : [...prev, c.name]))
                      }
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              ) : null}
              <label>
                Row limit
                <input type="number" min={1} value={vbLimit} onChange={(e) => setVbLimit(Number(e.target.value))} />
              </label>
              <button type="button" className="button ghost" onClick={buildVisual} disabled={!vbTable}>
                Build SQL
              </button>
            </div>
          )}
        </section>
      </div>

      <div className="workspace-right">
        <section className="card">
          <div className="card-header">
            <div>
              <h2>SQL</h2>
              <p className="card-sub">Pushed down to the active source. Every query is policy-checked and audited.</p>
            </div>
            <div className="button-row">
              <button type="button" className="button ghost" onClick={p.onExplain} disabled={p.loading}>
                Explain
              </button>
              {streaming ? (
                <button type="button" className="button ghost" onClick={p.onCancelStream}>
                  Cancel stream
                </button>
              ) : (
                <button type="button" className="button ghost" onClick={p.onStream} disabled={p.loading}>
                  Stream
                </button>
              )}
              <button type="button" className="button" onClick={() => p.onRun()} disabled={p.loading}>
                {p.loading ? <span className="spinner" /> : null}
                Run <span className="kbd">⌘↵</span>
              </button>
            </div>
          </div>
          <div className="preset-row">
            {presets.map((pr) => (
              <button key={pr.label} type="button" className="chip" onClick={() => void applyPreset(pr)}>
                {pr.label}
              </button>
            ))}
          </div>
          <SqlEditor
            value={p.sql}
            onChange={p.onSqlChange}
            onRun={() => p.onRun()}
            footer={
              <>
                <span>{p.sql.split("\n").length} lines</span>
                <span>Ctrl/⌘ + Enter to run · Tab to indent</span>
              </>
            }
          />
          {p.error ? <p className="error">{p.error}</p> : null}
          {p.plan ? (
            <>
              <p className="status-title" style={{ marginTop: 14 }}>
                Query plan
              </p>
              <pre className="plan">{p.plan}</pre>
            </>
          ) : null}
        </section>

        {p.streamState.status !== "idle" ? (
          <section className="card fade-in">
            <div className="card-header">
              <h2>Streamed results</h2>
              {p.streamState.status === "streaming" ? (
                <span className="pill warn">
                  streaming · {p.streamState.rowCount} rows
                </span>
              ) : p.streamState.status === "complete" ? (
                <span className="pill ok">
                  {p.streamState.rowCount.toLocaleString()} rows in {formatDuration(p.streamState.durationMs)}
                </span>
              ) : (
                <span className="pill bad">Error</span>
              )}
            </div>
            {p.streamState.status === "error" ? (
              <p className="error">{p.streamState.message}</p>
            ) : p.streamState.columns.length ? (
              <DataTable columns={p.streamState.columns} rows={p.streamState.rows} maxRows={200} />
            ) : null}
          </section>
        ) : null}

        <section className="card">
          <div className="card-header">
            <div className="segmented" role="tablist" aria-label="Result view">
              <button type="button" className={view === "table" ? "active" : ""} onClick={() => setView("table")} disabled={!r}>
                Table
              </button>
              <button type="button" className={view === "chart" ? "active" : ""} onClick={() => setView("chart")} disabled={!r}>
                Chart
              </button>
              <button type="button" className={view === "cube" ? "active" : ""} onClick={() => setView("cube")} disabled={!pivot}>
                Cube
              </button>
            </div>
            <div className="button-row">
              <button type="button" className="button ghost" onClick={p.onSnapshot} disabled={!r}>
                Snapshot
              </button>
              <button type="button" className="button ghost" onClick={p.onExport} disabled={!r || p.loading}>
                CSV
              </button>
              {r?.nextUri ? (
                <button type="button" className="button ghost" onClick={p.onLoadMore} disabled={p.loading}>
                  Load more
                </button>
              ) : null}
            </div>
          </div>
          {r ? (
            <>
              <div className="meta-row">
                <span className="pill">{(r.rowCount ?? r.rows.length).toLocaleString()} rows</span>
                <span className="pill">{r.columns.length} columns</span>
                <span className="pill">{formatDuration(r.durationMs ?? 0)}</span>
                <span className={r.cacheHit ? "pill ok" : "pill accent"}>{r.cacheHit ? "cache hit" : "live query"}</span>
                {r.maskColumns?.length ? (
                  <span className="pill warn">masked: {r.maskColumns.join(", ")}</span>
                ) : null}
              </div>
              {view === "cube" && pivot ? (
                <ResultCube columns={r.columns} rows={r.rows} theme={p.theme} />
              ) : view === "chart" ? (
                <AutoChart columns={r.columns} rows={r.rows} />
              ) : (
                <DataTable columns={r.columns} rows={r.rows} maskColumns={r.maskColumns} />
              )}
            </>
          ) : (
            <div className="empty-state">
              <p className="status-title">No result yet</p>
              <p>Pick a preset above, build one from the semantic model, or write SQL directly.</p>
              <button type="button" className="button" onClick={() => p.onRun()}>
                Run current query
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default ExploreView;
