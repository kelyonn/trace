import { useLayoutEffect, useRef, useState } from "react";

/** Tracks an element's content width so SVG charts can render at native resolution. */
export function useWidth<T extends HTMLElement>(fallback = 600) {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(Math.max(120, Math.floor(el.clientWidth)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

export const SERIES_VARS = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
  "var(--series-6)",
  "var(--series-7)",
  "var(--series-8)"
];

/** Fixed-order categorical color: slot i, never cycled past 8. */
export function seriesColor(index: number): string {
  return SERIES_VARS[Math.min(index, SERIES_VARS.length - 1)];
}

/** Rounded-end horizontal bar path: square at the baseline, 4px radius at the data end. */
export function hBarPath(x: number, y: number, w: number, h: number, r = 4): string {
  const rr = Math.min(r, w / 2, h / 2);
  if (w <= 0) return "";
  return `M${x},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h - rr}Q${x + w},${y + h} ${x + w - rr},${y + h}H${x}Z`;
}

/** Rounded-top vertical bar path anchored at baseline y0. */
export function vBarPath(x: number, y: number, w: number, h: number, r = 4): string {
  const rr = Math.min(r, w / 2, h / 2);
  if (h <= 0) return "";
  const y0 = y + h;
  return `M${x},${y0}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y0}Z`;
}
