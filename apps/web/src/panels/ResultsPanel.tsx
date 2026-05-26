import CubeViewer from "../cube/CubeViewer";
import { canPivot } from "../cube/pivot";
import type { Column } from "@trace/shared-types";

type QueryResult = {
  columns: Column[];
  rows: unknown[][];
  rowCount?: number;
  durationMs?: number;
  cacheHit?: boolean;
  maskColumns?: string[];
  nextUri: string | null;
};

type Props = {
  result: QueryResult | null;
  sql: string;
  cubeMode: boolean;
  loading: boolean;
  exportStatus: string | null;
  apiOrigin: string;
  apiBase: string;
  headers: Record<string, string>;
  onToggleCubeMode: () => void;
  onDrill: (row: string, col: string) => void;
  onRunDemoQuery: (sql: string) => void;
  onLoadMore: () => void;
  onExportStatus: (msg: string | null) => void;
};

const ResultsPanel = ({
  result,
  sql,
  cubeMode,
  loading,
  exportStatus,
  apiOrigin,
  apiBase,
  headers,
  onToggleCubeMode,
  onDrill,
  onRunDemoQuery,
  onLoadMore,
  onExportStatus
}: Props) => (
  <section className="panel">
    <div className="panel-header">
      <h2>Results</h2>
      <div className="panel-header-actions">
        <span className="muted panel-step">5 · Analyze</span>
        <div className="button-row">
          {result && canPivot(result.columns, result.rows) ? (
            <button
              type="button"
              className={cubeMode ? "button" : "button ghost"}
              onClick={onToggleCubeMode}
            >
              {cubeMode ? "Table view" : "Cube view"}
            </button>
          ) : null}
          <button
            type="button"
            className="button ghost"
            disabled={!result || loading}
            onClick={async () => {
              if (!result) return;
              onExportStatus(null);
              try {
                const response = await fetch(`${apiBase}/exports`, {
                  method: "POST",
                  headers,
                  body: JSON.stringify({ sql, format: "csv" })
                });
                if (!response.ok) {
                  const payload = await response.json();
                  throw new Error(payload?.error?.message ?? "Export failed");
                }
                const payload = (await response.json()) as { downloadUrl: string };
                window.open(`${apiOrigin}${payload.downloadUrl}`, "_blank");
                onExportStatus("Export ready");
              } catch (err) {
                onExportStatus(err instanceof Error ? err.message : "Export failed");
              }
            }}
          >
            Export CSV
          </button>
          {result?.nextUri ? (
            <button type="button" className="button ghost" onClick={onLoadMore} disabled={loading}>
              Load more
            </button>
          ) : null}
        </div>
      </div>
    </div>
    {result ? (
      <div>
        <div className="meta-row">
          <span>Rows: {result.rowCount ?? result.rows.length}</span>
          <span>Duration: {result.durationMs ?? 0} ms</span>
          <span>{result.cacheHit ? "Cache hit" : "Live query"}</span>
          {result.maskColumns?.length ? (
            <span>Masked: {result.maskColumns.join(", ")}</span>
          ) : null}
        </div>
        {cubeMode && canPivot(result.columns, result.rows) ? (
          <CubeViewer
            columns={result.columns}
            rows={result.rows}
            onDrill={onDrill}
            onRunDemoQuery={onRunDemoQuery}
          />
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  {result.columns.map((column) => (
                    <th key={column.name}>{column.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, rowIndex) => (
                  <tr key={`${rowIndex}-${row.length}`}>
                    {row.map((cell, cellIndex) => (
                      <td key={`${rowIndex}-${cellIndex}`}>{String(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    ) : (
      <p className="muted">Run a query to see results. Try the cube demo preset for the 3D view.</p>
    )}
    {exportStatus ? <p className="status-meta">{exportStatus}</p> : null}
  </section>
);

export default ResultsPanel;
