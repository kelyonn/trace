import { useEffect, useState } from "react";

type QueryResult = {
  queryId?: string;
  durationMs?: number;
  rowCount?: number;
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

  const apiBase = "http://localhost:3000/api/v1";

  useEffect(() => {
    const loadStatus = async () => {
      try {
        const response = await fetch(`${apiBase}/status`);
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
        const response = await fetch(`${apiBase}/schema`);
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
        const response = await fetch(`${apiBase}/history`);
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
        const response = await fetch(`${apiBase}/data-sources`);
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
  }, []);

  const runQuery = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${apiBase}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
            status: "completed"
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nextUri: result.nextUri })
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
      const response = await fetch(`${apiBase}/schema?table=${tableName}`);
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
        method: "POST"
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
      const response = await fetch(`${apiBase}/schema`);
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
      const response = await fetch(`${apiBase}/status`);
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
        headers: { "Content-Type": "application/json" },
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
          {result?.nextUri ? (
            <button className="button ghost" onClick={loadMore} disabled={loading}>
              Load more
            </button>
          ) : null}
        </div>
        {result ? (
          <div className="table-wrapper">
            <div className="meta-row">
              <span>Rows: {result.rowCount ?? result.rows.length}</span>
              <span>Duration: {result.durationMs ?? 0} ms</span>
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
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Query history</h2>
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
    </main>
  );
};

export default App;
