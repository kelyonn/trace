import { useState } from "react";
import { useWidth } from "./useWidth";

type Props = {
  rowLabels: string[];
  colLabels: string[];
  values: number[][];
  rowTitle?: string;
  colTitle?: string;
  valueFormat?: (n: number) => string;
  onCellClick?: (row: string, col: string) => void;
  cellHeight?: number;
  showValues?: boolean;
};

const BUCKETS = 6;

/** Sequential single-hue heatmap: 6 quantized blue steps, light → dark for magnitude. */
const Heatmap = ({
  rowLabels,
  colLabels,
  values,
  rowTitle,
  colTitle,
  valueFormat = (n) => String(n),
  onCellClick,
  cellHeight = 30,
  showValues = true
}: Props) => {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ r: number; c: number; x: number; y: number } | null>(null);
  const labelW = Math.min(150, Math.max(80, ...rowLabels.map((l) => l.length * 7 + 12)));
  const headH = 64;
  const innerW = Math.max(60, width - labelW - 4);
  const cellW = innerW / Math.max(1, colLabels.length);
  const height = headH + rowLabels.length * cellHeight + 4;

  let min = Infinity;
  let max = -Infinity;
  for (const row of values) for (const v of row) {
    if (!Number.isFinite(v)) continue;
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  if (!Number.isFinite(min)) {
    min = 0;
    max = 1;
  }
  // sqrt scale: business measures are heavy-tailed, so a linear scale would paint most cells one color.
  const bucket = (v: number) =>
    Math.min(BUCKETS, Math.max(1, Math.ceil(Math.sqrt(Math.max(0, (v - min) / (max - min || 1))) * BUCKETS) || 1));
  const canLabel = showValues && cellW >= 48 && cellHeight >= 22;

  return (
    <div className={hover ? "chart has-hover" : "chart"} ref={ref}>
      <svg width={width} height={height} role="img" aria-label={`${rowTitle ?? "rows"} by ${colTitle ?? "columns"} heatmap`}>
        {colLabels.map((c, ci) => (
          <text
            key={c}
            className="label"
            transform={`translate(${labelW + ci * cellW + cellW / 2}, ${headH - 8}) rotate(${cellW < 70 ? -40 : 0})`}
            textAnchor={cellW < 70 ? "start" : "middle"}
          >
            {c.length > 14 ? `${c.slice(0, 13)}…` : c}
          </text>
        ))}
        {rowLabels.map((r, ri) => (
          <g key={r}>
            <text className="label" x={labelW - 10} y={headH + ri * cellHeight + cellHeight / 2} dy="0.32em" textAnchor="end">
              {r.length > 20 ? `${r.slice(0, 19)}…` : r}
            </text>
            {colLabels.map((c, ci) => {
              const v = values[ri]?.[ci] ?? 0;
              const b = bucket(v);
              const x = labelW + ci * cellW;
              const y = headH + ri * cellHeight;
              const isHover = hover?.r === ri && hover?.c === ci;
              return (
                <g key={c}>
                  <rect
                    className={isHover ? "heatmap-cell hovered" : "heatmap-cell"}
                    x={x}
                    y={y}
                    width={cellW}
                    height={cellHeight}
                    rx={4}
                    fill={`var(--seq-${b})`}
                    onMouseEnter={() => setHover({ r: ri, c: ci, x: x + cellW / 2, y })}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => onCellClick?.(r, c)}
                  />
                  {canLabel ? (
                    <text
                      x={x + cellW / 2}
                      y={y + cellHeight / 2}
                      dy="0.32em"
                      textAnchor="middle"
                      style={{
                        pointerEvents: "none",
                        fontSize: 11,
                        fontWeight: 600,
                        fill: `var(--seq-ink-${b})`,
                        fontVariantNumeric: "tabular-nums"
                      }}
                    >
                      {valueFormat(v)}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </g>
        ))}
      </svg>
      {hover ? (
        <div className="chart-tooltip" style={{ left: Math.min(Math.max(hover.x, 90), width - 90), top: hover.y }}>
          <div className="tt-title">
            {rowLabels[hover.r]} · {colLabels[hover.c]}
          </div>
          <div className="tt-row">
            <span className="swatch" style={{ background: `var(--seq-${bucket(values[hover.r][hover.c])})` }} />
            Value <b>{valueFormat(values[hover.r][hover.c])}</b>
          </div>
          {onCellClick ? <div className="tt-row muted">Click to drill through</div> : null}
        </div>
      ) : null}
      <div className="gradient-legend" style={{ marginTop: 8 }}>
        <span>{valueFormat(min)}</span>
        <span className="bar" />
        <span>{valueFormat(max)}</span>
        <span>· √ color scale</span>
      </div>
    </div>
  );
};

export default Heatmap;
