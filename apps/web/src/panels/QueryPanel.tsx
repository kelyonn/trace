import type { StreamState } from "../hooks/useQueryStream";

type Props = {
  sql: string;
  quickQuery: string;
  loading: boolean;
  error: string | null;
  plan: string | null;
  streamState: StreamState;
  onSqlChange: (sql: string) => void;
  onQuickQueryChange: (key: string) => void;
  onExplain: () => void;
  onStream: () => void;
  onCancelStream: () => void;
  onRun: () => void;
};

const QueryPanel = ({
  sql,
  quickQuery,
  loading,
  error,
  plan,
  streamState,
  onSqlChange,
  onQuickQueryChange,
  onExplain,
  onStream,
  onCancelStream,
  onRun
}: Props) => (
  <section className="panel panel-sticky">
    <div className="panel-header">
      <h2>Query runner</h2>
      <div className="panel-header-actions">
        <span className="muted panel-step">4 · Run</span>
        <div className="button-row">
          <div className="select-wrapper">
            <select value={quickQuery} onChange={(e) => onQuickQueryChange(e.target.value)}>
              <option value="cube_by_status_region">Cube: status × region</option>
              <option value="cube_by_industry_category">Cube: industry × category</option>
              <option value="orders_by_status">Orders by status</option>
              <option value="revenue_by_region">Revenue by region</option>
              <option value="top_customers">Top customers</option>
              <option value="recent_orders">Recent orders</option>
            </select>
          </div>
          <button type="button" className="button ghost" onClick={onExplain} disabled={loading}>
            Explain
          </button>
          <button
            type="button"
            className="button ghost"
            onClick={onStream}
            disabled={loading || streamState.status === "streaming"}
          >
            {streamState.status === "streaming" ? "Streaming..." : "Stream"}
          </button>
          {streamState.status === "streaming" ? (
            <button type="button" className="button ghost" onClick={onCancelStream}>
              Cancel
            </button>
          ) : null}
          <button type="button" className="button" onClick={onRun} disabled={loading}>
            {loading ? "Running..." : "Run query"}
          </button>
        </div>
      </div>
    </div>
    <textarea
      className="sql-input"
      value={sql}
      onChange={(e) => onSqlChange(e.target.value)}
      rows={6}
    />
    {error ? <p className="error">{error}</p> : null}
    {plan ? <pre className="plan">{plan}</pre> : null}
  </section>
);

export default QueryPanel;
