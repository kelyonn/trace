import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Requester } from "../lib/api";
import {
  AXES,
  OTHER,
  buildGrid,
  canDrill,
  canRollUp,
  collapse,
  drillAxis,
  olapRequest,
  pivotAxes,
  rollUpAxis,
  setAxisDim,
  type AxisKey,
  type OlapState
} from "../cube/olap";
import { aggregate, groupedDims, measureFormatter, type AggregateResult, type AutoModel } from "../lib/model";
import CubeScene, { type CameraPreset, type Cell, type Slice } from "../cube/CubeScene";
import { formatDuration, formatNumber } from "../lib/format";
import { tokenizeSql } from "../components/SqlEditor";
import Icon from "../components/Icon";

type Props = {
  request: Requester;
  theme: string;
  model: AutoModel;
  state: OlapState;
  onStateChange: (s: OlapState) => void;
  onFactChange: (table: string) => void;
  onOpenSql: (sql: string) => void;
};

const AXIS_NAME: Record<AxisKey, string> = { x: "X", y: "Y", z: "Z" };

const CubeExplorerView = ({ request, theme, model, state, onStateChange, onFactChange, onOpenSql }: Props) => {
  const [result, setResult] = useState<AggregateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hidden, setHidden] = useState<Record<AxisKey, Set<string>>>({ x: new Set(), y: new Set(), z: new Set() });
  const [slice, setSlice] = useState<Slice>(null);
  const [playing, setPlaying] = useState(false);
  const [hover, setHover] = useState<Partial<Cell> | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<Cell | null>(null);
  const [preset, setPreset] = useState<{ name: CameraPreset; nonce: number }>({ name: "iso", nonce: 0 });
  const [autoRotate, setAutoRotate] = useState(false);
  const [showSql, setShowSql] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const dimOf = useCallback((key: string) => model.dimensions.find((d) => d.key === key), [model]);
  const reqKey = useMemo(() => JSON.stringify(olapRequest(state)), [state]);
  const sql = result?.sql ?? "";
  const m = model.measures.find((x) => x.key === state.measure) ?? model.measures[0];
  const fmt = useMemo(() => measureFormatter(m), [m]);
  const fmtFull = useMemo(() => measureFormatter(m, false), [m]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    aggregate(request, JSON.parse(reqKey))
      .then((r) => !cancelled && setResult(r))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Query failed"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [reqKey, request]);

  // Reset client-side slice/dice/selection whenever the server cube changes shape.
  useEffect(() => {
    setHidden({ x: new Set(), y: new Set(), z: new Set() });
    setSlice(null);
    setSelected(null);
    setPlaying(false);
  }, [reqKey]);

  const grid = useMemo(() => {
    if (!result) return null;
    return buildGrid(result.rows, {
      x: dimOf(state.x.dim)?.kind === "time",
      y: dimOf(state.y.dim)?.kind === "time",
      z: dimOf(state.z.dim)?.kind === "time"
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const visible = useMemo(() => {
    const v = {} as Record<AxisKey, boolean[]>;
    for (const k of AXES) v[k] = grid ? grid.members[k].map((mm) => !hidden[k].has(mm.key)) : [];
    return v;
  }, [grid, hidden]);

  const titles = useMemo(
    () => Object.fromEntries(AXES.map((k) => [k, dimOf(state[k].dim)?.label ?? state[k].dim])) as Record<AxisKey, string>,
    [state, dimOf]
  );

  // Slice playback: sweep the slice plane through members of its axis.
  useEffect(() => {
    if (!playing || !slice || !grid) return;
    const t = setInterval(() => {
      setSlice((s) => {
        if (!s) return s;
        const n = grid.members[s.axis].length;
        let i = s.index;
        for (let step = 0; step < n; step++) {
          i = (i + 1) % n;
          if (visible[s.axis][i]) break;
        }
        return { ...s, index: i };
      });
    }, 1100);
    return () => clearInterval(t);
  }, [playing, slice?.axis, grid, visible]);

  const value = (c: Cell | null) => (c && grid ? grid.values[c.x]?.[c.y]?.[c.z] ?? null : null);

  const drillCell = (c: Cell) => {
    if (!grid) return;
    let next = state;
    let changed = false;
    for (const k of AXES) {
      const member = grid.members[k][c[k]];
      if (member.key !== OTHER && canDrill(model, next[k])) {
        next = drillAxis(next, model, k, member.key);
        changed = true;
      }
    }
    if (changed) onStateChange(next);
  };

  const onLabel = (axis: AxisKey, index: number, mode: "slice" | "dice") => {
    if (!grid) return;
    if (mode === "dice") {
      const key = grid.members[axis][index].key;
      setHidden((h) => {
        const next = new Set(h[axis]);
        if (next.has(key)) next.delete(key);
        else if (visible[axis].filter(Boolean).length > 1) next.add(key);
        return { ...h, [axis]: next };
      });
      return;
    }
    setSlice((s) => (s && s.axis === axis && s.index === index ? null : { axis, index }));
  };

  // Keyboard navigation over the cube.
  const onKeyDown = (e: KeyboardEvent) => {
    if (!grid || e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === "SELECT" || tag === "INPUT" || tag === "TEXTAREA") return;
    const move = (axis: AxisKey, dir: number) => {
      const n = grid.members[axis].length;
      const base: Cell = selected ?? { x: 0, y: 0, z: 0 };
      let i = base[axis];
      for (let step = 0; step < n; step++) {
        i = (i + dir + n) % n;
        if (visible[axis][i]) break;
      }
      const next = { ...base, [axis]: i };
      setSelected(next);
      setHover(next);
    };
    const keymap: Record<string, () => void> = {
      ArrowRight: () => move("x", 1),
      ArrowLeft: () => move("x", -1),
      ArrowUp: () => move("y", 1),
      ArrowDown: () => move("y", -1),
      "]": () => move("z", 1),
      "[": () => move("z", -1),
      Enter: () => selected && drillCell(selected),
      Escape: () => (selected ? setSelected(null) : setSlice(null)),
      p: () => onStateChange(pivotAxes(state)),
      "1": () => setPreset((p) => ({ name: "iso", nonce: p.nonce + 1 })),
      "2": () => setPreset((p) => ({ name: "front", nonce: p.nonce + 1 })),
      "3": () => setPreset((p) => ({ name: "top", nonce: p.nonce + 1 })),
      "4": () => setPreset((p) => ({ name: "side", nonce: p.nonce + 1 }))
    };
    const fn = keymap[e.key];
    if (fn) {
      e.preventDefault();
      fn();
    }
  };

  const keyRef = useRef(onKeyDown);
  keyRef.current = onKeyDown;
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const table = useMemo(() => (grid ? collapse(grid, visible, slice) : null), [grid, visible, slice]);
  const tableMax = useMemo(() => (table ? Math.max(1, ...table.flat()) : 1), [table]);

  const ranked = useMemo(() => {
    if (!grid) return [];
    const out: { c: Cell; v: number }[] = [];
    grid.values.forEach((plane, x) =>
      plane.forEach((row, y) =>
        row.forEach((v, z) => {
          if (v === null || !visible.x[x] || !visible.y[y] || !visible.z[z]) return;
          if (slice && [x, y, z][AXES.indexOf(slice.axis)] !== slice.index) return;
          out.push({ c: { x, y, z }, v });
        })
      )
    );
    return out.sort((a, b) => b.v - a.v);
  }, [grid, visible, slice]);
  // "Other" buckets aggregate many members, so they are left out of the largest-cells list.
  const rankedMembers = useMemo(
    () => (grid ? ranked.filter((r) => AXES.every((k) => grid.members[k][r.c[k]]?.key !== OTHER)) : []),
    [ranked, grid]
  );
  const visibleTotal = ranked.reduce((a, r) => a + r.v, 0);

  const sel = selected && grid ? { c: selected, v: value(selected) } : null;
  const hov = hover && grid && hover.x !== undefined && hover.y !== undefined && hover.z !== undefined ? (hover as Cell) : null;

  const memberName = (k: AxisKey, i: number | undefined) => (grid && i !== undefined ? grid.members[k][i]?.label : "");
  const tooltipCell = hov && tip ? hov : null;

  return (
    <div className="olap">
      {/* ---------------- Axis rail ---------------- */}
      <aside className="olap-rail">
        <div className="rail-section">
          <div className="section-label">Measure</div>
          <select value={state.measure} onChange={(e) => onStateChange({ ...state, measure: e.target.value })}>
            {model.measures.map((mm) => (
              <option key={mm.key} value={mm.key}>
                {mm.label}
              </option>
            ))}
          </select>
          {model.factCandidates.length > 1 ? (
            <>
              <div className="section-label" style={{ marginTop: 4 }}>
                Fact table
              </div>
              <select value={model.fact.table} onChange={(e) => onFactChange(e.target.value)}>
                {model.factCandidates.map((f) => (
                  <option key={f.table} value={f.table}>
                    {f.table}
                    {f.rowCount !== null ? ` · ${formatNumber(f.rowCount)} rows` : ""}
                  </option>
                ))}
              </select>
            </>
          ) : null}
        </div>

        {AXES.map((k) => {
          const a = state[k];
          const current = dimOf(a.dim);
          const future: string[] = [];
          let nx = current?.next ?? null;
          while (nx && future.length < 4) {
            future.push(dimOf(nx)?.label ?? nx);
            nx = dimOf(nx)?.next ?? null;
          }
          const hiddenCount = hidden[k].size;
          return (
            <div className="rail-section" key={k}>
              <div className="axis-head">
                <span className={`axis-chip axis-${k}`}>{AXIS_NAME[k]}</span>
                <select
                  value={a.pins[0]?.dim ?? a.dim}
                  aria-label={`${AXIS_NAME[k]} axis dimension`}
                  onChange={(e) => onStateChange(setAxisDim(state, k, e.target.value))}
                >
                  {groupedDims(model).map((g) => (
                    <optgroup key={g.label} label={g.label}>
                      {g.dims.map((d) => (
                        <option key={d.key} value={d.key}>
                          {d.label}
                          {d.cardinality && d.kind === "category" ? ` (${d.cardinality})` : ""}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div className="level-path">
                {a.pins.map((p, i) => (
                  <span key={`${p.dim}-${i}`} className="level-step">
                    {i > 0 ? <span className="sep">/</span> : null}
                    <button
                      type="button"
                      className="level"
                      title={`Roll up to ${dimOf(p.dim)?.label ?? p.dim}`}
                      onClick={() => {
                        let next = state;
                        while (next[k].pins.length > i) next = rollUpAxis(next, k);
                        onStateChange(next);
                      }}
                    >
                      {p.value}
                    </button>
                  </span>
                ))}
                <span className="level-step">
                  {a.pins.length ? <span className="sep">/</span> : null}
                  <span className="level active">{current?.label ?? a.dim}</span>
                </span>
                {future.map((f) => (
                  <span key={f} className="level-step">
                    <span className="sep">/</span>
                    <span className="level future">{f}</span>
                  </span>
                ))}
              </div>
              <div className="axis-actions">
                <button type="button" className="btn" disabled={!canRollUp(a)} onClick={() => onStateChange(rollUpAxis(state, k))}>
                  Roll up
                </button>
                <span className="muted small">
                  {grid ? `${visible[k].filter(Boolean).length}/${grid.members[k].length} members` : ""}
                  {hiddenCount ? (
                    <>
                      {" · "}
                      <button type="button" className="link" onClick={() => setHidden((hh) => ({ ...hh, [k]: new Set() }))}>
                        show {hiddenCount} hidden
                      </button>
                    </>
                  ) : null}
                </span>
              </div>
            </div>
          );
        })}

        <div className="rail-section">
          <div className="button-row">
            <button type="button" className="btn" onClick={() => onStateChange(pivotAxes(state))} title="Rotate axis bindings (P)">
              <Icon name="rotate" /> Pivot axes
            </button>
          </div>
        </div>

        <div className="rail-section help">
          <div className="section-label">Interactions</div>
          <dl className="keys">
            <dt>Click cell</dt>
            <dd>select · inspect</dd>
            <dt>Double-click</dt>
            <dd>drill into cell</dd>
            <dt>Click label</dt>
            <dd>slice on member</dd>
            <dt>⇧ Click label</dt>
            <dd>dice (hide) member</dd>
            <dt>← → ↑ ↓ [ ]</dt>
            <dd>move selection</dd>
            <dt>Enter / Esc</dt>
            <dd>drill / clear</dd>
            <dt>1–4 · P</dt>
            <dd>camera · pivot</dd>
          </dl>
        </div>
      </aside>

      {/* ---------------- Stage ---------------- */}
      <section className="olap-stage">
        <div className="stage-toolbar">
          <div className="seg" role="group" aria-label="Camera">
            {(["iso", "front", "top", "side"] as CameraPreset[]).map((p, i) => (
              <button
                key={p}
                type="button"
                className={preset.name === p ? "on" : ""}
                title={`${p} view (${i + 1})`}
                onClick={() => setPreset((s) => ({ name: p, nonce: s.nonce + 1 }))}
              >
                {p === "iso" ? "Iso" : p === "front" ? "X·Y" : p === "top" ? "X·Z" : "Z·Y"}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={autoRotate ? "btn on" : "btn"}
            aria-pressed={autoRotate}
            onClick={() => setAutoRotate((v) => !v)}
          >
            Orbit
          </button>
          <span className="toolbar-sep" />
          <span className="section-label inline">Slice</span>
          <div className="seg" role="group" aria-label="Slice axis">
            <button type="button" className={!slice ? "on" : ""} onClick={() => (setSlice(null), setPlaying(false))}>
              Off
            </button>
            {AXES.map((k) => (
              <button
                key={k}
                type="button"
                className={slice?.axis === k ? "on" : ""}
                onClick={() =>
                  setSlice(() => {
                    const first = visible[k].findIndex(Boolean);
                    return { axis: k, index: Math.max(0, first) };
                  })
                }
              >
                {AXIS_NAME[k]}
              </button>
            ))}
          </div>
          {slice && grid ? (
            <div className="scrubber">
              <button
                type="button"
                className="btn icon"
                aria-label={playing ? "Pause slice sweep" : "Play slice sweep"}
                onClick={() => setPlaying((p) => !p)}
              >
                <Icon name={playing ? "stop" : "play"} />
              </button>
              <input
                type="range"
                min={0}
                max={grid.members[slice.axis].length - 1}
                value={slice.index}
                onChange={(e) => setSlice({ axis: slice.axis, index: Number(e.target.value) })}
                aria-label="Slice member"
              />
              <span className="scrub-label">{grid.members[slice.axis][slice.index]?.label}</span>
            </div>
          ) : null}
          <span className="toolbar-fill" />
          {loading ? <span className="spinner" /> : null}
          <button type="button" className={showSql ? "btn on" : "btn"} onClick={() => setShowSql((v) => !v)}>
            SQL
          </button>
        </div>

        <div className="stage-canvas" ref={stageRef}>
          {error ? <p className="error" style={{ margin: 16 }}>{error}</p> : null}
          {grid && grid.cellCount > 0 ? (
            <CubeScene
              grid={grid}
              visible={visible}
              slice={slice}
              hover={hover}
              selected={selected}
              axisTitles={titles}
              theme={theme}
              preset={preset}
              autoRotate={autoRotate}
              valueFormat={fmt}
              onHover={(c, client) => {
                setHover(c);
                if (c && client && stageRef.current) {
                  const r = stageRef.current.getBoundingClientRect();
                  setTip({ x: client.x - r.left, y: client.y - r.top });
                } else setTip(null);
              }}
              onSelect={setSelected}
              onDrill={drillCell}
              onLabel={onLabel}
            />
          ) : !loading && grid ? (
            <div className="empty-state">
              <p className="status-title">This slice is empty</p>
              <p>Roll an axis up or choose another hierarchy.</p>
            </div>
          ) : null}
          {tooltipCell && tip && grid ? (
            <div className="scene-tip" style={{ left: tip.x, top: tip.y }}>
              <div className="tip-coords">
                <span><i className="axis-dot axis-x" />{memberName("x", tooltipCell.x)}</span>
                <span><i className="axis-dot axis-y" />{memberName("y", tooltipCell.y)}</span>
                <span><i className="axis-dot axis-z" />{memberName("z", tooltipCell.z)}</span>
              </div>
              <div className="tip-value">
                {m.label} <b>{fmtFull(value(tooltipCell) ?? 0)}</b>
              </div>
            </div>
          ) : null}
          {grid ? (
            <div className="scene-legend">
              <span>{m.label}</span>
              <span className="ramp" />
              <span className="mono">
                {fmt(Math.min(0, grid.min))} – {fmt(grid.max)}
              </span>
              <span className="muted">size &amp; color ∝ √value</span>
            </div>
          ) : null}
        </div>

        <div className="stage-status mono">
          <span>{grid ? `${grid.cellCount} cells` : "—"}</span>
          <span>
            {grid ? `${grid.members.x.length}×${grid.members.y.length}×${grid.members.z.length}` : ""}
          </span>
          <span>{result ? formatDuration(result.durationMs ?? 0) : ""}</span>
          <span>{result ? (result.cacheHit ? "cache" : "pushdown") : ""}</span>
          <span className="toolbar-fill" />
          <span>Σ visible {fmt(visibleTotal)}</span>
        </div>

        {showSql && sql ? (
          <div className="stage-sql">
            <pre>
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
            <button type="button" className="btn" onClick={() => onOpenSql(sql)}>
              Open in Explore
            </button>
          </div>
        ) : null}

        {/* Linked pivot table: X × Y, summed over Z (or the current slice). */}
        {grid && table ? (
          <div className="pivot">
            <div className="pivot-head">
              <span className="section-label inline">
                {titles.x} × {titles.y}
              </span>
              <span className="muted small">
                {slice ? `slice ${AXIS_NAME[slice.axis]} = ${grid.members[slice.axis][slice.index]?.label}` : `Σ over ${titles.z}`}
              </span>
            </div>
            <div className="pivot-scroll">
              <table className="pivot-table">
                <thead>
                  <tr>
                    <th />
                    {grid.members.y.map((mm, yi) =>
                      visible.y[yi] ? (
                        <th key={mm.key} className={hover?.y === yi || selected?.y === yi ? "hot num" : "num"}>
                          {mm.label}
                        </th>
                      ) : null
                    )}
                  </tr>
                </thead>
                <tbody>
                  {grid.members.x.map((mm, xi) =>
                    visible.x[xi] ? (
                      <tr key={mm.key}>
                        <th className={hover?.x === xi || selected?.x === xi ? "hot" : undefined}>{mm.label}</th>
                        {grid.members.y.map((my, yi) => {
                          if (!visible.y[yi]) return null;
                          const v = table[xi][yi];
                          const isHot = hover?.x === xi && hover?.y === yi;
                          const isSel = selected?.x === xi && selected?.y === yi;
                          return (
                            <td
                              key={my.key}
                              className={`num${isHot ? " hot" : ""}${isSel ? " sel" : ""}`}
                              style={{ ["--fill" as string]: `${(v / tableMax) * 100}%` }}
                              onMouseEnter={() => setHover({ x: xi, y: yi })}
                              onMouseLeave={() => setHover(null)}
                              onClick={() => {
                                // Select the strongest visible Z cell in this pillar.
                                let best = -1;
                                let bestV = -Infinity;
                                grid.members.z.forEach((_, zi) => {
                                  const cv = grid.values[xi][yi][zi];
                                  if (!visible.z[zi] || cv === null) return;
                                  if (slice?.axis === "z" && slice.index !== zi) return;
                                  if (cv > bestV) {
                                    bestV = cv;
                                    best = zi;
                                  }
                                });
                                if (best >= 0) setSelected({ x: xi, y: yi, z: best });
                              }}
                            >
                              {v ? fmt(v) : "·"}
                            </td>
                          );
                        })}
                      </tr>
                    ) : null
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </section>

      {/* ---------------- Inspector ---------------- */}
      <aside className="olap-inspector">
        {sel && grid ? (
          <>
            <div className="section-label">Selected cell</div>
            <div className="coords">
              {AXES.map((k) => (
                <div className="coord" key={k}>
                  <span className={`axis-chip axis-${k}`}>{AXIS_NAME[k]}</span>
                  <span className="coord-dim">{titles[k]}</span>
                  <span className="coord-val">{grid.members[k][sel.c[k]].label}</span>
                </div>
              ))}
            </div>
            <div className="big-number mono">{sel.v === null ? "—" : fmtFull(sel.v)}</div>
            <div className="muted small">{m.label}</div>
            {sel.v !== null ? (
              <table className="facts">
                <tbody>
                  <tr>
                    <th>Share of visible cube</th>
                    <td className="mono">{((sel.v / (visibleTotal || 1)) * 100).toFixed(2)}%</td>
                  </tr>
                  {AXES.map((k) => (
                    <tr key={k}>
                      <th>Share of {grid.members[k][sel.c[k]].label}</th>
                      <td className="mono">{(((sel.v ?? 0) / (grid.members[k][sel.c[k]].total || 1)) * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
                  <tr>
                    <th>Rank in view</th>
                    <td className="mono">
                      {(() => {
                        const i = ranked.findIndex((r) => r.c.x === sel.c.x && r.c.y === sel.c.y && r.c.z === sel.c.z);
                        return i < 0 ? "outside slice" : `${i + 1} of ${ranked.length}`;
                      })()}
                    </td>
                  </tr>
                </tbody>
              </table>
            ) : null}
            <div className="section-label">Operations</div>
            <div className="ops">
              <button type="button" className="btn primary" onClick={() => drillCell(sel.c)}>
                Drill into cell
              </button>
              {AXES.map((k) => {
                const mem = grid.members[k][sel.c[k]];
                const ok = canDrill(model, state[k]) && mem.key !== OTHER;
                const next = ok ? dimOf(dimOf(state[k].dim)?.next ?? "")?.label : null;
                return (
                  <button
                    key={`d${k}`}
                    type="button"
                    className="btn"
                    disabled={!ok}
                    onClick={() => onStateChange(drillAxis(state, model, k, mem.key))}
                  >
                    Drill {AXIS_NAME[k]}: {mem.label} → {next ?? "leaf"}
                  </button>
                );
              })}
              {AXES.map((k) => (
                <button
                  key={`s${k}`}
                  type="button"
                  className="btn"
                  onClick={() => setSlice({ axis: k, index: sel.c[k] })}
                >
                  Slice {AXIS_NAME[k]} = {grid.members[k][sel.c[k]].label}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="section-label">Cube</div>
            <div className="big-number mono">{grid ? fmtFull(visibleTotal) : "—"}</div>
            <div className="muted small">
              {m.label} · {AXES.map((k) => titles[k]).join(" × ")}
            </div>
            <div className="section-label">Largest cells</div>
            <ol className="ranked">
              {rankedMembers.slice(0, 8).map((r) => (
                <li key={`${r.c.x}-${r.c.y}-${r.c.z}`}>
                  <button
                    type="button"
                    onMouseEnter={() => setHover(r.c)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => setSelected(r.c)}
                  >
                    <span className="ranked-label">
                      {memberName("x", r.c.x)} · {memberName("y", r.c.y)} · {memberName("z", r.c.z)}
                    </span>
                    <span className="mono">{fmt(r.v)}</span>
                  </button>
                </li>
              ))}
            </ol>
            <p className="muted small" style={{ marginTop: 12 }}>
              Select a cell in the cube or the table to inspect it.
            </p>
          </>
        )}
      </aside>
    </div>
  );
};

export default CubeExplorerView;
