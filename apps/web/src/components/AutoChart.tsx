import type { Column } from "@trace/shared-types";
import { columnKind, formatMeasure, formatMonth, titleCase } from "../lib/format";
import LineChart, { type LineSeries } from "./charts/LineChart";
import BarChart from "./charts/BarChart";
import { seriesColor } from "./charts/useWidth";
import Icon from "./Icon";

type Props = { columns: Column[]; rows: unknown[][] };

type Plan =
  | { kind: "line"; labels: string[]; series: LineSeries[]; measure: string; monthly: boolean }
  | { kind: "bar"; data: { label: string; value: number }[]; measure: string; dim: string }
  | { kind: "none"; reason: string };

/** Picks a chart form from the result shape: time → line, category + measure → ranked bars. */
export function planChart(columns: Column[], rows: unknown[][]): Plan {
  if (!rows.length) return { kind: "none", reason: "The query returned no rows." };
  const kinds = columns.map((c, i) => columnKind(c, rows[0]?.[i]));
  const measureIdx = kinds.lastIndexOf("number");
  if (measureIdx < 0) return { kind: "none", reason: "Add a numeric measure (e.g. SUM, COUNT) to chart this result." };
  const measure = columns[measureIdx].name;
  const dateIdx = kinds.indexOf("date");
  const textIdx = kinds.findIndex((k, i) => k === "text" && i !== measureIdx);

  if (dateIdx >= 0) {
    const labels = [...new Set(rows.map((r) => String(r[dateIdx]).slice(0, 10)))].sort();
    const monthly = labels.every((l) => l.endsWith("-01"));
    const pos = new Map(labels.map((l, i) => [l, i]));
    const groups = new Map<string, (number | null)[]>();
    const totals = new Map<string, number>();
    for (const r of rows) {
      const key = textIdx >= 0 ? String(r[textIdx]) : titleCase(measure);
      const arr = groups.get(key) ?? new Array(labels.length).fill(null);
      const i = pos.get(String(r[dateIdx]).slice(0, 10))!;
      const v = Number(r[measureIdx]);
      arr[i] = (arr[i] ?? 0) + (Number.isFinite(v) ? v : 0);
      groups.set(key, arr);
      totals.set(key, (totals.get(key) ?? 0) + (Number.isFinite(v) ? v : 0));
    }
    // Fixed-order color by first appearance; > 8 series fold into "Other".
    let keys = [...groups.keys()];
    if (keys.length > 8) {
      const top = [...keys].sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0)).slice(0, 7);
      const other = new Array(labels.length).fill(null);
      for (const k of keys) {
        if (top.includes(k)) continue;
        groups.get(k)!.forEach((v, i) => {
          if (v !== null) other[i] = (other[i] ?? 0) + v;
        });
      }
      groups.set("Other", other);
      keys = [...keys.filter((k) => top.includes(k)), "Other"];
    }
    return {
      kind: "line",
      labels,
      measure,
      monthly,
      series: keys.map((k, i) => ({ name: k, color: seriesColor(i), values: groups.get(k)! }))
    };
  }

  const dimIdx = textIdx >= 0 ? textIdx : kinds.findIndex((_, i) => i !== measureIdx);
  if (dimIdx < 0) return { kind: "none", reason: "Add a dimension column to chart this result." };
  const agg = new Map<string, number>();
  for (const r of rows) {
    const k = String(r[dimIdx]);
    const v = Number(r[measureIdx]);
    agg.set(k, (agg.get(k) ?? 0) + (Number.isFinite(v) ? v : 0));
  }
  const data = [...agg.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 20);
  return { kind: "bar", data, measure, dim: columns[dimIdx].name };
}

const AutoChart = ({ columns, rows }: Props) => {
  const plan = planChart(columns, rows);
  if (plan.kind === "none") {
    return (
      <div className="empty-state">
        <Icon name="chart" />
        <p className="status-title">No chart for this shape</p>
        <p>{plan.reason}</p>
      </div>
    );
  }
  const fmt = (n: number) => formatMeasure(plan.measure, n);
  if (plan.kind === "line") {
    return (
      <LineChart
        labels={plan.labels}
        series={plan.series}
        height={320}
        area={plan.series.length === 1}
        directLabels={plan.series.length > 1 && plan.series.length <= 4}
        yFormat={fmt}
        xFormat={(l) => (plan.monthly ? formatMonth(l, l.slice(5, 7) === "01") : l.slice(5))}
        tooltipTitle={(l) => (plan.monthly ? formatMonth(l) : l)}
      />
    );
  }
  return (
    <div>
      <p className="muted" style={{ marginBottom: 8, fontSize: 12.5 }}>
        {titleCase(plan.measure)} by {titleCase(plan.dim)}
        {plan.data.length === 20 ? " · top 20" : ""}
      </p>
      <BarChart data={plan.data} valueFormat={fmt} labelWidth={150} showShare />
    </div>
  );
};

export default AutoChart;
