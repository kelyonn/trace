import { useCallback, useEffect, useMemo, useState } from "react";
import type { Requester, QueryPayload } from "../lib/api";
import { formatCompact, formatCurrency, formatMonth, formatNumber } from "../lib/format";
import LineChart from "../components/charts/LineChart";
import BarChart from "../components/charts/BarChart";
import Heatmap from "../components/charts/Heatmap";
import Sparkline from "../components/charts/Sparkline";
import { seriesColor } from "../components/charts/useWidth";
import { detectPivot } from "../cube/pivot";
import type { OlapState } from "../cube/olap";
import Icon from "../components/Icon";

const REGIONS = ["North America", "Europe", "APAC", "Latin America", "Middle East", "Africa"];

export const OVERVIEW_SQL = {
  monthly: `SELECT CAST(date_trunc('month', order_date) AS DATE) AS month,
  SUM(CASE WHEN status <> 'cancelled' THEN amount ELSE 0 END) AS revenue,
  COUNT(*) AS orders,
  COUNT(DISTINCT customer_id) AS customers
FROM orders
GROUP BY 1
ORDER BY 1`,
  regionMonthly: `SELECT CAST(date_trunc('month', o.order_date) AS DATE) AS month, c.region, SUM(o.amount) AS revenue
FROM orders o
JOIN customers c ON c.id = o.customer_id
WHERE o.status <> 'cancelled'
GROUP BY 1, 2
ORDER BY 1`,
  category: `SELECT p.category, SUM(ol.line_amount) AS revenue
FROM order_lines ol
JOIN products p ON p.id = ol.product_id
GROUP BY 1
ORDER BY 2 DESC`,
  status: `SELECT status, COUNT(*) AS orders
FROM orders
GROUP BY 1
ORDER BY 2 DESC`,
  heat: `SELECT c.industry, p.category, SUM(ol.line_amount) AS revenue
FROM order_lines ol
JOIN orders o ON o.id = ol.order_id
JOIN customers c ON c.id = o.customer_id
JOIN products p ON p.id = ol.product_id
GROUP BY 1, 2`,
  topCustomers: `SELECT c.name, c.region, c.industry, COUNT(*) AS orders, SUM(o.amount) AS revenue
FROM orders o
JOIN customers c ON c.id = o.customer_id
WHERE o.status <> 'cancelled'
GROUP BY 1, 2, 3
ORDER BY revenue DESC
LIMIT 8`
};

type Results = Partial<Record<keyof typeof OVERVIEW_SQL, QueryPayload>>;

type Props = {
  request: Requester;
  theme: string;
  refreshKey: number;
  engineLabel?: string;
  onOpenSql: (sql: string) => void;
  onOpenCube: (state?: Partial<OlapState>) => void;
};

const Delta = ({ now, prev }: { now: number; prev: number }) => {
  if (!prev) return null;
  const pct = ((now - prev) / prev) * 100;
  const up = pct >= 0;
  return (
    <span className={up ? "delta up" : "delta down"}>
      {up ? "+" : "−"}
      {Math.abs(pct).toFixed(1)}%
    </span>
  );
};

