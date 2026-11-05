import { useCallback, useEffect, useMemo, useState } from "react";
import type { Requester } from "../lib/api";
import { formatCompact, formatMonth, formatNumber } from "../lib/format";
import {
  aggregate,
  categoryDims,
  isAdditive,
  measureFormatter,
  monthDim,
  type AggregateResult,
  type AutoModel,
  type ModelDimension,
  type ModelMeasure
} from "../lib/model";
import type { OlapState } from "../cube/olap";
import LineChart from "../components/charts/LineChart";
import BarChart from "../components/charts/BarChart";
import Heatmap from "../components/charts/Heatmap";
import Sparkline from "../components/charts/Sparkline";
import { seriesColor } from "../components/charts/useWidth";

type Props = {
  request: Requester;
  model: AutoModel;
  sourceName: string;
  refreshKey: number;
  onOpenSql: (sql: string) => void;
  onOpenCube: (state?: Partial<OlapState>) => void;
  onFactChange: (table: string) => void;
};

/**
 * An overview generated from the semantic model of whatever source is active:
 * headline measures with trends, the main measure over time split by a coarse
 * dimension, breakdowns, a two-dimension heatmap and the top entities.
 */
function plan(model: AutoModel) {
  const primary = model.measures[0];
  const kpis: ModelMeasure[] = [];
  const push = (m?: ModelMeasure) => m && !kpis.some((k) => k.key === m.key) && kpis.push(m);
  push(primary);
  push(model.measures.find((m) => m.key === "count"));
  push(model.measures.find((m) => m.key.startsWith("distinct:") && /customer|user|client|driver|account|member/i.test(m.key)));
  push(model.measures.find((m) => m.key.startsWith("sum:") && m.key !== primary?.key));
  push(model.measures.find((m) => m.key.startsWith("avg:")));
  model.measures.forEach((m) => kpis.length < 4 && push(m));

  const month = monthDim(model);
  const cats = categoryDims(model);
  const readable = cats.filter((d) => (d.cardinality ?? 99) <= 25 && !d.numeric);
  const series = readable.find((d) => (d.cardinality ?? 99) <= 8) ?? readable[0];
  const breakdowns = readable.filter((d) => d.key !== series?.key).slice(0, 2);
  // Heatmap: two readable dimensions, from different tables when possible.
  const h1 = readable[0];
  const h2 = readable.find((d) => d.group !== h1?.group && d.key !== h1?.key) ?? readable[1];
  // Top entities: the finest-grained text dimension.
  const entity = [...cats].filter((d) => !d.numeric).sort((a, b) => (b.cardinality ?? 0) - (a.cardinality ?? 0))[0];
  return { primary, kpis: kpis.slice(0, 4), month, series, breakdowns, heat: h1 && h2 ? [h1, h2] : null, entity };
}

type Data = {
  monthly?: AggregateResult;
  total?: AggregateResult;
  trend?: AggregateResult;
  breakdowns: (AggregateResult | undefined)[];
  heat?: AggregateResult;
  top?: AggregateResult;
};

