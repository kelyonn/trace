import { useMemo, useState } from "react";
import type { Column } from "@trace/shared-types";
import { columnKind, formatCell } from "../lib/format";
import Icon from "./Icon";

type Props = {
  columns: Column[];
  rows: unknown[][];
  maskColumns?: string[];
  maxRows?: number;
};

const DataTable = ({ columns, rows, maskColumns = [], maxRows = 1000 }: Props) => {
  const [sort, setSort] = useState<{ idx: number; dir: 1 | -1 } | null>(null);
  const kinds = useMemo(() => columns.map((c, i) => columnKind(c, rows[0]?.[i])), [columns, rows]);
  const maxByCol = useMemo(
    () =>
      columns.map((_, i) =>
        kinds[i] === "number" ? Math.max(0, ...rows.slice(0, maxRows).map((r) => Number(r[i]) || 0)) : 0
      ),
    [columns, rows, kinds, maxRows]
  );

  const sorted = useMemo(() => {
    const base = rows.slice(0, maxRows);
    if (!sort) return base;
    const { idx, dir } = sort;
    const numeric = kinds[idx] === "number";
    return [...base].sort((a, b) => {
      const x = a[idx];
      const y = b[idx];
      if (numeric) return (Number(x) - Number(y)) * dir;
      return String(x).localeCompare(String(y)) * dir;
    });
  }, [rows, sort, kinds, maxRows]);

  const masked = new Set(maskColumns);
  // Inline magnitude bars only on the last numeric column (the usual measure).
  const barCol = kinds.lastIndexOf("number");

  return (
    <div className="table-wrapper">
      <table>
        <thead>
          <tr>
            {columns.map((col, i) => (
              <th
                key={`${col.name}-${i}`}
                className={kinds[i] === "number" ? "num" : undefined}
                onClick={() =>
                  setSort((prev) =>
                    prev?.idx === i ? (prev.dir === -1 ? { idx: i, dir: 1 } : null) : { idx: i, dir: -1 }
                  )
                }
                title={col.type}
              >
                <span className="th-inner">
                  {col.name}
                  {sort?.idx === i ? <Icon name={sort.dir === -1 ? "down" : "up"} size={12} /> : null}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => {
                const kind = kinds[ci];
                const isMasked = masked.has(columns[ci]?.name) && /^\*+$|^\[masked\]$|^masked$/i.test(String(cell));
                const text = formatCell(cell, kind);
                if (ci === barCol && kind === "number" && maxByCol[ci] > 0 && rows.length > 1) {
                  const pct = Math.max(0, Math.min(100, ((Number(cell) || 0) / maxByCol[ci]) * 100));
                  return (
                    <td key={ci} className="num">
                      <span className="cell-bar" style={{ ["--w" as string]: `${pct}%` }}>
                        <span>{text}</span>
                      </span>
                    </td>
                  );
                }
                return (
                  <td key={ci} className={[kind === "number" ? "num" : "", isMasked ? "masked" : ""].join(" ").trim() || undefined}>
                    {text}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > maxRows ? (
        <p className="muted" style={{ padding: "8px 12px" }}>
          Showing first {maxRows.toLocaleString()} of {rows.length.toLocaleString()} rows.
        </p>
      ) : null}
    </div>
  );
};

export default DataTable;