const Card = ({
  title,
  sub,
  children,
  span,
  action
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
  span: string;
  action?: React.ReactNode;
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

const OverviewView = ({ request, theme, refreshKey, engineLabel, onOpenSql, onOpenCube }: Props) => {
  const [data, setData] = useState<Results>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setErrors([]);
    const entries = Object.entries(OVERVIEW_SQL) as [keyof Results, string][];
    const settled = await Promise.allSettled(
      entries.map(([, sql]) => request<QueryPayload>("/query", { body: { sql } }))
    );
    const next: Results = {};
    const errs: string[] = [];
    settled.forEach((s, i) => {
      if (s.status === "fulfilled") next[entries[i][0]] = s.value;
      else errs.push(s.reason instanceof Error ? s.reason.message : String(s.reason));
    });
    setData(next);
    setErrors([...new Set(errs)]);
    setLoading(false);
  }, [request]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const monthly = useMemo(
    () =>
      (data.monthly?.rows ?? []).map((r) => ({
        month: String(r[0]).slice(0, 10),
        revenue: Number(r[1]),
        orders: Number(r[2]),
        customers: Number(r[3])
      })),
    [data.monthly]
  );

  const kpis = useMemo(() => {
    if (monthly.length < 2) return null;
    const last12 = monthly.slice(-12);
    const prev12 = monthly.slice(-24, -12);
    const sum = (arr: typeof monthly, k: "revenue" | "orders") => arr.reduce((a, m) => a + m[k], 0);
    const rev = sum(last12, "revenue");
    const revPrev = sum(prev12, "revenue");
    const ord = sum(last12, "orders");
    const ordPrev = sum(prev12, "orders");
    const last = monthly[monthly.length - 1];
    const prevMonth = monthly[monthly.length - 2];
    return {
      period: `${formatMonth(last12[0].month)} – ${formatMonth(last.month)}`,
      rev,
      revPrev,
      ord,
      ordPrev,
      aov: rev / (ord || 1),
      aovPrev: revPrev / (ordPrev || 1),
      cust: last.customers,
      custPrev: prevMonth.customers,
      spark: monthly.slice(-18)
    };
  }, [monthly]);

  const regionSeries = useMemo(() => {
    const rows = data.regionMonthly?.rows ?? [];
    const labels = [...new Set(rows.map((r) => String(r[0]).slice(0, 10)))].sort();
    const idx = new Map(labels.map((l, i) => [l, i]));
    const present = REGIONS.filter((reg) => rows.some((r) => r[1] === reg));
    const series = present.map((reg) => {
      const values: (number | null)[] = new Array(labels.length).fill(null);
      for (const r of rows) if (r[1] === reg) values[idx.get(String(r[0]).slice(0, 10))!] = Number(r[2]);
      return { name: reg, color: seriesColor(REGIONS.indexOf(reg)), values };
    });
    return { labels, series };
  }, [data.regionMonthly]);

  const heatPivot = useMemo(
    () => (data.heat ? detectPivot(data.heat.columns, data.heat.rows) : null),
    [data.heat]
  );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <p>
            {kpis ? `Trailing twelve months, ${kpis.period}` : "Loading…"}
            {engineLabel ? ` — ${engineLabel}` : ""}
          </p>
        </div>
        <div className="button-row">
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
          <Icon name="alert" />
          <div>
            <p className="status-title">Some dashboard queries failed</p>
            <p className="muted">{errors[0]}</p>
          </div>
        </div>
      ) : null}

      <div className="kpi-grid">
        {[
          {
            label: "Revenue",
            icon: "dollar",
            value: kpis ? formatCurrency(kpis.rev) : null,
            now: kpis?.rev,
            prev: kpis?.revPrev,
            foot: "vs prior 12 mo",
            spark: kpis?.spark.map((m) => m.revenue),
            color: "var(--series-1)"
          },
          {
            label: "Orders",
            icon: "receipt",
            value: kpis ? formatCompact(kpis.ord) : null,
            now: kpis?.ord,
            prev: kpis?.ordPrev,
            foot: "vs prior 12 mo",
            spark: kpis?.spark.map((m) => m.orders),
            color: "var(--series-1)"
          },
          {
            label: "Avg order value",
            icon: "cart",
            value: kpis ? formatCurrency(kpis.aov, false) : null,
            now: kpis?.aov,
            prev: kpis?.aovPrev,
            foot: "vs prior 12 mo",
            spark: kpis?.spark.map((m) => m.revenue / (m.orders || 1)),
            color: "var(--series-1)"
          },
          {
            label: "Active customers",
            icon: "users",
            value: kpis ? formatNumber(kpis.cust) : null,
            now: kpis?.cust,
            prev: kpis?.custPrev,
            foot: "this month vs last",
            spark: kpis?.spark.map((m) => m.customers),
            color: "var(--series-1)"
          }
        ].map((k) => (
          <div className="card kpi" key={k.label}>
            <span className="kpi-label">{k.label}</span>
            {k.value ? <span className="kpi-value">{k.value}</span> : <div className="skeleton" style={{ height: 32, width: "60%" }} />}
            <span className="kpi-foot">
              {k.now !== undefined && k.prev !== undefined ? <Delta now={k.now} prev={k.prev} /> : null}
              {k.foot}
            </span>
            {k.spark ? <Sparkline values={k.spark} color={k.color} /> : <div style={{ height: 42 }} />}
          </div>
        ))}
      </div>

      <div className="dash-grid">
        <Card
          span="span-8"
          title="Monthly revenue by region"
          sub="Shipped + open orders · click legend to isolate"
          action={
            <button type="button" className="button subtle" onClick={() => onOpenSql(OVERVIEW_SQL.regionMonthly)}>
              SQL
            </button>
          }
        >
          {regionSeries.series.length ? (
            <LineChart
              labels={regionSeries.labels}
              series={regionSeries.series}
              height={290}
              yFormat={(n) => formatCurrency(n)}
              xFormat={(l) => formatMonth(l, l.slice(5, 7) === "01")}
              tooltipTitle={(l) => formatMonth(l)}
            />
          ) : (
            <Skeleton h={320} />
          )}
        </Card>

        <Card
          span="span-4"
          title="Order status mix"
          sub="All orders · share of total"
          action={
            <button type="button" className="button subtle" onClick={() => onOpenSql(OVERVIEW_SQL.status)}>
              SQL
            </button>
          }
        >
          {data.status ? (
            <BarChart
              data={data.status.rows.map((r) => ({ label: String(r[0]), value: Number(r[1]) }))}
              valueFormat={formatCompact}
              labelWidth={84}
              barHeight={26}
              showShare
            />
          ) : (
            <Skeleton />
          )}
          {data.status ? (
            <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
              Recent orders skew to <b className="secondary">pending</b> / <b className="secondary">processing</b>; older ones settle as shipped.
            </p>
          ) : null}
        </Card>

        <Card span="span-5" title="Revenue by product category" sub="Order-line revenue, all time">
          {data.category ? (
            <BarChart
              data={data.category.rows.map((r) => ({ label: String(r[0]), value: Number(r[1]) }))}
              valueFormat={(n) => formatCurrency(n)}
              labelWidth={92}
              barHeight={22}
              onSelect={(d) =>
                onOpenCube({
                  x: { hier: "product", depth: 1, path: [d.label] },
                  y: { hier: "customer", depth: 0, path: [] },
                  z: { hier: "time", depth: 0, path: [] }
                })
              }
            />
          ) : (
            <Skeleton h={420} />
          )}
        </Card>

        <Card span="span-7" title="Industry × category affinity" sub="Where each industry spends · darker = more revenue">
          {heatPivot ? (
            <Heatmap
              rowLabels={heatPivot.rowLabels.slice().sort()}
              colLabels={heatPivot.colLabels.slice().sort()}
              values={heatPivot.rowLabels
                .slice()
                .sort()
                .map((r) =>
                  heatPivot.colLabels
                    .slice()
                    .sort()
                    .map((c) => heatPivot.values[heatPivot.rowLabels.indexOf(r)][heatPivot.colLabels.indexOf(c)])
                )}
              rowTitle="industry"
              colTitle="category"
              valueFormat={(n) => formatCurrency(n)}
              cellHeight={28}
              onCellClick={(_row, col) =>
                onOpenCube({
                  x: { hier: "product", depth: 1, path: [col] },
                  y: { hier: "customer", depth: 0, path: [] },
                  z: { hier: "time", depth: 0, path: [] }
                })
              }
            />
          ) : (
            <Skeleton h={360} />
          )}
        </Card>

        <Card
          span="span-12"
          title="Top accounts"
          sub="Customer names are masked unless your role is admin"
          action={
            <button type="button" className="button subtle" onClick={() => onOpenSql(OVERVIEW_SQL.topCustomers)}>
              SQL
            </button>
          }
        >
          {data.topCustomers ? (
            <div className="table-wrapper" style={{ maxHeight: "none" }}>
              <table>
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Region</th>
                    <th className="num">Orders</th>
                    <th className="num">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topCustomers.rows.map((r, i) => (
                    <tr key={i}>
                      <td className={String(r[0]) === "***" ? "masked" : undefined}>
                        <div>{String(r[0])}</div>
                        <div className="muted" style={{ fontSize: 11.5, letterSpacing: 0 }}>
                          {String(r[2])}
                        </div>
                      </td>
                      <td>{String(r[1])}</td>
                      <td className="num">{formatNumber(Number(r[3]))}</td>
                      <td className="num">{formatCurrency(Number(r[4]))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Skeleton h={360} />
          )}
        </Card>
      </div>
    </div>
  );
};

export default OverviewView;
