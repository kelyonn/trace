import { useState } from "react";
import { niceTicks } from "../../lib/format";
import { hBarPath, useWidth } from "./useWidth";

export type BarDatum = { label: string; value: number; note?: string };

type Props = {
  data: BarDatum[];
  color?: string;
  valueFormat?: (n: number) => string;
  barHeight?: number;
  labelWidth?: number;
  onSelect?: (d: BarDatum) => void;
  /** Optional share-of-total shown in tooltip and label. */
  showShare?: boolean;
};

const BarChart = ({
  data,
  color = "var(--series-1)",
  valueFormat = (n) => String(n),
  barHeight = 20,
  labelWidth = 120,
  onSelect,
  showShare = false
}: Props) => {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const gap = 10;
  const valueRoom = showShare ? 104 : 64;
  const innerW = Math.max(40, width - labelWidth - valueRoom);
  const max = Math.max(0, ...data.map((d) => d.value));
  const ticks = niceTicks(0, max || 1, 4);
  const domainMax = ticks[ticks.length - 1];
  const total = data.reduce((a, d) => a + d.value, 0) || 1;
  const height = data.length * (barHeight + gap) + 18;

  return (
    <div className={hover !== null ? "chart has-hover" : "chart"} ref={ref}>
      <svg width={width} height={height} role="img" aria-label="Bar chart">
        {ticks.map((t) => {
          const tx = labelWidth + (t / domainMax) * innerW;
          return (
            <g key={t}>
              <line className="grid-line" x1={tx} x2={tx} y1={0} y2={height - 18} />
              <text className="tick" x={tx} y={height - 4} textAnchor="middle">
                {valueFormat(t)}
              </text>
            </g>
          );
        })}
        <line className="axis-line" x1={labelWidth} x2={labelWidth} y1={0} y2={height - 18} />
        {data.map((d, i) => {
          const y = i * (barHeight + gap) + gap / 2;
          const w = (Math.max(0, d.value) / domainMax) * innerW;
          return (
            <g
              key={d.label}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelect?.(d)}
              style={{ cursor: onSelect ? "pointer" : "default" }}
            >
              <rect className="hit" x={0} y={y - gap / 2} width={width} height={barHeight + gap} />
              <text className="label" x={labelWidth - 10} y={y + barHeight / 2} dy="0.32em" textAnchor="end">
                {d.label.length > 18 ? `${d.label.slice(0, 17)}…` : d.label}
              </text>
              <path
                className={hover === i ? "bar hovered" : "bar"}
                d={hBarPath(labelWidth + 1, y, Math.max(w - 1, 2), barHeight)}
                fill={color}
              />
              <text className="value-label" x={labelWidth + w + 8} y={y + barHeight / 2} dy="0.32em">
                {valueFormat(d.value)}
                {showShare ? <tspan className="tick"> · {((d.value / total) * 100).toFixed(1)}%</tspan> : null}
              </text>
            </g>
          );
        })}
      </svg>
      {hover !== null && data[hover] ? (
        <div
          className="chart-tooltip"
          style={{
            left: Math.min(labelWidth + (data[hover].value / domainMax) * innerW * 0.5, width - 90),
            top: hover * (barHeight + gap) + gap / 2
          }}
        >
          <div className="tt-title">{data[hover].label}</div>
          <div className="tt-row">
            <span className="swatch" style={{ background: color }} />
            Value <b>{valueFormat(data[hover].value)}</b>
          </div>
          <div className="tt-row">
            Share <b>{((data[hover].value / total) * 100).toFixed(1)}%</b>
          </div>
          {data[hover].note ? <div className="tt-row">{data[hover].note}</div> : null}
        </div>
      ) : null}
    </div>
  );
};

export default BarChart;