const Card = ({
  title,
  sub,
  span,
  action,
  children
}: {
  title: string;
  sub?: string;
  span: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <section className={`card ${span}`}>
    <div className="card-header">
      <div>
        <h2>{title}</h2>
        {sub ? <p className="card-sub">{sub}</p> : null}
      </div>
      {action}
    </div>
    {children}
  </section>
);

const Skeleton = ({ h = 220 }: { h?: number }) => <div className="skeleton" style={{ height: h }} />;

const OverviewView = ({ request, model, sourceName, refreshKey, onOpenSql, onOpenCube, onFactChange }: Props) => {
  const p = useMemo(() => plan(model), [model]);
  const [data, setData] = useState<Data>({ breakdowns: [] });
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const fact = model.fact.table;

  const load = useCallback(async () => {
    if (!p.primary) return;
    setLoading(true);
    setErrors([]);
    const errs: string[] = [];
    const run = (body: Parameters<typeof aggregate>[1]) =>
      aggregate(request, { ...body, fact }).catch((e) => {
        errs.push(e instanceof Error ? e.message : String(e));
        return undefined;
      });
    const kpiKeys = p.kpis.map((k) => k.key);
    const none = Promise.resolve(undefined);
    const [monthly, total, trend, b0, b1, heat, top] = await Promise.all([
      p.month ? run({ dims: [p.month.key], measures: kpiKeys, order: { by: "dim", dir: "asc" } }) : none,
      run({ dims: [], measures: kpiKeys }),
      p.month && p.series ? run({ dims: [p.month.key, p.series.key], measures: [p.primary.key] }) : none,
      p.breakdowns[0]
        ? run({ dims: [p.breakdowns[0].key], measures: [p.primary.key], order: { by: "measure", dir: "desc" }, limit: 14 })
        : none,
      p.breakdowns[1]
        ? run({ dims: [p.breakdowns[1].key], measures: [p.primary.key], order: { by: "measure", dir: "desc" }, limit: 14 })
        : none,
      p.heat ? run({ dims: [p.heat[0].key, p.heat[1].key], measures: [p.primary.key] }) : none,
      p.entity
        ? run({
            dims: [p.entity.key],
            measures: [p.primary.key, ...(p.primary.key !== "count" ? ["count"] : [])],
            order: { by: "measure", dir: "desc" },
            limit: 10
          })
        : none
    ]);
    setData({ monthly, total, trend, breakdowns: [b0, b1], heat, top });
    setErrors([...new Set(errs)]);
    setLoading(false);
  }, [request, p, fact]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const fmtPrimary = useMemo(() => measureFormatter(p.primary), [p.primary]);

  // KPI values: trailing 12 months vs prior 12 for additive measures; latest month vs prior month otherwise.
  const kpis = useMemo(() => {
    const months = (data.monthly?.rows ?? []).filter((r) => r[0] !== "(null)");
    return p.kpis.map((m, i) => {
      const fmt = measureFormatter(m);
      const series = months.map((r) => Number(r[i + 1]) || 0);
      if (months.length >= 2) {
        if (isAdditive(m)) {
          const last = series.slice(-12).reduce((a, b) => a + b, 0);
          const prev = series.slice(-24, -12).reduce((a, b) => a + b, 0);
          return { m, value: fmt(last), now: last, prev: series.length > 12 ? prev : null, foot: "last 12 months", spark: series.slice(-18) };
        }
        const last = series[series.length - 1];
        const prev = series[series.length - 2];
        return { m, value: fmt(last), now: last, prev, foot: `in ${formatMonth(String(months[months.length - 1][0]))}`, spark: series.slice(-18) };
      }
      const v = Number(data.total?.rows[0]?.[i] ?? NaN);
      return { m, value: Number.isFinite(v) ? fmt(v) : null, now: v, prev: null, foot: "all time", spark: null };
    });
  }, [data.monthly, data.total, p.kpis]);

  const period = useMemo(() => {
    const months = (data.monthly?.rows ?? []).map((r) => String(r[0])).filter((m) => m !== "(null)");
    if (!months.length) return null;
    return `${formatMonth(months[Math.max(0, months.length - 12)])} – ${formatMonth(months[months.length - 1])}`;
  }, [data.monthly]);

  const trend = useMemo(() => {
    const rows = (data.trend?.rows ?? []).filter((r) => r[0] !== "(null)");
    if (!rows.length) return null;
    const labels = [...new Set(rows.map((r) => String(r[0])))].sort();
    const idx = new Map(labels.map((l, i) => [l, i]));
    const totals = new Map<string, number>();
    rows.forEach((r) => totals.set(String(r[1]), (totals.get(String(r[1])) ?? 0) + (Number(r[2]) || 0)));
    // Series keep a stable order (by total); beyond 7 they fold into "Other".
    const ordered = [...totals.keys()].sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0));
    const keep = ordered.length > 8 ? ordered.slice(0, 7) : ordered;
    const values = new Map<string, (number | null)[]>();
    for (const r of rows) {
      const name = keep.includes(String(r[1])) ? String(r[1]) : "Other";
      const arr = values.get(name) ?? new Array(labels.length).fill(null);
      const i = idx.get(String(r[0]))!;
      arr[i] = (arr[i] ?? 0) + (Number(r[2]) || 0);
      values.set(name, arr);
    }
    const names = [...keep, ...(values.has("Other") ? ["Other"] : [])];
    return { labels, series: names.map((n, i) => ({ name: n, color: seriesColor(i), values: values.get(n)! })) };
  }, [data.trend]);

  const heat = useMemo(() => {
    if (!data.heat || !p.heat) return null;
    const rows = data.heat.rows;
    const top = (i: number) => {
      const m = new Map<string, number>();
      rows.forEach((r) => m.set(String(r[i]), (m.get(String(r[i])) ?? 0) + (Number(r[2]) || 0)));
      return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k]) => k);
    };
    const rl = top(0);
    const cl = top(1);
    const lookup = new Map(rows.map((r) => [`${String(r[0])}\u0000${String(r[1])}`, Number(r[2]) || 0]));
    const values = rl.map((r) => cl.map((c) => lookup.get(`${r}\u0000${c}`) ?? 0));
    return { rl, cl, values };
  }, [data.heat, p.heat]);

  const cubeFor = (dims: ModelDimension[], filters: { dim: string; value: string }[] = []): Partial<OlapState> => {
    const keys = dims.map((d) => d.key);
    // Drilling into a member: pin it and show the next level on that axis.
    const axes = keys.map((k) => {
      const pin = filters.find((f) => f.dim === k);
      const d = model.dimensions.find((x) => x.key === k);
      return pin && d?.next ? { dim: d.next, pins: [pin] } : { dim: k, pins: [] };
    });
    const time = model.dimensions.find((d) => d.kind === "time" && d.grain === "year");
    const used = new Set(axes.map((a) => a.dim));
    for (const k of [time?.key, model.defaults.x, model.defaults.y, model.defaults.z]) {
      if (axes.length < 3 && k && !used.has(k)) {
        axes.push({ dim: k, pins: [] });
        used.add(k);
      }
    }
    while (axes.length < 3) axes.push({ dim: "__all", pins: [] });
    return { x: axes[0], y: axes[1], z: axes[2], measure: p.primary.key, fact };
  };

  const sqlButton = (r?: AggregateResult) =>
    r ? (
      <button type="button" className="button subtle" onClick={() => onOpenSql(r.sql)}>
        SQL
      </button>
    ) : undefined;

  if (!p.primary) {
    return (
      <div className="page">
        <div className="empty-state">
          <p className="status-title">Nothing to summarize yet</p>
          <p>This source has no measurable tables.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{sourceName}</h1>
          <p>
            Fact table <b className="mono">{fact}</b>
            {model.fact.rowCount !== null ? ` · ${formatNumber(model.fact.rowCount)} rows` : ""} · {model.joins.length} joined
            {model.joins.length === 1 ? " table" : " tables"} · {model.dimensions.length - 1} dimensions ·{" "}
            {model.measures.length} measures
            {period ? ` · trailing twelve months ${period}` : ""}
          </p>
        </div>
        <div className="button-row">
          {model.factCandidates.length > 1 ? (
            <select
              aria-label="Fact table"
              value={fact}
              onChange={(e) => onFactChange(e.target.value)}
              style={{ width: "auto", minWidth: 180 }}
            >
              {model.factCandidates.map((f) => (
                <option key={f.table} value={f.table}>
                  Fact: {f.table}
                </option>
              ))}
            </select>
          ) : null}
          <button type="button" className="button ghost" onClick={() => void load()} disabled={loading}>
            {loading ? <span className="spinner" /> : null} Refresh
          </button>
          <button type="button" className="button" onClick={() => onOpenCube()}>
            Open cube
          </button>
        </div>
      </div>

      {errors.length ? (
        <div className="banner warn">
          <div>
            <p className="status-title">Some panels could not be computed</p>
            <p className="muted">{errors[0]}</p>
          </div>
        </div>
      ) : null}

      <div className="kpi-grid">
        {kpis.map((k) => {
          const pct = k.prev ? ((k.now - k.prev) / Math.abs(k.prev)) * 100 : null;
          return (
            <div className="kpi" key={k.m.key}>
              <span className="kpi-label">{k.m.label}</span>
              {k.value ? (
                <span className="kpi-value">{k.value}</span>
              ) : (
                <div className="skeleton" style={{ height: 32, width: "60%" }} />
              )}
              <span className="kpi-foot">
                {pct !== null && Number.isFinite(pct) ? (
                  <span className={pct >= 0 ? "delta up" : "delta down"}>
                    {pct >= 0 ? "+" : "−"}
                    {Math.abs(pct).toFixed(1)}%
                  </span>
                ) : null}
                {k.foot}
              </span>
              {k.spark ? <Sparkline values={k.spark} /> : <div style={{ height: 38 }} />}
            </div>
          );
        })}
      </div>

      <div className="dash-grid">
        {p.month ? (
          <Card
            span="span-8"
            title={`${p.primary.label} by month${p.series ? `, by ${p.series.label.toLowerCase()}` : ""}`}
            sub={p.series ? "Click legend entries to isolate a series" : undefined}
            action={sqlButton(data.trend)}
          >
            {trend ? (
              <LineChart
                labels={trend.labels}
                series={trend.series}
                height={290}
                area={trend.series.length === 1}
                directLabels={trend.series.length > 1 && trend.series.length <= 4}
                yFormat={fmtPrimary}
                xFormat={(l) => formatMonth(l, l.slice(5, 7) === "01")}
                tooltipTitle={(l) => formatMonth(l)}
              />
            ) : loading ? (
              <Skeleton h={320} />
            ) : (
              <p className="muted">No time series available.</p>
            )}
          </Card>
        ) : null}

        {p.breakdowns.slice(0, 1).map((d, i) => (
          <Card
            key={d.key}
            span={i === 0 ? (p.month ? "span-4" : "span-6") : p.heat ? "span-5" : p.month ? "span-12" : "span-6"}
            title={`${p.primary.label} by ${d.label.toLowerCase()}`}
            sub="Click a bar to drill into it in the cube"
            action={sqlButton(data.breakdowns[i])}
          >
            {data.breakdowns[i] ? (
              <BarChart
                data={data.breakdowns[i]!.rows.map((r) => ({ label: String(r[0]), value: Number(r[1]) || 0 }))}
                valueFormat={fmtPrimary}
                labelWidth={110}
                barHeight={20}
                showShare={(d.cardinality ?? 99) <= 6}
                onSelect={(row) => onOpenCube(cubeFor([d], [{ dim: d.key, value: row.label }]))}
              />
            ) : (
              <Skeleton />
            )}
          </Card>
        ))}

        {p.heat && heat ? (
          <Card
            span={p.breakdowns[1] ? "span-7" : "span-12"}
            title={`${p.heat[0].label} × ${p.heat[1].label}`}
            sub={`${p.primary.label} · darker = more · click a cell to drill into it`}
            action={sqlButton(data.heat)}
          >
            <Heatmap
              rowLabels={heat.rl}
              colLabels={heat.cl}
              values={heat.values}
              rowTitle={p.heat[0].label}
              colTitle={p.heat[1].label}
              valueFormat={fmtPrimary}
              cellHeight={26}
              onCellClick={(r, c) =>
                onOpenCube(
                  cubeFor(
                    [p.heat![0], p.heat![1]],
                    [
                      { dim: p.heat![0].key, value: r },
                      { dim: p.heat![1].key, value: c }
                    ]
                  )
                )
              }
            />
          </Card>
        ) : null}

        {p.breakdowns.slice(1, 2).map((d) => (
          <Card
            key={d.key}
            span={p.heat ? "span-5" : p.month ? "span-12" : "span-6"}
            title={`${p.primary.label} by ${d.label.toLowerCase()}`}
            sub="Click a bar to drill into it in the cube"
            action={sqlButton(data.breakdowns[1])}
          >
            {data.breakdowns[1] ? (
              <BarChart
                data={data.breakdowns[1]!.rows.map((r) => ({ label: String(r[0]), value: Number(r[1]) || 0 }))}
                valueFormat={fmtPrimary}
                labelWidth={110}
                barHeight={20}
                showShare={(d.cardinality ?? 99) <= 6}
                onSelect={(row) => onOpenCube(cubeFor([d], [{ dim: d.key, value: row.label }]))}
              />
            ) : (
              <Skeleton />
            )}
          </Card>
        ))}

        {p.entity ? (
          <Card
            span="span-12"
            title={`Top ${p.entity.label.toLowerCase()}`}
            sub={
              model.hiddenColumns.length
                ? `Hidden for your role: ${model.hiddenColumns.join(", ")}`
                : `by ${p.primary.label.toLowerCase()}`
            }
            action={sqlButton(data.top)}
          >
            {data.top ? (
              <div className="table-wrapper" style={{ maxHeight: "none" }}>
                <table>
                  <thead>
                    <tr>
                      <th>{p.entity.label}</th>
                      <th className="num">{p.primary.label}</th>
                      {data.top.columns.length > 2 ? <th className="num">Rows</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {data.top.rows.map((r, i) => (
                      <tr key={i}>
                        <td>{String(r[0])}</td>
                        <td className="num">{fmtPrimary(Number(r[1]) || 0)}</td>
                        {r.length > 2 ? <td className="num">{formatCompact(Number(r[2]) || 0)}</td> : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Skeleton h={300} />
            )}
          </Card>
        ) : null}

        <Card span="span-12" title="Semantic model" sub="Inferred from the source's schema, keys and column profiles">
          <div className="model-grid">
            <div>
              <div className="section-label">Measures</div>
              <ul className="model-list">
                {model.measures.map((m) => (
                  <li key={m.key}>
                    <span>{m.label}</span>
                    <code>{m.sql}</code>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="section-label">Dimensions and drill paths</div>
              <ul className="model-list">
                {model.dimensions
                  .filter((d) => d.key !== "__all" && !model.dimensions.some((x) => x.next === d.key))
                  .map((d) => {
                    const chain: string[] = [];
                    let cur: ModelDimension | undefined = d;
                    while (cur) {
                      chain.push(`${cur.label}${cur.cardinality && cur.kind === "category" ? ` (${cur.cardinality})` : ""}`);
                      const nextKey: string | null = cur.next;
                      cur = nextKey ? model.dimensions.find((x) => x.key === nextKey) : undefined;
                    }
                    return (
                      <li key={d.key}>
                        <span className="muted">{d.groupLabel}</span>
                        <span>{chain.join(" → ")}</span>
                      </li>
                    );
                  })}
              </ul>
            </div>
            <div>
              <div className="section-label">Joins</div>
              <ul className="model-list">
                <li>
                  <span className="mono">{fact}</span>
                  <span className="muted">fact table (f)</span>
                </li>
                {model.joins.map((j) => (
                  <li key={j.alias}>
                    <span className="mono">{j.table}</span>
                    <code>{j.on}</code>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};

export default OverviewView;
