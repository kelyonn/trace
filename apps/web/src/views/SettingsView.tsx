import type { DataSource } from "@trace/shared-types";
import type { StatusPayload } from "../panels/types";
import type { AuthState } from "../hooks/useAuth";
import { formatNumber } from "../lib/format";
import Icon from "../components/Icon";

type Props = {
  status: StatusPayload | null;
  dataSources: DataSource[];
  activeSourceId: string | null;
  onActivateSource: (id: string) => void;
  apiKey: string;
  role: string;
  authState: AuthState;
  onApiKeyChange: (v: string) => void;
  onRoleChange: (v: string) => void;
  onLogin: () => void;
  onLogout: () => void;
  onRefreshStatus: () => void;
};

const SOURCE_COLORS: Record<string, string> = {
  postgres: "var(--series-1)",
  snowflake: "var(--series-3)",
  bigquery: "var(--series-4)",
  sqlserver: "var(--series-8)"
};

const SettingsView = (p: Props) => {
  const s = p.status;
  const engine = s?.engine;
  const counts = engine?.dataset?.counts;
  return (
    <>
      <section className="card">
        <div className="card-header">
          <div>
            <h2>Query engine</h2>
            <p className="card-sub">
              Trace pushes queries down through Trino when it is reachable, and otherwise runs them on an embedded
              Postgres seeded with the demo dataset (ENGINE=auto).
            </p>
          </div>
          <button type="button" className="button ghost" onClick={p.onRefreshStatus}>
            <Icon name="refresh" /> Recheck
          </button>
        </div>
        <div className="status-grid">
          <div className="status-card">
            <span className="kpi-label">
              <Icon name="layers" /> Active engine
            </span>
            <span className="status-title" style={{ fontSize: 16 }}>
              {engine?.label ?? "Checking…"}
            </span>
            <span className="muted" style={{ fontSize: 12 }}>
              mode: {engine?.mode ?? "–"}
            </span>
          </div>
          <div className="status-card">
            <span className="kpi-label">
              <Icon name="stream" /> Trino
            </span>
            <span>
              <span className={s?.trino.ok ? "pill ok" : "pill"}>
                <span className={s?.trino.ok ? "dot ok" : "dot"} style={{ width: 6, height: 6, boxShadow: "none" }} />
                {s?.trino.ok ? `online · v${s.trino.version ?? "?"}` : "not connected"}
              </span>
            </span>
            <span className="muted" style={{ fontSize: 12 }}>
              {s?.trino.ok ? "Distributed pushdown" : s?.trino.error ?? "–"}
            </span>
          </div>
          <div className="status-card">
            <span className="kpi-label">
              <Icon name="database" /> Source database
            </span>
            <span>
              <span className={s?.postgres.ok ? "pill ok" : "pill bad"}>
                {s?.postgres.ok ? "ready" : "unavailable"}
              </span>
            </span>
            <span className="muted" style={{ fontSize: 12 }}>
              {s?.demo?.seeded ? `${formatNumber(s.demo.orderCount)} orders loaded` : s?.postgres.error ?? "No demo data"}
            </span>
          </div>
        </div>
        {counts ? (
          <div className="stat-list" style={{ marginTop: 12 }}>
            {Object.entries(counts).map(([t, c]) => (
              <div className="assistant-card" key={t}>
                <p>{t}</p>
                <p className="assistant-value">{formatNumber(c)}</p>
              </div>
            ))}
          </div>
        ) : null}
        {engine?.dataset ? (
          <p className="status-meta">
            Synthetic dataset covers {engine.dataset.range.start} → {engine.dataset.range.end}, with growth, seasonality
            and industry/category affinity baked in.
          </p>
        ) : null}
        {s?.demo && !s.demo.seeded ? (
          <div className="banner warn" style={{ marginTop: 12 }}>
            <Icon name="alert" />
            <div>
              <p className="status-title">Demo data not loaded</p>
              <p className="muted">
                Run <code>./infra/scripts/seed-postgres.sh</code> to seed the Docker Postgres, or start the API with{" "}
                <code>ENGINE=embedded</code>.
              </p>
            </div>
          </div>
        ) : null}
      </section>

      <div className="split">
        <section className="card">
          <div className="card-header">
            <div>
              <h2>Data sources</h2>
              <p className="card-sub">One active container at a time · per-source authentication (FR-1, FR-2)</p>
            </div>
          </div>
          <div className="source-list">
            {p.dataSources.map((src) => {
              const active = src.id === p.activeSourceId;
              return (
                <button
                  key={src.id}
                  type="button"
                  className={active ? "source-item active" : "source-item"}
                  onClick={() => p.onActivateSource(src.id)}
                >
                  <span className="source-logo" style={{ color: SOURCE_COLORS[src.type] }}>
                    <Icon name="database" />
                  </span>
                  <div>
                    <p className="status-title">{src.name}</p>
                    <p className="status-meta" style={{ marginTop: 0 }}>
                      {src.type} · {src.id}
                    </p>
                  </div>
                  <span className={active ? "pill ok" : src.status === "auth_required" ? "pill warn" : "pill"}>
                    {active ? (
                      <>
                        <Icon name="check" /> Active
                      </>
                    ) : src.status === "auth_required" ? (
                      <>
                        <Icon name="key" /> Sign in
                      </>
                    ) : (
                      "Connect"
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <div>
              <h2>Access & identity</h2>
              <p className="card-sub">Role drives OPA policy and column masking (FR-6)</p>
            </div>
          </div>
          <div className="access-grid">
            <label>
              API key
              <input
                type="password"
                value={p.apiKey}
                onChange={(e) => p.onApiKeyChange(e.target.value)}
                placeholder="Empty for local dev"
              />
            </label>
            <label>
              Role
              <select value={p.role} onChange={(e) => p.onRoleChange(e.target.value)}>
                <option value="user">user · names masked</option>
                <option value="admin">admin · full access</option>
              </select>
            </label>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
            {p.authState.status === "authenticated" ? (
              <>
                <span className="pill ok">
                  <Icon name="check" /> Signed in via Keycloak
                </span>
                <button type="button" className="button ghost" onClick={p.onLogout}>
                  <Icon name="logout" /> Sign out
                </button>
              </>
            ) : (
              <>
                <button type="button" className="button ghost" onClick={p.onLogin}>
                  <Icon name="login" /> Sign in with Keycloak
                </button>
                <span className="muted" style={{ fontSize: 12.5 }}>
                  Optional locally · required for auth-gated sources
                </span>
              </>
            )}
          </div>
          {p.authState.status === "error" ? <p className="error">{p.authState.message}</p> : null}
        </section>
      </div>
    </>
  );
};

export default SettingsView;
