import type { Column } from "@trace/shared-types";

const NUMERIC_RE = /int|decimal|numeric|double|real|float|bigint|smallint/i;
const DATE_RE = /date|timestamp|time/i;

export type ColumnKind = "number" | "date" | "text";

export function columnKind(col: Column, sample?: unknown): ColumnKind {
  const t = col.type ?? "";
  if (NUMERIC_RE.test(t)) return "number";
  if (DATE_RE.test(t)) return "date";
  if (typeof sample === "number") return "number";
  if (typeof sample === "string" && /^\d{4}-\d{2}-\d{2}/.test(sample)) return "date";
  return "text";
}

const compactFmt = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const intFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const decFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return "–";
  return Math.abs(n) < 1000 ? decFmt.format(n) : compactFmt.format(n);
}

export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "–";
  return Number.isInteger(n) ? intFmt.format(n) : decFmt.format(n);
}

export function formatCurrency(n: number, compact = true): string {
  if (!Number.isFinite(n)) return "–";
  if (compact && Math.abs(n) >= 1000) return `$${compactFmt.format(n)}`;
  return `$${decFmt.format(n)}`;
}

export function isMoneyName(name: string): boolean {
  return /amount|revenue|price|total|sales|value|spend/i.test(name) && !/count|qty|quantity/i.test(name);
}

export function formatMeasure(name: string, n: number, compact = true): string {
  return isMoneyName(name) ? formatCurrency(n, compact) : compact ? formatCompact(n) : formatNumber(n);
}

export function formatCell(value: unknown, kind: ColumnKind): string {
  if (value === null || value === undefined) return "∅";
  if (kind === "number") {
    const n = Number(value);
    return Number.isFinite(n) ? formatNumber(n) : String(value);
  }
  if (kind === "date") {
    const s = String(value);
    return s.length > 10 && /00:00:00/.test(s) ? s.slice(0, 10) : s;
  }
  return String(value);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatMonth(iso: string, withYear = true): string {
  const [y, m] = iso.slice(0, 7).split("-");
  const label = MONTHS[Number(m) - 1] ?? iso;
  return withYear ? `${label} ${y}` : label;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.round(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** "Nice" axis ticks covering [min, max]. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0];
  if (min === max) max = min + 1;
  const span = max - min;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.5; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

export function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
