import type { DataSource } from "@trace/shared-types";
import type { StatusPayload } from "./types";

type Props = {
  status: StatusPayload | null;
  statusError: string | null;
  activeSourceId: string | null;
  dataSources: DataSource[];
  onActivateSource: (id: string) => void;
};

const ConnectionPanel = ({
  status,
  statusError,
  activeSourceId,
  dataSources,
  onActivateSource
}: Props) => (
  <section className="panel split">
    <div>
      <div className="panel-header">
        <h2>Connection status</h2>
        <span className="muted panel-step">1 · Connect</span>
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
      {status?.demo && !status.demo.seeded ? (
        <div className="demo-warning" role="alert">
          <p className="status-title">Demo data not loaded</p>
          <p className="muted">
            The database has no orders yet, so queries and the 3D cube will be empty. From the repo root run:{" "}
            <code>./infra/scripts/seed-postgres.sh</code> (takes a few minutes).
          </p>
        </div>
      ) : status?.demo?.seeded ? (
        <p className="status-meta">Demo data: {status.demo.orderCount.toLocaleString()} orders</p>
      ) : null}
      {statusError ? <p className="error">{statusError}</p> : null}
    </div>
    <div>
      <div className="panel-header">
        <h2>Data sources</h2>
      </div>
      <div className="source-list">
        {dataSources.length ? (
          dataSources.map((source) => (
            <button
              key={source.id}
              type="button"
              className={source.id === activeSourceId ? "source-item active" : "source-item"}
              onClick={() => onActivateSource(source.id)}
            >
              <div>
                <p className="status-title">{source.name}</p>
                <p className="status-meta">{source.type} · {source.status}</p>
              </div>
              <span className={source.id === activeSourceId ? "pill ok" : "pill warn"}>
                {source.id === activeSourceId
                  ? "Active"
                  : source.status === "auth_required"
                  ? "Sign in"
                  : "Select"}
              </span>
            </button>
          ))
        ) : (
          <p className="muted">No data sources configured.</p>
        )}
      </div>
    </div>
  </section>
);

export default ConnectionPanel;
