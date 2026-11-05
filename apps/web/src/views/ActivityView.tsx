import { useEffect, useState } from "react";
import type { AlertRule, AssistantSummary, AuditEvent, HistoryItem, Notebook, Snapshot } from "@trace/shared-types";
import type { Requester } from "../lib/api";
import { formatDuration, formatNumber, relativeTime } from "../lib/format";
import Icon from "../components/Icon";

export type Metrics = {
  totalQueries: number;
  queryErrors: number;
  cacheHits: number;
  exports: number;
  auditCount?: number;
};

type Props = {
  request: Requester;
  refreshKey: number;
  sql: string;
  history: HistoryItem[];
  metrics: Metrics | null;
  snapshots: Snapshot[];
  notebooks: Notebook[];
  alerts: AlertRule[];
  assistant: AssistantSummary | null;
  onRunAssistant: () => void;
  onOpenSql: (sql: string) => void;
  onCreateSnapshot: () => void;
  onSaveNotebook: (n: { id?: string; title: string; content: string }) => Promise<Notebook | null>;
  onCreateAlert: (a: { name: string; comparison: AlertRule["comparison"]; threshold: number }) => void;
  onEvaluateAlert: (a: AlertRule) => void;
};

const ACTION_ICON: Record<string, string> = {
  query: "play",
  schema: "database",
  explain: "explain",
  activate_source: "login"
};

