import { useEffect, useState } from "react";
import ThreePreview from "./ThreePreview";

type QueryResult = {
  queryId?: string;
  durationMs?: number;
  rowCount?: number;
  cacheHit?: boolean;
  maskColumns?: string[];
  columns: { name: string; type: string }[];
  rows: unknown[][];
  nextUri: string | null;
};

type StatusPayload = {
  trino: { ok: boolean; version: string | null; error: string | null };
  postgres: { ok: boolean; error: string | null };
  activeSourceId?: string | null;
};

type ColumnInfo = { name: string; type: string };

type HistoryItem = {
  id: string;
  sql: string;
  submittedAt: string;
  durationMs: number;
  rowCount: number | null;
  status: "completed" | "failed";
  error?: string;
  dataSourceId?: string;
};

type DataSource = {
  id: string;
  name: string;
  type: string;
  status: string;
};

type Metrics = {
  totalQueries: number;
  queryErrors: number;
  cacheHits: number;
  exports: number;
};

type Notebook = {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

type Snapshot = {
  id: string;
  name: string;
  sql: string;
  summary: string;
  createdAt: string;
};

type AssistantSummary = {
  rowCount: number;
  columns: string[];
  numericStats: { column: string; min: number | null; max: number | null; avg: number | null }[];
};

type AlertRule = {
  id: string;
  name: string;
  sql: string;
  comparison: ">" | "<" | ">=" | "<=";
  threshold: number;
  lastValue?: number;
  lastTriggeredAt?: string;
  createdAt: string;
};

const initialSql = "SELECT c.name, c.industry, o.amount, o.status FROM customers c JOIN orders o ON c.id = o.customer_id LIMIT 10;";

const App = () => {
  const [sql, setSql] = useState(initialSql);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [schemaTables, setSchemaTables] = useState<string[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [tableColumns, setTableColumns] = useState<ColumnInfo[]>([]);
  const [plan, setPlan] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [quickQuery, setQuickQuery] = useState("orders_by_status");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [dataSources, setDataSources] = useState<DataSource[]>([]);
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  const [builderTable, setBuilderTable] = useState<string | null>(null);
  const [builderColumns, setBuilderColumns] = useState<string[]>([]);
  const [builderLimit, setBuilderLimit] = useState(50);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("trace_api_key") ?? "");
  const [role, setRole] = useState(() => localStorage.getItem("trace_role") ?? "user");
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [activeNotebookId, setActiveNotebookId] = useState<string | null>(null);
  const [notebookTitle, setNotebookTitle] = useState("");
  const [notebookContent, setNotebookContent] = useState("");
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [assistantSummary, setAssistantSummary] = useState<AssistantSummary | null>(null);
  const [alertName, setAlertName] = useState("New alert");
  const [alertComparison, setAlertComparison] = useState<AlertRule["comparison"]>(">");
  const [alertThreshold, setAlertThreshold] = useState(1000);
  const [alerts, setAlerts] = useState<AlertRule[]>([]);

  const apiBase = "http://localhost:3000/api/v1";

  const getHeaders = () => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey.trim()) {
      headers.Authorization = `Bearer ${apiKey.trim()}`;
    }
    if (role) {
      headers["x-trace-role"] = role;
    }
    return headers;
  };

  useEffect(() => {
    const loadStatus = async () => {
      try {
        const response = await fetch(`${apiBase}/status`, { headers: getHeaders() });
        if (!response.ok) {
          throw new Error("Status check failed");
        }
        const payload = (await response.json()) as StatusPayload;
        setStatus(payload);
      } catch (err) {
        setStatusError(err instanceof Error ? err.message : "Status check failed");
      }
    };

    const loadTables = async () => {
      try {
        const response = await fetch(`${apiBase}/schema`, { headers: getHeaders() });
        if (!response.ok) {
          throw new Error("Schema fetch failed");
        }
        const payload = (await response.json()) as { tables: string[] };
        setSchemaTables(payload.tables ?? []);
      } catch (err) {
        setStatusError(err instanceof Error ? err.message : "Schema fetch failed");
      }
    };

    const loadHistory = async () => {
      try {
        const response = await fetch(`${apiBase}/history`, { headers: getHeaders() });
        if (!response.ok) {
          throw new Error("History fetch failed");
        }
        const payload = (await response.json()) as { items: HistoryItem[] };
        setHistory(payload.items ?? []);
      } catch (err) {
        setStatusError(err instanceof Error ? err.message : "History fetch failed");
      }
    };

    loadStatus();
    loadTables();
    loadHistory();

    const loadSources = async () => {
      try {
        const response = await fetch(`${apiBase}/data-sources`, { headers: getHeaders() });
        if (!response.ok) {
          throw new Error("Data sources fetch failed");
        }
        const payload = (await response.json()) as { items: DataSource[]; activeSourceId?: string };
        setDataSources(payload.items ?? []);
        setActiveSourceId(payload.activeSourceId ?? null);
      } catch (err) {
        setStatusError(err instanceof Error ? err.message : "Data sources fetch failed");
      }
    };

    loadSources();

    const loadMetrics = async () => {
      try {
        const response = await fetch(`${apiBase}/metrics`, { headers: getHeaders() });
        if (!response.ok) {
          throw new Error("Metrics fetch failed");
        }
        const payload = (await response.json()) as Metrics;
        setMetrics(payload);
      } catch (err) {
        setStatusError(err instanceof Error ? err.message : "Metrics fetch failed");
      }
    };

    loadMetrics();

    const loadNotebooks = async () => {
      try {
        const response = await fetch(`${apiBase}/notebooks`, { headers: getHeaders() });
        if (!response.ok) {
          throw new Error("Notebook fetch failed");
        }
        const payload = (await response.json()) as { items: Notebook[] };
        setNotebooks(payload.items ?? []);
      } catch (err) {
        setStatusError(err instanceof Error ? err.message : "Notebook fetch failed");
      }
    };

    const loadSnapshots = async () => {
      try {
        const response = await fetch(`${apiBase}/snapshots`, { headers: getHeaders() });
        if (!response.ok) {
          throw new Error("Snapshot fetch failed");
        }
        const payload = (await response.json()) as { items: Snapshot[] };
        setSnapshots(payload.items ?? []);
      } catch (err) {
        setStatusError(err instanceof Error ? err.message : "Snapshot fetch failed");
      }
    };

    const loadAlerts = async () => {
      try {
        const response = await fetch(`${apiBase}/alerts`, { headers: getHeaders() });
        if (!response.ok) {
          throw new Error("Alert fetch failed");
        }
        const payload = (await response.json()) as { items: AlertRule[] };
        setAlerts(payload.items ?? []);
      } catch (err) {
        setStatusError(err instanceof Error ? err.message : "Alert fetch failed");
      }
    };

    loadNotebooks();
    loadSnapshots();
    loadAlerts();
  }, [apiKey, role]);

  const runQuery = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${apiBase}/query`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ sql })
      });

      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload?.error?.message ?? "Request failed");
      }

      const payload = (await response.json()) as QueryResult;
      setResult(payload);
      if (payload.queryId) {
        setHistory((prev) => [
          {
            id: payload.queryId,
            sql,
            submittedAt: new Date().toISOString(),
            durationMs: payload.durationMs ?? 0,
            rowCount: payload.rowCount ?? 0,
            status: "completed",
            dataSourceId: activeSourceId ?? undefined
          },
          ...prev
        ]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  };

  const applyQuickQuery = (value: string) => {
    setQuickQuery(value);
    const templates: Record<string, string> = {
      orders_by_status:
        "SELECT status, COUNT(*) AS order_count, SUM(amount) AS total_amount FROM orders GROUP BY status ORDER BY total_amount DESC;",
      revenue_by_region:
        "SELECT c.region, SUM(o.amount) AS total_amount FROM customers c JOIN orders o ON c.id = o.customer_id GROUP BY c.region ORDER BY total_amount DESC;",
      top_customers:
        "SELECT c.name, SUM(o.amount) AS total_amount FROM customers c JOIN orders o ON c.id = o.customer_id GROUP BY c.name ORDER BY total_amount DESC LIMIT 5;",
      recent_orders:
        "SELECT o.id, c.name, o.amount, o.status, o.order_date FROM orders o JOIN customers c ON c.id = o.customer_id ORDER BY o.order_date DESC LIMIT 10;"
    };

    setSql(templates[value] ?? sql);
  };

  const loadMore = async () => {
    if (!result?.nextUri) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${apiBase}/query/next`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ nextUri: result.nextUri, columns: result.columns })
      });

      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload?.error?.message ?? "Request failed");
      }

      const payload = (await response.json()) as QueryResult;
      setResult({
        columns: payload.columns.length ? payload.columns : result.columns,
        rows: [...result.rows, ...payload.rows],
        nextUri: payload.nextUri
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  };

  const loadColumns = async (tableName: string) => {
    setSelectedTable(tableName);
    setTableColumns([]);
    setStatusError(null);
    try {
      const response = await fetch(`${apiBase}/schema?table=${tableName}`, { headers: getHeaders() });
      if (!response.ok) {
        throw new Error("Column fetch failed");
      }
      const payload = (await response.json()) as { columns: ColumnInfo[] };
      setTableColumns(payload.columns ?? []);
      setBuilderTable(tableName);
      setBuilderColumns(payload.columns?.map((column) => column.name) ?? []);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "Column fetch failed");
    }
  };

  const previewTable = async () => {
    if (!selectedTable) {
      return;
    }
    setSql(`SELECT * FROM ${selectedTable} LIMIT 20;`);
    await runQuery();
  };

  const toggleColumn = (column: string) => {
    setBuilderColumns((prev) =>
      prev.includes(column) ? prev.filter((item) => item !== column) : [...prev, column]
    );
  };

  const buildSql = () => {
    if (!builderTable) {
      setStatusError("Select a table to build a query.");
      return;
    }
    const columns = builderColumns.length ? builderColumns.join(", ") : "*";
    const limit = Number.isFinite(builderLimit) ? Math.max(1, builderLimit) : 50;
    setSql(`SELECT ${columns} FROM ${builderTable} LIMIT ${limit};`);
  };

  const activateSource = async (id: string) => {
    setStatusError(null);
    try {
      const response = await fetch(`${apiBase}/data-sources/${id}/activate`, {
        method: "POST",
        headers: getHeaders()
      });
      if (!response.ok) {
        throw new Error("Failed to activate source");
      }
      const payload = (await response.json()) as { activeSourceId: string };
      setActiveSourceId(payload.activeSourceId);
      await Promise.all([loadSchemaTables(), loadStatusOnly()]);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "Failed to activate source");
    }
  };

  const loadSchemaTables = async () => {
    try {
      const response = await fetch(`${apiBase}/schema`, { headers: getHeaders() });
      if (!response.ok) {
        throw new Error("Schema fetch failed");
      }
      const payload = (await response.json()) as { tables: string[] };
      setSchemaTables(payload.tables ?? []);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "Schema fetch failed");
    }
  };

  const loadStatusOnly = async () => {
    try {
      const response = await fetch(`${apiBase}/status`, { headers: getHeaders() });
      if (!response.ok) {
        throw new Error("Status check failed");
      }
      const payload = (await response.json()) as StatusPayload;
      setStatus(payload);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "Status check failed");
    }
  };

  const fillFromHistory = (item: HistoryItem) => {
    setSql(item.sql);
  };

  const explainQuery = async () => {
    setPlan(null);
    setStatusError(null);
    try {
      const response = await fetch(`${apiBase}/explain`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ sql })
      });

      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload?.error?.message ?? "Explain failed");
      }

      const payload = (await response.json()) as { plan: string };
      setPlan(payload.plan);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "Explain failed");
    }
  };

  const createNotebook = async () => {
    try {
      const response = await fetch(`${apiBase}/notebooks`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ title: notebookTitle || "Untitled", content: notebookContent })
      });
      if (!response.ok) {
        throw new Error("Notebook create failed");
      }
      const payload = (await response.json()) as Notebook;
      setNotebooks((prev) => [payload, ...prev]);
      setActiveNotebookId(payload.id);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "Notebook create failed");
    }
  };

  const saveNotebook = async () => {
    if (!activeNotebookId) {
      return;
    }
    try {
      const response = await fetch(`${apiBase}/notebooks/${activeNotebookId}`, {
        method: "PUT",
        headers: getHeaders(),
        body: JSON.stringify({ title: notebookTitle, content: notebookContent })
      });
      if (!response.ok) {
        throw new Error("Notebook save failed");
      }
      const payload = (await response.json()) as Notebook;
      setNotebooks((prev) => prev.map((item) => (item.id === payload.id ? payload : item)));
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "Notebook save failed");
    }
  };

  const selectNotebook = (notebook: Notebook) => {
    setActiveNotebookId(notebook.id);
    setNotebookTitle(notebook.title);
    setNotebookContent(notebook.content);
  };

  const createSnapshot = async () => {
    const summary = result
      ? `Rows: ${result.rowCount ?? result.rows.length}, Duration: ${result.durationMs ?? 0} ms`
      : "No results";
    try {
      const response = await fetch(`${apiBase}/snapshots`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ name: `Snapshot ${new Date().toLocaleTimeString()}`, sql, summary })
      });
      if (!response.ok) {
        throw new Error("Snapshot create failed");
      }
      const payload = (await response.json()) as Snapshot;
      setSnapshots((prev) => [payload, ...prev]);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "Snapshot create failed");
    }
  };

  const runAssistant = async () => {
    setAssistantSummary(null);
    try {
      const response = await fetch(`${apiBase}/assistant/summary`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ sql })
      });
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload?.error?.message ?? "Assistant failed");
      }
      const payload = (await response.json()) as AssistantSummary;
      setAssistantSummary(payload);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "Assistant failed");
    }
  };

  const createAlert = async () => {
    try {
      const response = await fetch(`${apiBase}/alerts`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({
          name: alertName,
          sql,
          comparison: alertComparison,
          threshold: alertThreshold
        })
      });
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload?.error?.message ?? "Alert create failed");
      }
      const payload = (await response.json()) as AlertRule;
      setAlerts((prev) => [payload, ...prev]);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "Alert create failed");
    }
  };

  const evaluateAlert = async (alert: AlertRule) => {
    try {
      const response = await fetch(`${apiBase}/alerts/${alert.id}/evaluate`, {
        method: "POST",
        headers: getHeaders()
      });
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload?.error?.message ?? "Alert evaluation failed");
      }
      const payload = (await response.json()) as { id: string; value: number | null; triggered: boolean };
      setAlerts((prev) =>
        prev.map((item) =>
          item.id === payload.id
            ? {
                ...item,
                lastValue: payload.value ?? undefined,
                lastTriggeredAt: payload.triggered ? new Date().toISOString() : item.lastTriggeredAt
              }
            : item
        )
      );
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "Alert evaluation failed");
    }
  };

  return (
    <main className="page">
      <section className="hero">
        <p className="eyebrow">Trace</p>
        <h1>Live OLAP exploration with a 3-D edge.</h1>
        <p className="subhead">
          Run a query through Trino and inspect the results in a fast, minimal UI.
        </p>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Access</h2>
          <span className="muted">Optional API key + role</span>
        </div>
        <div className="access-grid">
          <label>
            API key
            <input
              type="password"
              value={apiKey}
              onChange={(event) => {
                const value = event.target.value;
                setApiKey(value);
                localStorage.setItem("trace_api_key", value);
              }}
              placeholder="Leave empty for local dev"
            />
          </label>
          <label>
            Role
            <select
              value={role}
              onChange={(event) => {
                const value = event.target.value;
                setRole(value);
                localStorage.setItem("trace_role", value);
              }}
            >
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
          </label>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Query runner</h2>
          <div className="button-row">
            <div className="select-wrapper">
              <select
                value={quickQuery}
                onChange={(event) => applyQuickQuery(event.target.value)}
              >
                <option value="orders_by_status">Orders by status</option>
                <option value="revenue_by_region">Revenue by region</option>
                <option value="top_customers">Top customers</option>
                <option value="recent_orders">Recent orders</option>
              </select>
            </div>
            <button className="button ghost" onClick={explainQuery} disabled={loading}>
              Explain
            </button>
            <button className="button" onClick={runQuery} disabled={loading}>
              {loading ? "Running..." : "Run query"}
            </button>
          </div>
        </div>
        <textarea
          className="sql-input"
          value={sql}
          onChange={(event) => setSql(event.target.value)}
          rows={5}
        />
        {error ? <p className="error">{error}</p> : null}
        {plan ? (
          <pre className="plan">{plan}</pre>
        ) : null}
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Insight assistant</h2>
          <button className="button ghost" onClick={runAssistant} disabled={loading}>
            Summarize
          </button>
        </div>
        {assistantSummary ? (
          <div className="assistant-grid">
            <div className="assistant-card">
              <p className="status-title">Rows</p>
              <p className="assistant-value">{assistantSummary.rowCount}</p>
            </div>
            <div className="assistant-card">
              <p className="status-title">Columns</p>
              <p className="assistant-value">{assistantSummary.columns.length}</p>
            </div>
            <div className="assistant-card wide">
              <p className="status-title">Numeric stats</p>
              {assistantSummary.numericStats.length ? (
                <ul>
                  {assistantSummary.numericStats.map((stat) => (
                    <li key={stat.column}>
                      <span>{stat.column}</span>
                      <span className="muted">min {stat.min ?? "-"}, max {stat.max ?? "-"}, avg {stat.avg ?? "-"}</span>
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

      <section className="panel split">
        <div>
          <div className="panel-header">
            <h2>Connection status</h2>
          </div>
          {status ? (
            <div className="status-grid">
              <div className="status-card">
                <p className="status-title">Trino</p>
                <span className={status.trino.ok ? "pill ok" : "pill warn"}>
                  {status.trino.ok ? "Online" : "Offline"}
                </span>
                <p className="status-meta">
                  {status.trino.ok ? `v${status.trino.version ?? "unknown"}` : status.trino.error}
                </p>
              </div>
              <div className="status-card">
                <p className="status-title">Postgres</p>
                <span className={status.postgres.ok ? "pill ok" : "pill warn"}>
                  {status.postgres.ok ? "Online" : "Offline"}
                </span>
                <p className="status-meta">
                  {status.postgres.ok ? "Ready" : status.postgres.error}
                </p>
              </div>
            </div>
          ) : (
            <p className="muted">Checking services...</p>
          )}
          <div className="status-meta">
            Active source: {activeSourceId ?? status?.activeSourceId ?? "none"}
          </div>
          {statusError ? <p className="error">{statusError}</p> : null}
        </div>
        <div>
          <div className="panel-header">
            <h2>Schema browser</h2>
          </div>
          <div className="schema-grid">
            <div className="schema-list">
              {schemaTables.length ? (
                schemaTables.map((table) => (
                  <button
                    key={table}
                    className={table === selectedTable ? "schema-item active" : "schema-item"}
                    onClick={() => loadColumns(table)}
                  >
                    {table}
                  </button>
                ))
              ) : (
                <p className="muted">No tables found.</p>
              )}
            </div>
            <div className="schema-detail">
              {selectedTable ? (
                <>
                  <div className="schema-header">
                    <p className="status-title">{selectedTable}</p>
                    <button className="button ghost" onClick={previewTable} disabled={loading}>
                      Preview
                    </button>
                  </div>
                  {tableColumns.length ? (
                    <ul>
                      {tableColumns.map((column) => (
                        <li key={`${selectedTable}-${column.name}`}>
                          <span>{column.name}</span>
                          <span className="muted">{column.type}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted">Loading columns...</p>
                  )}
                </>
              ) : (
                <p className="muted">Select a table to inspect columns.</p>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="panel split">
        <div>
          <div className="panel-header">
            <h2>Data sources</h2>
          </div>
          <div className="source-list">
            {dataSources.length ? (
              dataSources.map((source) => (
                <button
                  key={source.id}
                  className={source.id === activeSourceId ? "source-item active" : "source-item"}
                  onClick={() => activateSource(source.id)}
                >
                  <div>
                    <p className="status-title">{source.name}</p>
                    <p className="status-meta">{source.type} · {source.status}</p>
                  </div>
                  <span className={source.id === activeSourceId ? "pill ok" : "pill warn"}>
                    {source.id === activeSourceId ? "Active" : "Select"}
                  </span>
                </button>
              ))
            ) : (
              <p className="muted">No data sources configured.</p>
            )}
          </div>
        </div>
        <div>
          <div className="panel-header">
            <h2>Visual builder</h2>
            <button className="button ghost" onClick={buildSql}>
              Build SQL
            </button>
          </div>
          <div className="builder">
            <label>
              Table
              <select
                value={builderTable ?? ""}
                onChange={(event) => loadColumns(event.target.value)}
              >
                <option value="" disabled>
                  Select a table
                </option>
                {schemaTables.map((table) => (
                  <option key={table} value={table}>
                    {table}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Limit
              <input
                type="number"
                min={1}
                value={builderLimit}
                onChange={(event) => setBuilderLimit(Number(event.target.value))}
              />
            </label>
            <div className="builder-columns">
              {tableColumns.length ? (
                tableColumns.map((column) => (
                  <label key={column.name} className="checkbox">
                    <input
                      type="checkbox"
                      checked={builderColumns.includes(column.name)}
                      onChange={() => toggleColumn(column.name)}
                    />
                    <span>{column.name}</span>
                  </label>
                ))
              ) : (
                <p className="muted">Select a table to choose columns.</p>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Results</h2>
          <div className="button-row">
            <button
              className="button ghost"
              disabled={!result || loading}
              onClick={async () => {
                if (!result) {
                  return;
                }
                setExportStatus(null);
                try {
                  const response = await fetch(`${apiBase}/exports`, {
                    method: "POST",
                    headers: getHeaders(),
                    body: JSON.stringify({ sql, format: "csv" })
                  });
                  if (!response.ok) {
                    const payload = await response.json();
                    throw new Error(payload?.error?.message ?? "Export failed");
                  }
                  const payload = (await response.json()) as { downloadUrl: string };
                  window.open(`http://localhost:3000${payload.downloadUrl}`, "_blank");
                  setExportStatus("Export ready");
                } catch (err) {
                  setExportStatus(err instanceof Error ? err.message : "Export failed");
                }
              }}
            >
              Export CSV
            </button>
            {result?.nextUri ? (
              <button className="button ghost" onClick={loadMore} disabled={loading}>
                Load more
              </button>
            ) : null}
          </div>
        </div>
        {result ? (
          <div className="table-wrapper">
            <div className="meta-row">
              <span>Rows: {result.rowCount ?? result.rows.length}</span>
              <span>Duration: {result.durationMs ?? 0} ms</span>
              <span>{result.cacheHit ? "Cache hit" : "Live query"}</span>
              {result.maskColumns?.length ? (
                <span>Masked: {result.maskColumns.join(", ")}</span>
              ) : null}
            </div>
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
        ) : (
          <p className="muted">Run a query to see results.</p>
        )}
        {exportStatus ? <p className="status-meta">{exportStatus}</p> : null}
      </section>

      <section className="panel split">
        <div>
          <div className="panel-header">
            <h2>Snapshots</h2>
            <button className="button ghost" onClick={createSnapshot} disabled={loading}>
              Save snapshot
            </button>
          </div>
          {snapshots.length ? (
            <div className="history-list">
              {snapshots.map((snapshot) => (
                <button
                  key={snapshot.id}
                  className="history-item"
                  onClick={() => setSql(snapshot.sql)}
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
              <button className="button ghost" onClick={createNotebook}>
                New
              </button>
              <button className="button" onClick={saveNotebook}>
                Save
              </button>
            </div>
          </div>
          <div className="notebook">
            <label>
              Title
              <input
                value={notebookTitle}
                onChange={(event) => setNotebookTitle(event.target.value)}
                placeholder="Notebook title"
              />
            </label>
            <label>
              Notes
              <textarea
                rows={6}
                value={notebookContent}
                onChange={(event) => setNotebookContent(event.target.value)}
                placeholder="Write notes here..."
              />
            </label>
            <div className="notebook-list">
              {notebooks.map((item) => (
                <button
                  key={item.id}
                  className={item.id === activeNotebookId ? "schema-item active" : "schema-item"}
                  onClick={() => selectNotebook(item)}
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
          <h2>3-D preview</h2>
          <span className="muted">Auto fallback to 2-D if performance drops.</span>
        </div>
        <ThreePreview metric={result?.rows.length ?? 0} />
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Query history</h2>
          {metrics ? (
            <span className="muted">
              Q: {metrics.totalQueries} · Errors: {metrics.queryErrors} · Cache: {metrics.cacheHits}
            </span>
          ) : null}
        </div>
        {history.length ? (
          <div className="history-list">
            {history.map((item) => (
              <button
                key={item.id}
                className={item.status === "failed" ? "history-item warn" : "history-item"}
                onClick={() => fillFromHistory(item)}
              >
                <div>
                  <p className="history-sql">{item.sql}</p>
                  <p className="history-meta">
                    {new Date(item.submittedAt).toLocaleString()} · {item.durationMs} ms · {item.dataSourceId ?? "source"}
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

      <section className="panel">
        <div className="panel-header">
          <h2>Alerts</h2>
        </div>
        <div className="alert-form">
          <label>
            Name
            <input value={alertName} onChange={(event) => setAlertName(event.target.value)} />
          </label>
          <label>
            Comparison
            <select
              value={alertComparison}
              onChange={(event) => setAlertComparison(event.target.value as AlertRule["comparison"])}
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
              value={alertThreshold}
              onChange={(event) => setAlertThreshold(Number(event.target.value))}
            />
          </label>
          <button className="button" onClick={createAlert}>
            Create alert
          </button>
        </div>
        {alerts.length ? (
          <div className="history-list">
            {alerts.map((alert) => (
              <div key={alert.id} className="history-item">
                <div>
                  <p className="history-sql">{alert.name}</p>
                  <p className="history-meta">
                    {alert.comparison} {alert.threshold} · Last: {alert.lastValue ?? "-"}
                  </p>
                </div>
                <button className="button ghost" onClick={() => evaluateAlert(alert)}>
                  Evaluate
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">No alerts configured.</p>
        )}
      </section>
    </main>
  );
};

export default App;
