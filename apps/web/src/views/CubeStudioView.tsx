import { useEffect, useMemo, useState } from "react";
import type { Requester, QueryPayload } from "../lib/api";
import {
  buildCubeSql,
  dim,
  drillInto,
  DIMENSIONS,
  measure as getMeasure,
  MEASURES,
  type CubeState,
  type DimensionKey,
  type MeasureKey
} from "../cube/model";
import { detectPivot } from "../cube/pivot";
import CubeViewer from "../cube/CubeViewer";
import { formatCompact, formatCurrency, formatDuration } from "../lib/format";
import Icon from "../components/Icon";
import { tokenizeSql } from "../components/SqlEditor";

type Props = {
  request: Requester;
  theme: string;
  state: CubeState;
  onStateChange: (s: CubeState) => void;
  onOpenSql: (sql: string) => void;
};

const groups = [...new Set(DIMENSIONS.map((d) => d.group))];

const DimSelect = ({
  value,
  exclude,
  onChange,
  label
}: {
  value: DimensionKey;
  exclude: DimensionKey;
  onChange: (k: DimensionKey) => void;
  label: string;
}) => (
  <label>
    {label}
    <select value={value} onChange={(e) => onChange(e.target.value as DimensionKey)}>
      {groups.map((g) => (
        <optgroup key={g} label={g}>
          {DIMENSIONS.filter((d) => d.group === g).map((d) => (
            <option key={d.key} value={d.key} disabled={d.key === exclude}>
              {d.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  </label>
);

const CubeStudioView = ({ request, theme, state, onStateChange, onOpenSql }: Props) => {
  const [result, setResult] = useState<QueryPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [trail, setTrail] = useState<CubeState[]>([]);
  const sql = useMemo(() => buildCubeSql(state), [state]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    request<QueryPayload>("/query", { body: { sql } })
      .then((res) => {
        if (!cancelled) setResult(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Query failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sql, request]);

  const pivot = useMemo(() => (result ? detectPivot(result.columns, result.rows) : null), [result]);
  const m = getMeasure(state.measure);
  const fmt = (n: number) => (m.money ? formatCurrency(n) : formatCompact(n));

  const ranked = useMemo(() => {
    if (!result) return [];
    return [...result.rows]
      .sort((a, b) => Number(b[2]) - Number(a[2]))
      .slice(0, 6)
      .map((r) => ({ row: String(r[0]), col: String(r[1]), value: Number(r[2]) }));
  }, [result]);
  const total = useMemo(() => (result ? result.rows.reduce((a, r) => a + (Number(r[2]) || 0), 0) : 0), [result]);

  const update = (patch: Partial<CubeState>) => onStateChange({ ...state, ...patch });

  const drill = (row: string, col: string) => {
    setTrail((t) => [...t, state]);
    onStateChange(drillInto(state, row, col));
  };

  const back = () => {
    const prev = trail[trail.length - 1];
    if (!prev) return;
    setTrail(trail.slice(0, -1));
    onStateChange(prev);
  };

  return (
    <div className="studio">
      <aside className="studio-side">
        <section className="card">
          <div className="card-header">
            <h2>Cube definition</h2>
            {loading ? <span className="spinner" /> : null}
          </div>
          <div className="builder">
            <label>
              Measure
              <select value={state.measure} onChange={(e) => update({ measure: e.target.value as MeasureKey })}>
                {MEASURES.map((mm) => (
                  <option key={mm.key} value={mm.key}>
                    {mm.label}
                  </option>
                ))}
              </select>
            </label>
            <DimSelect label="Rows (x-axis)" value={state.rows} exclude={state.cols} onChange={(k) => update({ rows: k })} />
            <DimSelect label="Columns (z-axis)" value={state.cols} exclude={state.rows} onChange={(k) => update({ cols: k })} />
            <button
              type="button"
              className="button ghost"
              onClick={() => update({ rows: state.cols, cols: state.rows })}
            >
              <Icon name="rotate" /> Swap axes
            </button>
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <h2>Slice filters</h2>
            {state.filters.length ? (
              <button
                type="button"
                className="button subtle"
                onClick={() => {
                  setTrail([]);
                  update({ filters: [] });
                }}
              >
                Clear
              </button>
            ) : null}
          </div>
          {state.filters.length ? (
            <div className="chip-group">
              {state.filters.map((f) => (
                <button
                  key={`${f.dim}-${f.value}`}
                  type="button"
                  className="chip on"
                  title="Remove filter"
                  onClick={() => update({ filters: state.filters.filter((x) => x !== f) })}
                >
                  {dim(f.dim).label}: {f.value} <Icon name="x" />
                </button>
              ))}
            </div>
          ) : (
            <p className="muted" style={{ fontSize: 13 }}>
              No filters. Click any bar to drill — both coordinates become filters and each axis steps down its
              hierarchy (region → industry → customer, category → SKU, year → quarter → month).
            </p>
          )}
          {trail.length ? (
            <button type="button" className="button ghost" style={{ marginTop: 12 }} onClick={back}>
              <Icon name="history" /> Back up one level
            </button>
          ) : null}
        </section>

        <section className="card">
          <div className="card-header">
            <h2>Top cells</h2>
            <span className="muted" style={{ fontSize: 12 }}>
              of {fmt(total)}
            </span>
          </div>
          {ranked.length ? (
            <div className="timeline">
              {ranked.map((r) => (
                <button
                  key={`${r.row}-${r.col}`}
                  type="button"
                  className="history-item"
                  style={{ marginBottom: 6 }}
                  onClick={() => drill(r.row, r.col)}
                >
                  <div>
                    <p className="status-title" style={{ fontSize: 13 }}>
                      {r.row} · {r.col}
                    </p>
                    <p className="history-meta">{((r.value / (total || 1)) * 100).toFixed(1)}% of slice</p>
                  </div>
                  <b className="tabular">{fmt(r.value)}</b>
                </button>
              ))}
            </div>
          ) : (
            <p className="muted">No data.</p>
          )}
        </section>
      </aside>

      <div style={{ display: "grid", gap: 16, minWidth: 0 }}>
        <section className="card">
          {error ? <p className="error">{error}</p> : null}
          {pivot ? (
            <CubeViewer pivot={pivot} theme={theme} onDrill={drill} valueFormat={fmt} tall />
          ) : loading ? (
            <div className="skeleton" style={{ height: 520 }} />
          ) : (
            <div className="empty-state">
              <Icon name="cube" />
              <p className="status-title">Nothing to render</p>
              <p>This slice has no rows. Remove a filter or pick different axes.</p>
            </div>
          )}
          {result ? (
            <div className="meta-row" style={{ marginTop: 12, marginBottom: 0 }}>
              <span className="pill">{result.rowCount ?? result.rows.length} cells</span>
              <span className="pill">{formatDuration(result.durationMs ?? 0)}</span>
              <span className={result.cacheHit ? "pill ok" : "pill accent"}>{result.cacheHit ? "cache hit" : "live pushdown"}</span>
            </div>
          ) : null}
        </section>

        <section className="card">
          <div className="card-header">
            <div>
              <h2>Generated SQL</h2>
              <p className="card-sub">Pushed down to the active source — identical on Trino and Postgres</p>
            </div>
            <button type="button" className="button ghost" onClick={() => onOpenSql(sql)}>
              <Icon name="explore" /> Open in Explore
            </button>
          </div>
          <pre className="plan" style={{ marginTop: 0, whiteSpace: "pre-wrap" }}>
            {tokenizeSql(sql).map((t, i) =>
              t.cls ? (
                <span key={i} className={t.cls}>
                  {t.text}
                </span>
              ) : (
                t.text
              )
            )}
          </pre>
        </section>
      </div>
    </div>
  );
};

export default CubeStudioView;