const ActivityView = (p: Props) => {
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [nbId, setNbId] = useState<string | undefined>();
  const [nbTitle, setNbTitle] = useState("");
  const [nbContent, setNbContent] = useState("");
  const [alertName, setAlertName] = useState("Revenue guardrail");
  const [comparison, setComparison] = useState<AlertRule["comparison"]>(">");
  const [threshold, setThreshold] = useState(1000);

  useEffect(() => {
    p.request<{ items: AuditEvent[] }>("/audit")
      .then((r) => setAudit((r.items ?? []).slice(0, 60)))
      .catch(() => undefined);
  }, [p.request, p.refreshKey, p.history.length]);

  const m = p.metrics;
  const hitRate = m && m.totalQueries + m.cacheHits > 0 ? (m.cacheHits / (m.totalQueries + m.cacheHits)) * 100 : 0;

  return (
    <>
      <div className="kpi-grid">
        {[
          { label: "Queries executed", icon: "play", value: m ? formatNumber(m.totalQueries) : "–" },
          { label: "Cache hit rate", icon: "layers", value: m ? `${hitRate.toFixed(0)}%` : "–", foot: m ? `${m.cacheHits} hits` : "" },
          { label: "Errors", icon: "alert", value: m ? formatNumber(m.queryErrors) : "–" },
          { label: "Exports", icon: "download", value: m ? formatNumber(m.exports) : "–" }
        ].map((k) => (
          <div className="card kpi" key={k.label}>
            <span className="kpi-label">
              <Icon name={k.icon} /> {k.label}
            </span>
            <span className="kpi-value">{k.value}</span>
            <span className="kpi-foot">{k.foot ?? "this API session"}</span>
          </div>
        ))}
      </div>

      <div className="dash-grid">
        <section className="card span-7">
          <div className="card-header">
            <div>
              <h2>Query history</h2>
              <p className="card-sub">Click to reopen in Explore (FR-9 replay)</p>
            </div>
            <span className="pill">{p.history.length}</span>
          </div>
          {p.history.length ? (
            <div className="history-list">
              {p.history.slice(0, 80).map((item) => (
                <button key={item.id} type="button" className="history-item" onClick={() => p.onOpenSql(item.sql)}>
                  <div>
                    <p className="history-sql">{item.sql.replace(/\s+/g, " ")}</p>
                    <p className="history-meta">
                      {relativeTime(item.submittedAt)} · {formatDuration(item.durationMs)} ·{" "}
                      {item.rowCount !== null ? `${formatNumber(item.rowCount)} rows` : item.error?.slice(0, 80)}
                    </p>
                  </div>
                  <span className={item.status === "failed" ? "pill bad" : "pill ok"}>
                    <Icon name={item.status === "failed" ? "x" : "check"} />
                    {item.status}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <Icon name="history" />
              <p>No queries yet.</p>
            </div>
          )}
        </section>

        <section className="card span-5">
          <div className="card-header">
            <div>
              <h2>Audit trail</h2>
              <p className="card-sub">Every data fetch, with source and time (FR-5)</p>
            </div>
            <Icon name="shield" size={18} className="muted" />
          </div>
          {audit.length ? (
            <div className="timeline">
              {audit.map((e) => (
                <div className="timeline-item" key={e.id}>
                  <span className={e.action === "query" ? "dot ok" : "dot"} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <Icon name={ACTION_ICON[e.action] ?? "info"} size={13} />
                      <b style={{ fontWeight: 600 }}>{e.action.replace("_", " ")}</b>
                      <span className="muted">· {e.dataSourceId}</span>
                    </div>
                    {e.detail ? (
                      <div className="history-sql muted" style={{ color: "var(--text-muted)" }}>
                        {e.detail.replace(/\s+/g, " ")}
                      </div>
                    ) : null}
                  </div>
                  <span className="muted" style={{ fontSize: 11.5, whiteSpace: "nowrap" }}>
                    {relativeTime(e.timestamp)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">No audit events yet.</p>
          )}
        </section>

        <section className="card span-7">
          <div className="card-header">
            <div>
              <h2>Insight assistant</h2>
              <p className="card-sub">Statistical summary of the current Explore query</p>
            </div>
            <button type="button" className="button ghost" onClick={p.onRunAssistant}>
              <Icon name="sparkle" /> Summarize
            </button>
          </div>
          {p.assistant ? (
            <div className="assistant-grid fade-in">
              <div className="assistant-card">
                <p className="muted" style={{ fontSize: 12 }}>
                  Rows
                </p>
                <p className="assistant-value">{formatNumber(p.assistant.rowCount)}</p>
              </div>
              <div className="assistant-card">
                <p className="muted" style={{ fontSize: 12 }}>
                  Columns
                </p>
                <p className="assistant-value">{p.assistant.columns.length}</p>
              </div>
              <div className="assistant-card">
                <p className="muted" style={{ fontSize: 12 }}>
                  Numeric
                </p>
                <p className="assistant-value">{p.assistant.numericStats.length}</p>
              </div>
              <div className="assistant-card wide">
                {p.assistant.numericStats.length ? (
                  <table>
                    <thead>
                      <tr>
                        <th>Column</th>
                        <th className="num">Min</th>
                        <th className="num">Avg</th>
                        <th className="num">Max</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.assistant.numericStats.map((s) => (
                        <tr key={s.column}>
                          <td>{s.column}</td>
                          <td className="num">{s.min === null ? "–" : formatNumber(s.min)}</td>
                          <td className="num">{s.avg === null ? "–" : formatNumber(s.avg)}</td>
                          <td className="num">{s.max === null ? "–" : formatNumber(s.max)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="muted">No numeric columns detected.</p>
                )}
              </div>
            </div>
          ) : (
            <pre className="plan" style={{ whiteSpace: "pre-wrap", marginTop: 0 }}>
              {p.sql}
            </pre>
          )}
        </section>

        <section className="card span-5">
          <div className="card-header">
            <div>
              <h2>Snapshots</h2>
              <p className="card-sub">Saved views of a query + result summary</p>
            </div>
            <button type="button" className="button ghost" onClick={p.onCreateSnapshot}>
              <Icon name="camera" /> Save current
            </button>
          </div>
          {p.snapshots.length ? (
            <div className="history-list">
              {p.snapshots.map((s) => (
                <button key={s.id} type="button" className="history-item" onClick={() => p.onOpenSql(s.sql)}>
                  <div>
                    <p className="status-title" style={{ fontSize: 13 }}>
                      {s.name}
                    </p>
                    <p className="history-meta">
                      {s.summary} · {relativeTime(s.createdAt)}
                    </p>
                  </div>
                  <Icon name="chevron" size={14} />
                </button>
              ))}
            </div>
          ) : (
            <p className="muted">No snapshots yet.</p>
          )}
        </section>

        <section className="card span-7">
          <div className="card-header">
            <div>
              <h2>Alerts</h2>
              <p className="card-sub">Evaluates the current query's first numeric value against a threshold</p>
            </div>
          </div>
          <div className="alert-form">
            <label>
              Name
              <input value={alertName} onChange={(e) => setAlertName(e.target.value)} />
            </label>
            <label>
              Comparison
              <select value={comparison} onChange={(e) => setComparison(e.target.value as AlertRule["comparison"])}>
                <option value=">">&gt;</option>
                <option value=">=">&gt;=</option>
                <option value="<">&lt;</option>
                <option value="<=">&lt;=</option>
              </select>
            </label>
            <label>
              Threshold
              <input type="number" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
            </label>
            <button type="button" className="button" onClick={() => p.onCreateAlert({ name: alertName, comparison, threshold })}>
              <Icon name="bell" /> Create
            </button>
          </div>
          {p.alerts.length ? (
            <div className="history-list">
              {p.alerts.map((a) => {
                const triggered = a.lastTriggeredAt && a.lastValue !== undefined;
                return (
                  <div key={a.id} className="history-item" style={{ cursor: "default" }}>
                    <div>
                      <p className="status-title" style={{ fontSize: 13 }}>
                        {a.name}
                      </p>
                      <p className="history-meta">
                        value {a.comparison} {formatNumber(a.threshold)} · last:{" "}
                        {a.lastValue !== undefined ? formatNumber(a.lastValue) : "never evaluated"}
                      </p>
                    </div>
                    <div className="button-row">
                      {a.lastValue !== undefined ? (
                        <span className={triggered ? "pill bad" : "pill ok"}>
                          <Icon name={triggered ? "alert" : "check"} />
                          {triggered ? "triggered" : "ok"}
                        </span>
                      ) : null}
                      <button type="button" className="button ghost" onClick={() => p.onEvaluateAlert(a)}>
                        Evaluate
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="muted">No alerts configured.</p>
          )}
        </section>

        <section className="card span-5">
          <div className="card-header">
            <div>
              <h2>Notebook</h2>
              <p className="card-sub">Narrative notes alongside your analysis</p>
            </div>
            <div className="button-row">
              <button
                type="button"
                className="button subtle"
                onClick={() => {
                  setNbId(undefined);
                  setNbTitle("");
                  setNbContent("");
                }}
              >
                <Icon name="plus" /> New
              </button>
              <button
                type="button"
                className="button"
                onClick={async () => {
                  const saved = await p.onSaveNotebook({ id: nbId, title: nbTitle || "Untitled", content: nbContent });
                  if (saved) setNbId(saved.id);
                }}
              >
                <Icon name="save" /> Save
              </button>
            </div>
          </div>
          <div className="notebook">
            <input value={nbTitle} onChange={(e) => setNbTitle(e.target.value)} placeholder="Title" aria-label="Notebook title" />
            <textarea
              rows={6}
              value={nbContent}
              onChange={(e) => setNbContent(e.target.value)}
              placeholder="APAC revenue grew fastest in 2025 — Software and Electronics drive it…"
              aria-label="Notebook content"
            />
            {p.notebooks.length ? (
              <div className="notebook-list">
                {p.notebooks.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    className={n.id === nbId ? "chip on" : "chip"}
                    onClick={() => {
                      setNbId(n.id);
                      setNbTitle(n.title);
                      setNbContent(n.content);
                    }}
                  >
                    <Icon name="notebook" /> {n.title}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </>
  );
};

export default ActivityView;
