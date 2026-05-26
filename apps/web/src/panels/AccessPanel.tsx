import type { AuthState } from "../hooks/useAuth";

type Props = {
  apiKey: string;
  role: string;
  authState: AuthState;
  onApiKeyChange: (key: string) => void;
  onRoleChange: (role: string) => void;
  onLogin: () => void;
  onLogout: () => void;
};

const AccessPanel = ({
  apiKey,
  role,
  authState,
  onApiKeyChange,
  onRoleChange,
  onLogin,
  onLogout
}: Props) => (
  <section className="panel">
    <div className="panel-header">
      <h2>Access</h2>
      <span className="muted">Settings · API key, role, Keycloak</span>
    </div>
    <div className="access-grid">
      <label>
        API key
        <input
          type="password"
          value={apiKey}
          onChange={(e) => onApiKeyChange(e.target.value)}
          placeholder="Leave empty for local dev"
        />
      </label>
      <label>
        Role
        <select value={role} onChange={(e) => onRoleChange(e.target.value)}>
          <option value="user">user</option>
          <option value="admin">admin</option>
        </select>
      </label>
    </div>
    <div className="access-grid" style={{ marginTop: 12 }}>
      {authState.status === "authenticated" ? (
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span className="pill ok">Signed in via Keycloak</span>
          <button type="button" className="button ghost" onClick={onLogout}>
            Sign out
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button type="button" className="button ghost" onClick={onLogin}>
            Sign in with Keycloak
          </button>
          <span className="muted">Optional — leave blank for local dev</span>
        </div>
      )}
    </div>
  </section>
);

export default AccessPanel;
