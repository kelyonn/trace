import type {
  AlertRule,
  AssistantSummary,
  HistoryItem,
  Notebook,
  Snapshot
} from "@trace/shared-types";
import type { StreamState } from "../hooks/useQueryStream";
import type { Column } from "@trace/shared-types";

type Metrics = {
  totalQueries: number;
  queryErrors: number;
  cacheHits: number;
  exports: number;
};

type Props = {
  streamState: StreamState;
  assistantSummary: AssistantSummary | null;
  loading: boolean;
  history: HistoryItem[];
  metrics: Metrics | null;
  snapshots: Snapshot[];
  notebooks: Notebook[];
  activeNotebookId: string | null;
  notebookTitle: string;
  notebookContent: string;
  alerts: AlertRule[];
  alertName: string;
  alertComparison: AlertRule["comparison"];
  alertThreshold: number;
  onRunAssistant: () => void;
  onFillHistory: (item: HistoryItem) => void;
  onCreateSnapshot: () => void;
  onSetSql: (sql: string) => void;
  onCreateNotebook: () => void;
  onSaveNotebook: () => void;
  onSelectNotebook: (n: Notebook) => void;
  onNotebookTitleChange: (t: string) => void;
  onNotebookContentChange: (c: string) => void;
  onAlertNameChange: (n: string) => void;
  onAlertComparisonChange: (c: AlertRule["comparison"]) => void;
  onAlertThresholdChange: (n: number) => void;
  onCreateAlert: () => void;
  onEvaluateAlert: (a: AlertRule) => void;
};

