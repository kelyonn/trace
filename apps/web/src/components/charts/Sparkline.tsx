import { useWidth } from "./useWidth";

type Props = { values: number[]; color?: string; height?: number };

const Sparkline = ({ values, color = "var(--series-1)", height = 36 }: Props) => {
  const [ref, width] = useWidth<HTMLDivElement>(200);
  if (values.length < 2) return <div className="sparkline" ref={ref} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = 3;
  const x = (i: number) => pad + (i / (values.length - 1)) * (width - pad * 2);
  const y = (v: number) => pad + (1 - (v - min) / (max - min || 1)) * (height - pad * 2);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const id = `sp-${Math.random().toString(36).slice(2, 8)}`;
  return (
    <div className="sparkline" ref={ref} aria-hidden>
      <svg width={width} height={height}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity={0.25} />
            <stop offset="1" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={`${d}L${x(values.length - 1)},${height}L${x(0)},${height}Z`} fill={`url(#${id})`} />
        <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={3} fill={color} />
      </svg>
    </div>
  );
};

export default Sparkline;
