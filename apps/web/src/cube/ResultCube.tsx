import { useMemo, useRef, useState } from "react";
import type { Column } from "@trace/shared-types";
import { columnKind, formatMeasure } from "../lib/format";
import { buildGrid, type AxisKey } from "./olap";
import CubeScene, { type CameraPreset, type Cell } from "./CubeScene";

type Props = { columns: Column[]; rows: unknown[][]; theme: string };

/**
 * Renders any query result with 1–3 dimension columns and a numeric measure as
 * an OLAP cube. Missing axes collapse to a single "Σ" member.
 */
export function cubeShape(columns: Column[], rows: unknown[][]) {
  const kinds = columns.map((c, i) => columnKind(c, rows[0]?.[i]));
  const measureIdx = kinds.lastIndexOf("number");
  if (measureIdx < 0) return null;
  const dims = kinds.map((k, i) => (k !== "number" ? i : -1)).filter((i) => i >= 0).slice(0, 3);
  if (dims.length < 2) return null;
  return { measureIdx, dims };
}

const ResultCube = ({ columns, rows, theme }: Props) => {
  const shape = useMemo(() => cubeShape(columns, rows), [columns, rows]);
  const [hover, setHover] = useState<Partial<Cell> | null>(null);
  const [selected, setSelected] = useState<Cell | null>(null);
  const [preset, setPreset] = useState<{ name: CameraPreset; nonce: number }>({ name: "iso", nonce: 0 });
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  const data = useMemo(() => {
    if (!shape) return null;
    const { dims, measureIdx } = shape;
    const mapped = rows.map((r) => [
      r[dims[0]],
      r[dims[1]],
      dims[2] !== undefined ? r[dims[2]] : "Σ",
      r[measureIdx]
    ]);
    const ordered = {
      x: columnKind(columns[dims[0]], rows[0]?.[dims[0]]) === "date",
      y: columnKind(columns[dims[1]], rows[0]?.[dims[1]]) === "date",
      z: dims[2] !== undefined && columnKind(columns[dims[2]], rows[0]?.[dims[2]]) === "date"
    };
    return { grid: buildGrid(mapped, ordered, 14), measure: columns[measureIdx].name };
  }, [shape, rows, columns]);

  if (!shape || !data) {
    return (
      <div className="empty-state">
        <p className="status-title">Not a cube-shaped result</p>
        <p>Return two or three dimension columns and one numeric measure.</p>
      </div>
    );
  }

  const visible = {
    x: data.grid.members.x.map(() => true),
    y: data.grid.members.y.map(() => true),
    z: data.grid.members.z.map(() => true)
  } as Record<AxisKey, boolean[]>;
  const titles = {
    x: columns[shape.dims[0]].name,
    y: columns[shape.dims[1]].name,
    z: shape.dims[2] !== undefined ? columns[shape.dims[2]].name : "—"
  };
  const fmt = (n: number) => formatMeasure(data.measure, n);
  const hv = hover && hover.x !== undefined && hover.y !== undefined && hover.z !== undefined ? (hover as Cell) : null;

  return (
    <div style={{ border: "1px solid var(--line)" }}>
      <div className="stage-toolbar">
        <div className="seg" role="group" aria-label="Camera">
          {(["iso", "front", "top", "side"] as CameraPreset[]).map((p) => (
            <button key={p} type="button" className={preset.name === p ? "on" : ""} onClick={() => setPreset((s) => ({ name: p, nonce: s.nonce + 1 }))}>
              {p === "iso" ? "Iso" : p === "front" ? "X·Y" : p === "top" ? "X·Z" : "Z·Y"}
            </button>
          ))}
        </div>
        <span className="toolbar-fill" />
        <span className="muted small mono">
          {data.grid.members.x.length}×{data.grid.members.y.length}×{data.grid.members.z.length} · {data.grid.cellCount} cells
        </span>
      </div>
      <div className="stage-canvas" ref={ref} style={{ height: 460, background: "var(--scene-bg)" }}>
        <CubeScene
          grid={data.grid}
          visible={visible}
          slice={null}
          hover={hover}
          selected={selected}
          axisTitles={titles}
          theme={theme}
          preset={preset}
          autoRotate={false}
          valueFormat={fmt}
          onHover={(c, client) => {
            setHover(c);
            if (c && client && ref.current) {
              const r = ref.current.getBoundingClientRect();
              setTip({ x: client.x - r.left, y: client.y - r.top });
            } else setTip(null);
          }}
          onSelect={setSelected}
          onDrill={() => undefined}
          onLabel={() => undefined}
        />
        {hv && tip ? (
          <div className="scene-tip" style={{ left: tip.x, top: tip.y }}>
            <div className="tip-coords">
              <span><i className="axis-dot axis-x" />{data.grid.members.x[hv.x].label}</span>
              <span><i className="axis-dot axis-y" />{data.grid.members.y[hv.y].label}</span>
              {shape.dims[2] !== undefined ? <span><i className="axis-dot axis-z" />{data.grid.members.z[hv.z].label}</span> : null}
            </div>
            <div className="tip-value">
              {data.measure} <b>{fmt(data.grid.values[hv.x][hv.y][hv.z] ?? 0)}</b>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default ResultCube;