const StreamBlock = ({ streamState }: { streamState: StreamState }) => {
  if (streamState.status === "idle") return null;
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Stream results</h2>
        <span className="muted">
          {streamState.status === "streaming"
            ? `Streaming — ${streamState.rowCount} rows so far…`
            : streamState.status === "complete"
            ? `Complete — ${streamState.rowCount} rows in ${streamState.durationMs} ms`
            : streamState.status === "error"
            ? "Error"
            : ""}
        </span>
      </div>
      {streamState.status === "error" ? (
        <p className="error">{streamState.message}</p>
      ) : streamState.status === "streaming" || streamState.status === "complete" ? (
        <div className="table-wrapper">
          {streamState.status === "streaming" ? (
            <div className="meta-row">
              <span className="pill warn">Live</span>
              <span>{streamState.rowCount} rows received</span>
            </div>
          ) : null}
          <table>
            <thead>
              <tr>
                {streamState.columns.map((col: Column) => (
                  <th key={col.name}>{col.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {streamState.rows.slice(0, 200).map((row, ri) => (
                <tr key={ri}>
                  {(row as unknown[]).map((cell, ci) => (
                    <td key={ci}>{String(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {streamState.rows.length > 200 ? (
            <p className="muted" style={{ marginTop: 8 }}>
              Showing first 200 of {streamState.rows.length} rows.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
};

const GovernancePanel = (props: Props) => (
  <>
    <StreamBlock streamState={props.streamState} />
    <details className="panel panel-details" open>
      <summary className="panel-details-summary">More — insights, history, snapshots</summary>
      <div className="panel-details-body">
        <section className="panel">
          <div className="panel-header">
            <h2>Insight assistant</h2>
            <button type="button" className="button ghost" onClick={props.onRunAssistant} disabled={props.loading}>
              Summarize
            </button>
          </div>
          {props.assistantSummary ? (
            <div className="assistant-grid">
              <div className="assistant-card">
                <p className="status-title">Rows</p>
                <p className="assistant-value">{props.assistantSummary.rowCount}</p>
              </div>
              <div className="assistant-card">
                <p className="status-title">Columns</p>
                <p className="assistant-value">{props.assistantSummary.columns.length}</p>
              </div>
              <div className="assistant-card wide">
                <p className="status-title">Numeric stats</p>
                {props.assistantSummary.numericStats.length ? (
                  <ul>
                    {props.assistantSummary.numericStats.map((stat) => (
                      <li key={stat.column}>
                        <span>{stat.column}</span>
                        <span className="muted">
                          min {stat.min ?? "-"}, max {stat.max ?? "-"}, avg {stat.avg ?? "-"}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">No numeric columns detected.</p>
                )}
              </div>
            </div>
          ) : (
            <p className="muted">Run a summary to see quick stats.</p>
          )}
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>Query history</h2>
            {props.metrics ? (
              <span className="muted">
                Q: {props.metrics.totalQueries} · Errors: {props.metrics.queryErrors} · Cache:{" "}
                {props.metrics.cacheHits}
              </span>
            ) : null}
          </div>
          {props.history.length ? (
            <div className="history-list">
              {props.history.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={item.status === "failed" ? "history-item warn" : "history-item"}
                  onClick={() => props.onFillHistory(item)}
                >
                  <div>
                    <p className="history-sql">{item.sql}</p>
                    <p className="history-meta">
                      {new Date(item.submittedAt).toLocaleString()} · {item.durationMs} ms ·{" "}
                      {item.dataSourceId ?? "source"}
                    </p>
                  </div>
                  <span className={item.status === "failed" ? "pill warn" : "pill ok"}>
                    {item.status}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="muted">No queries recorded yet.</p>
          )}
        </section>

        <section className="panel split">
          <div>
            <div className="panel-header">
              <h2>Snapshots</h2>
              <button type="button" className="button ghost" onClick={props.onCreateSnapshot} disabled={props.loading}>
                Save snapshot
              </button>
            </div>
            {props.snapshots.length ? (
              <div className="history-list">
                {props.snapshots.map((snapshot) => (
                  <button
                    key={snapshot.id}
                    type="button"
                    className="history-item"
                    onClick={() => props.onSetSql(snapshot.sql)}
                  >
                    <div>
                      <p className="history-sql">{snapshot.name}</p>
                      <p className="history-meta">{snapshot.summary}</p>
                    </div>
                    <span className="pill ok">Open</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted">No snapshots yet.</p>
            )}
          </div>
          <div>
            <div className="panel-header">
              <h2>Notebook</h2>
              <div className="button-row">
                <button type="button" className="button ghost" onClick={props.onCreateNotebook}>
                  New
                </button>
                <button type="button" className="button" onClick={props.onSaveNotebook}>
                  Save
                </button>
              </div>
            </div>
            <div className="notebook">
              <label>
                Title
                <input
                  value={props.notebookTitle}
                  onChange={(e) => props.onNotebookTitleChange(e.target.value)}
                  placeholder="Notebook title"
                />
              </label>
              <label>
                Notes
                <textarea
                  rows={6}
                  value={props.notebookContent}
                  onChange={(e) => props.onNotebookContentChange(e.target.value)}
                  placeholder="Write notes here..."
                />
              </label>
              <div className="notebook-list">
                {props.notebooks.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={item.id === props.activeNotebookId ? "schema-item active" : "schema-item"}
                    onClick={() => props.onSelectNotebook(item)}
                  >
                    {item.title}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>Alerts</h2>
          </div>
          <div className="alert-form">
            <label>
              Name
              <input value={props.alertName} onChange={(e) => props.onAlertNameChange(e.target.value)} />
            </label>
            <label>
              Comparison
              <select
                value={props.alertComparison}
                onChange={(e) => props.onAlertComparisonChange(e.target.value as AlertRule["comparison"])}
              >
                <option value=">">&gt;</option>
                <option value=">=">&gt;=</option>
                <option value="<">&lt;</option>
                <option value="<=">&lt;=</option>
              </select>
            </label>
            <label>
              Threshold
              <input
                type="number"
                value={props.alertThreshold}
                onChange={(e) => props.onAlertThresholdChange(Number(e.target.value))}
              />
            </label>
            <button type="button" className="button" onClick={props.onCreateAlert}>
              Create alert
            </button>
          </div>
          {props.alerts.length ? (
            <div className="history-list">
              {props.alerts.map((alert) => (
                <div key={alert.id} className="history-item">
                  <div>
                    <p className="history-sql">{alert.name}</p>
                    <p className="history-meta">
                      {alert.comparison} {alert.threshold} · Last: {alert.lastValue ?? "-"}
                    </p>
                  </div>
                  <button type="button" className="button ghost" onClick={() => props.onEvaluateAlert(alert)}>
                    Evaluate
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">No alerts configured.</p>
          )}
        </section>
      </div>
    </details>
  </>
);

export default GovernancePanel;
