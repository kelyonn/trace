import { useEffect, useMemo, useState } from "react";
import type { Column, SemanticCube, SemanticModel } from "@trace/shared-types";
import type { Requester, QueryPayload } from "../lib/api";
import type { StreamState } from "../hooks/useQueryStream";
import { columnKind, formatDuration } from "../lib/format";
import SqlEditor from "../components/SqlEditor";
import DataTable from "../components/DataTable";
import AutoChart, { planChart } from "../components/AutoChart";
import ResultCube, { cubeShape } from "../cube/ResultCube";
import Icon from "../components/Icon";
import { quickQueryTemplates } from "../demo-queries";

const PRESET_LABELS: Record<string, string> = {
  cube_by_status_region: "Cube: status × region",
  cube_by_industry_category: "Cube: industry × category",
  monthly_revenue: "Monthly revenue",
  revenue_by_region: "Revenue by region",
  orders_by_status: "Orders by status",
  top_customers: "Top customers",
  recent_orders: "Recent orders"
};

type View = "table" | "chart" | "cube";

type Props = {
  request: Requester;
  theme: string;
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
  const [tables, setTables] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [columns, setColumns] = useState<Record<string, Column[]>>({});
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [semantic, setSemantic] = useState<SemanticModel | null>(null);
  const [cube, setCube] = useState<SemanticCube | null>(null);
  const [measure, setMeasure] = useState("");
  const [dims, setDims] = useState<string[]>([]);
  const [builderTab, setBuilderTab] = useState<"semantic" | "visual">("semantic");
  const [vbTable, setVbTable] = useState<string>("");
  const [vbCols, setVbCols] = useState<string[]>([]);
  const [vbLimit, setVbLimit] = useState(50);
  const [view, setView] = useState<View>("table");

  useEffect(() => {
    p.request<{ tables: string[] }>("/schema")
      .then((r) => setTables(r.tables ?? []))
      .catch((err) => setSchemaError(err instanceof Error ? err.message : "Schema fetch failed"));
    p.request<SemanticModel>("/semantic")
      .then((m) => {
        setSemantic(m);
        if (m.cubes?.length) {
          setCube(m.cubes[0]);
          setMeasure(m.cubes[0].measures[0]?.name ?? "");
        }
      })
      .catch(() => undefined);
  }, [p.request]);

  const loadColumns = async (table: string) => {
    if (columns[table]) return columns[table];
    try {
      const r = await p.request<{ columns: Column[] }>(`/schema?table=${encodeURIComponent(table)}`);
      setColumns((prev) => ({ ...prev, [table]: r.columns ?? [] }));
      return r.columns ?? [];
    } catch (err) {
      setSchemaError(err instanceof Error ? err.message : "Column fetch failed");
      return [];
    }
  };

  const toggleTable = (t: string) => {
    setOpen((prev) => (prev === t ? null : t));
    void loadColumns(t);
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

  const buildSemantic = () => {
    if (!cube) return;
    const m = cube.measures.find((x) => x.name === measure);
    if (!m) return;
    const fn = { sum: "SUM", count: "COUNT", avg: "AVG", min: "MIN", max: "MAX", count_distinct: "COUNT" }[m.type] ?? "SUM";
    const expr = m.type === "count_distinct" ? `COUNT(DISTINCT ${m.sql}) AS ${m.name}` : `${fn}(${m.sql}) AS ${m.name}`;
    const sql = dims.length
      ? `SELECT ${dims.join(", ")}, ${expr}\nFROM ${cube.name}\nGROUP BY ${dims.map((_, i) => i + 1).join(", ")}\nORDER BY ${dims.length + 1} DESC`
      : `SELECT ${expr}\nFROM ${cube.name}`;
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
                        <span className="type">{c.type}</span>
                      </button>
                    ))}
                    <button
                      type="button"
                      className="tree-col"
                      style={{ color: "var(--accent-strong)", fontFamily: "var(--font-sans)" }}
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
            semantic && cube ? (
              <div className="builder">
                <label>
                  Cube
                  <select
                    value={cube.name}
                    onChange={(e) => {
                      const c = semantic.cubes.find((x) => x.name === e.target.value) ?? null;
                      setCube(c);
                      setMeasure(c?.measures[0]?.name ?? "");
                      setDims([]);
                    }}
                  >
                    {semantic.cubes.map((c) => (
                      <option key={c.name}>{c.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Measure
                  <select value={measure} onChange={(e) => setMeasure(e.target.value)}>
                    {cube.measures.map((m) => (
                      <option key={m.name} value={m.name}>
                        {m.name} · {m.type}
                      </option>
                    ))}
                  </select>
                </label>
                <div>
                  <p className="status-title" style={{ fontSize: 12.5, marginBottom: 6 }}>
                    Dimensions
                  </p>
                  <div className="chip-group">
                    {cube.dimensions.map((d) => (
                      <button
                        key={d.name}
                        type="button"
                        title={d.description}
                        className={dims.includes(d.name) ? "chip on" : "chip"}
                        onClick={() => setDims((prev) => (prev.includes(d.name) ? prev.filter((x) => x !== d.name) : [...prev, d.name]))}
                      >
                        {d.name}
                      </button>
                    ))}
                  </div>
                </div>
                <button type="button" className="button ghost" onClick={buildSemantic}>
                  Generate SQL
                </button>
              </div>
            ) : (
              <p className="muted">Semantic model unavailable.</p>
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
            {Object.keys(PRESET_LABELS)
              .filter((k) => quickQueryTemplates[k])
              .map((k) => (
                <button
                  key={k}
                  type="button"
                  className={p.sql === quickQueryTemplates[k] ? "chip on" : "chip"}
                  onClick={() => p.onSqlChange(quickQueryTemplates[k])}
                >
                  {PRESET_LABELS[k]}
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
