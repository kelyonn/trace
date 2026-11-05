import { useMemo, useState } from "react";
import { niceTicks } from "../../lib/format";
import { useWidth } from "./useWidth";

export type LineSeries = { name: string; color: string; values: (number | null)[] };

type Props = {
  labels: string[];
  series: LineSeries[];
  height?: number;
  yFormat?: (n: number) => string;
  xFormat?: (label: string, index: number) => string;
  tooltipTitle?: (label: string) => string;
  area?: boolean;
  /** Show a direct label at the end of each line (used when ≤ 4 series). */
  directLabels?: boolean;
  zeroBased?: boolean;
};

const M = { top: 12, right: 16, bottom: 26, left: 52 };

const LineChart = ({
  labels,
  series,
  height = 260,
  yFormat = (n) => String(n),
  xFormat = (l) => l,
  tooltipTitle = (l) => l,
  area = false,
  directLabels = false,
  zeroBased = true
}: Props) => {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<number | null>(null);

  const visible = series.filter((s) => !hidden.has(s.name));
  const labelRoom = directLabels && visible.length <= 4 ? 96 : 0;
  const innerW = Math.max(40, width - M.left - M.right - labelRoom);
  const innerH = height - M.top - M.bottom;

  const { ticks, yMin, yMax } = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of visible) {
      for (const v of s.values) {
        if (v === null || !Number.isFinite(v)) continue;
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
    if (!Number.isFinite(lo)) {
      lo = 0;
      hi = 1;
    }
    if (zeroBased) lo = Math.min(0, lo);
    const t = niceTicks(lo, hi, 4);
    return { ticks: t, yMin: t[0], yMax: t[t.length - 1] };
  }, [visible, zeroBased]);

  const n = labels.length;
  const x = (i: number) => M.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => M.top + innerH - ((v - yMin) / (yMax - yMin || 1)) * innerH;

  const paths = visible.map((s) => {
    let d = "";
    let started = false;
    s.values.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) {
        started = false;
        return;
      }
      d += `${started ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      started = true;
    });
    const firstIdx = s.values.findIndex((v) => v !== null);
    let lastIdx = -1;
    s.values.forEach((v, i) => {
      if (v !== null) lastIdx = i;
    });
    const areaD =
      area && firstIdx >= 0
        ? `${d}L${x(lastIdx)},${y(Math.max(yMin, 0))}L${x(firstIdx)},${y(Math.max(yMin, 0))}Z`
        : "";
    return { s, d, areaD, lastIdx };
  });

  // Thin x labels to avoid collisions (~70px per label).
  const every = Math.max(1, Math.ceil((n * 70) / innerW));

  // Direct labels, nudged apart vertically to avoid overlap.
  const endLabels = useMemo(() => {
    if (!directLabels || visible.length > 4) return [];
    const items = paths
      .filter((p) => p.lastIdx >= 0)
      .map((p) => ({ name: p.s.name, color: p.s.color, y: y(p.s.values[p.lastIdx] as number) }))
      .sort((a, b) => a.y - b.y);
    for (let i = 1; i < items.length; i++) {
      if (items[i].y - items[i - 1].y < 14) items[i].y = items[i - 1].y + 14;
    }
    return items;
  }, [paths, directLabels, visible.length]);

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const px = e.clientX - rect.left - M.left;
    const idx = n <= 1 ? 0 : Math.round((px / innerW) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, idx)));
  };

  const toggle = (name: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else if (next.size < series.length - 1) next.add(name);
      return next;
    });

  return (
    <div className="chart" ref={ref}>
      {series.length > 1 ? (
        <div className="legend" style={{ marginBottom: 10 }}>
          {series.map((s) => (
            <button
              key={s.name}
              type="button"
              className={hidden.has(s.name) ? "legend-item off" : "legend-item"}
              onClick={() => toggle(s.name)}
              aria-pressed={!hidden.has(s.name)}
            >
              <span className="swatch line" style={{ background: s.color, width: 14 }} />
              {s.name}
            </button>
          ))}
        </div>
      ) : null}
      <svg width={width} height={height} role="img" aria-label={series.map((s) => s.name).join(", ")}>
        <defs>
          {paths.map((p, i) => (
            <linearGradient key={p.s.name} id={`lc-grad-${i}-${p.s.name.replace(/\W/g, "")}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={p.s.color} stopOpacity={0.28} />
              <stop offset="1" stopColor={p.s.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid-line" x1={M.left} x2={M.left + innerW} y1={y(t)} y2={y(t)} />
            <text className="tick" x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end">
              {yFormat(t)}
            </text>
          </g>
        ))}
        <line className="axis-line" x1={M.left} x2={M.left + innerW} y1={y(yMin)} y2={y(yMin)} />
        {labels.map((l, i) =>
          i % every === 0 ? (
            <text key={`${l}-${i}`} className="tick" x={x(i)} y={height - 6} textAnchor="middle">
              {xFormat(l, i)}
            </text>
          ) : null
        )}
        {paths.map((p, i) =>
          p.areaD ? (
            <path key={`a-${p.s.name}`} d={p.areaD} fill={`url(#lc-grad-${i}-${p.s.name.replace(/\W/g, "")})`} />
          ) : null
        )}
        {paths.map((p) => (
          <path
            key={p.s.name}
            d={p.d}
            fill="none"
            stroke={p.s.color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {endLabels.map((l) => (
          <text key={l.name} className="label" x={M.left + innerW + 8} y={l.y} dy="0.32em">
            {l.name}
          </text>
        ))}
        {hover !== null ? (
          <g>
            <line className="crosshair" x1={x(hover)} x2={x(hover)} y1={M.top} y2={M.top + innerH} />
            {visible.map((s) =>
              s.values[hover] !== null && s.values[hover] !== undefined ? (
                <circle
                  key={s.name}
                  cx={x(hover)}
                  cy={y(s.values[hover] as number)}
                  r={4.5}
                  fill={s.color}
                  stroke="var(--surface-1)"
                  strokeWidth={2}
                />
              ) : null
            )}
          </g>
        ) : null}
        <rect
          className="hit"
          x={M.left}
          y={M.top}
          width={innerW}
          height={innerH}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        />
      </svg>
      {hover !== null ? (
        <div
          className="chart-tooltip"
          style={{
            left: Math.min(Math.max(x(hover), 90), width - 90),
            top: M.top + (series.length > 1 ? 30 : 0) + 8,
            transform: "translate(-50%, 0)"
          }}
        >
          <div className="tt-title">{tooltipTitle(labels[hover])}</div>
          {visible
            .map((s) => ({ s, v: s.values[hover] }))
            .sort((a, b) => (b.v ?? -Infinity) - (a.v ?? -Infinity))
            .map(({ s, v }) => (
              <div className="tt-row" key={s.name}>
                <span className="swatch" style={{ background: s.color }} />
                {s.name}
                <b>{v === null || v === undefined ? "–" : yFormat(v)}</b>
              </div>
            ))}
        </div>
      ) : null}
    </div>
  );
};

export default LineChart;
