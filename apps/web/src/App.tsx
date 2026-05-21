import { useState } from "react";

type QueryResult = {
  columns: { name: string; type: string }[];
  rows: unknown[][];
  nextUri: string | null;
};

const initialSql = "SELECT c.name, c.industry, o.amount, o.status FROM customers c JOIN orders o ON c.id = o.customer_id LIMIT 10;";

const App = () => {
  const [sql, setSql] = useState(initialSql);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runQuery = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("http://localhost:3000/api/v1/query", {
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    if (!result?.nextUri) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await fetch("http://localhost:3000/api/v1/query/next", {
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
          <button className="button" onClick={runQuery} disabled={loading}>
            {loading ? "Running..." : "Run query"}
          </button>
        </div>
        <textarea
          className="sql-input"
          value={sql}
          onChange={(event) => setSql(event.target.value)}
          rows={5}
        />
        {error ? <p className="error">{error}</p> : null}
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
    </main>
  );
};

export default App;
