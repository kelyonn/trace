import { useRef, useState } from "react";
import type { Requester } from "../lib/api";
import type { AuthState } from "../hooks/useAuth";
import { formatNumber } from "../lib/format";
import type { StatusPayload } from "../lib/api";

export type SourceItem = {
  id: string;
  name: string;
  kind: "demo" | "files" | "postgres" | "mysql" | "sqlite" | "trino";
  kindLabel: string;
  builtin: boolean;
  requiresAuth: boolean;
  status: "connected" | "auth_required" | "error" | "available";
  error: string | null;
  config: Record<string, unknown>;
};

type Kind = "postgres" | "mysql" | "sqlite" | "trino";

type Props = {
  request: Requester;
  status: StatusPayload | null;
  sources: SourceItem[];
  activeSourceId: string | null;
  onActivate: (id: string) => Promise<void>;
  onChanged: () => void;
  onUploaded: (table: string) => void;
  onToast: (kind: "ok" | "bad" | "info", text: string) => void;
  apiKey: string;
  role: string;
  authState: AuthState;
  onApiKeyChange: (v: string) => void;
  onRoleChange: (v: string) => void;
  onLogin: () => void;
  onLogout: () => void;
};

const FIELDS: Record<Kind, { key: string; label: string; placeholder?: string; type?: string; wide?: boolean }[]> = {
  postgres: [
    { key: "connectionString", label: "Connection string (or fill the fields below)", placeholder: "postgres://user:pass@host:5432/db", wide: true },
    { key: "host", label: "Host", placeholder: "localhost" },
    { key: "port", label: "Port", placeholder: "5432", type: "number" },
    { key: "database", label: "Database" },
    { key: "schema", label: "Schema", placeholder: "public" },
    { key: "user", label: "User" },
    { key: "password", label: "Password", type: "password" }
  ],
  mysql: [
    { key: "connectionString", label: "Connection string (or fill the fields below)", placeholder: "mysql://user:pass@host:3306/db", wide: true },
    { key: "host", label: "Host", placeholder: "localhost" },
    { key: "port", label: "Port", placeholder: "3306", type: "number" },
    { key: "database", label: "Database", wide: true },
    { key: "user", label: "User" },
    { key: "password", label: "Password", type: "password" }
  ],
  sqlite: [{ key: "path", label: "Path to the .sqlite / .db file on the API server", placeholder: "/data/warehouse.sqlite", wide: true }],
  trino: [
    { key: "url", label: "Coordinator URL", placeholder: "http://localhost:8080", wide: true },
    { key: "catalog", label: "Catalog", placeholder: "hive" },
    { key: "schema", label: "Schema", placeholder: "default" },
    { key: "user", label: "User", placeholder: "trace" }
  ]
};

const KIND_LABEL: Record<Kind, string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL / MariaDB",
  sqlite: "SQLite file",
  trino: "Trino"
};

const describe = (s: SourceItem) => {
  const c = s.config;
  if (s.kind === "demo") return "Synthetic retail data in an embedded Postgres";
  if (s.kind === "files") return "CSV and JSON uploads, stored as tables";
  if (c.connectionString) return String(c.connectionString);
  if (s.kind === "sqlite") return String(c.path ?? "");
  if (s.kind === "trino") return `${c.url} · ${c.catalog}.${c.schema}`;
  return [c.user ? `${c.user}@` : "", c.host ?? "", c.port ? `:${c.port}` : "", c.database ? `/${c.database}` : ""].join("");
};

const SourcesView = (p: Props) => {
  const [kind, setKind] = useState<Kind>("postgres");
  const [name, setName] = useState("");
  const [form, setForm] = useState<Record<string, string>>({});
  const [ssl, setSsl] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [over, setOver] = useState(false);
  const [uploaded, setUploaded] = useState<{ table: string; rows: number; columns: { name: string; type: string }[] }[]>([]);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const config = () => {
    const out: Record<string, unknown> = {};
    for (const f of FIELDS[kind]) {
      const v = (form[f.key] ?? "").trim();
      if (!v) continue;
      out[f.key] = f.type === "number" ? Number(v) : v;
    }
    if ((kind === "postgres" || kind === "mysql") && ssl) out.ssl = true;
    return out;
  };

  const runTest = async () => {
    setBusy("test");
    setTest(null);
    try {
      const r = await p.request<{ ok: boolean; tables?: number; error?: string }>("/data-sources/test", { body: { kind, config: config() } });
      setTest(r.ok ? { ok: true, text: `Connected · ${r.tables} tables visible` } : { ok: false, text: r.error ?? "Connection failed" });
    } catch (err) {
      setTest({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy("save");
    setTest(null);
    try {
      await p.request("/data-sources", { body: { name: name || KIND_LABEL[kind], kind, config: config(), activate: true } });
      p.onToast("ok", `Connected to ${name || KIND_LABEL[kind]}`);
      setForm({});
      setName("");
      p.onChanged();
    } catch (err) {
      setTest({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (s: SourceItem) => {
    if (!window.confirm(`Remove “${s.name}”? Its saved connection settings will be deleted.`)) return;
    try {
      await p.request(`/data-sources/${s.id}`, { method: "DELETE" });
      p.onToast("ok", `Removed ${s.name}`);
      p.onChanged();
    } catch (err) {
      p.onToast("bad", err instanceof Error ? err.message : String(err));
    }
  };

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      setBusy(`upload:${file.name}`);
      try {
        const content = await file.text();
        const r = await p.request<{ table: string; rows: number; columns: { name: string; type: string }[] }>(
          "/data-sources/files/upload",
          { body: { filename: file.name, content, activate: true } }
        );
        setUploaded((u) => [r, ...u.filter((x) => x.table !== r.table)]);
        p.onUploaded(r.table);
        p.onToast("ok", `Loaded ${file.name} as “${r.table}” (${formatNumber(r.rows)} rows)`);
      } catch (err) {
        p.onToast("bad", `${file.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    setBusy(null);
    p.onChanged();
  };

  const st = p.status?.source;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Sources</h1>
          <p>Connect any database or upload a file. Switching sources re-derives the model, overview and cube.</p>
        </div>
      </div>

      <div className="sources-layout">
        <div style={{ display: "grid", gap: 16 }}>
          <section className="card">
            <div className="card-header">
              <div>
                <h2>Connections</h2>
                <p className="card-sub">One source is active at a time. Every query is read-only.</p>
              </div>
            </div>
            <div>
              {p.sources.map((s) => {
                const active = s.id === p.activeSourceId;
                return (
                  <div key={s.id} className={active ? "source-row active" : "source-row"}>
                    <span className={s.status === "error" ? "dot bad" : active ? "dot ok" : "dot"} />
                    <div style={{ minWidth: 0 }}>
                      <div className="source-name">{s.name}</div>
                      <div className="source-meta">
                        {s.kindLabel} · {describe(s)}
                      </div>
                      {s.error ? <div className="source-error">{s.error}</div> : null}
                    </div>
                    <div className="button-row">
                      {!active ? (
                        <button
                          type="button"
                          className="btn"
                          disabled={busy === s.id}
                          onClick={async () => {
                            setBusy(s.id);
                            await p.onActivate(s.id);
                            setBusy(null);
                          }}
                        >
                          {busy === s.id ? <span className="spinner" /> : null}
                          {s.requiresAuth ? "Sign in & use" : "Use"}
                        </button>
                      ) : null}
                      {!s.builtin ? (
                        <button type="button" className="btn" onClick={() => void remove(s)} aria-label={`Remove ${s.name}`}>
                          Remove
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
            {st ? (
              <p className="status-meta">
                Active: <b>{st.name}</b> · {st.tables.length} tables · {formatNumber(st.totalRows)} rows
                {st.error ? ` · ${st.error}` : ""}
              </p>
            ) : null}
          </section>

          <section className="card">
            <div className="card-header">
              <div>
                <h2>Upload data</h2>
                <p className="card-sub">CSV or JSON. Column types are inferred; each file becomes a table you can join and explore.</p>
              </div>
            </div>
            <label
              className={over ? "dropzone over" : "dropzone"}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(false);
                void upload(e.dataTransfer.files);
              }}
            >
              <input ref={fileRef} type="file" accept=".csv,.json,.tsv,.txt" multiple onChange={(e) => void upload(e.target.files)} />
              {busy?.startsWith("upload:") ? (
                <>
                  <span className="spinner" /> Loading {busy.slice(7)}…
                </>
              ) : (
                <>
                  <span className="status-title">Drop files here</span>
                  <span className="muted small">or click to choose · up to 500k rows per file</span>
                </>
              )}
            </label>
            {uploaded.length ? (
              <ul className="model-list" style={{ marginTop: 12 }}>
                {uploaded.map((u) => (
                  <li key={u.table}>
                    <span>
                      <b className="mono">{u.table}</b> · {formatNumber(u.rows)} rows
                    </span>
                    <code>{u.columns.map((c) => `${c.name} ${c.type}`).join(", ")}</code>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        </div>

        <div style={{ display: "grid", gap: 16 }}>
          <section className="card">
            <div className="card-header">
              <div>
                <h2>Add a connection</h2>
                <p className="card-sub">Credentials stay on the API server and are never sent back in full.</p>
              </div>
            </div>
            <div className="form-grid">
              <label>
                Engine
                <select
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value as Kind);
                    setForm({});
                    setTest(null);
                  }}
                >
                  {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABEL[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Name
                <input value={name} placeholder={KIND_LABEL[kind]} onChange={(e) => setName(e.target.value)} />
              </label>
              {FIELDS[kind].map((f) => (
                <label key={f.key} className={f.wide ? "wide" : undefined}>
                  {f.label}
                  <input
                    type={f.type === "password" ? "password" : "text"}
                    inputMode={f.type === "number" ? "numeric" : undefined}
                    value={form[f.key] ?? ""}
                    placeholder={f.placeholder}
                    autoComplete="off"
                    onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                  />
                </label>
              ))}
              {kind === "postgres" || kind === "mysql" ? (
                <label className="wide" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="checkbox" checked={ssl} onChange={(e) => setSsl(e.target.checked)} /> Use SSL
                </label>
              ) : null}
            </div>
            {test ? <p className={test.ok ? "test-result ok" : "test-result bad"} style={{ marginTop: 12 }}>{test.text}</p> : null}
            <div className="button-row" style={{ marginTop: 12 }}>
              <button type="button" className="button ghost" onClick={() => void runTest()} disabled={!!busy}>
                {busy === "test" ? <span className="spinner" /> : null} Test connection
              </button>
              <button type="button" className="button" onClick={() => void save()} disabled={!!busy}>
                {busy === "save" ? <span className="spinner" /> : null} Save and use
              </button>
            </div>
          </section>

          <section className="card">
            <div className="card-header">
              <div>
                <h2>Access</h2>
                <p className="card-sub">Your role drives OPA policy and PII masking.</p>
              </div>
            </div>
            <div className="access-grid">
              <label>
                API key
                <input type="password" value={p.apiKey} onChange={(e) => p.onApiKeyChange(e.target.value)} placeholder="Empty for local dev" />
              </label>
              <label>
                Role
                <select value={p.role} onChange={(e) => p.onRoleChange(e.target.value)}>
                  <option value="user">user · PII hidden</option>
                  <option value="admin">admin · full access</option>
                </select>
              </label>
            </div>
            <div className="button-row" style={{ marginTop: 12 }}>
              {p.authState.status === "authenticated" ? (
                <>
                  <span className="pill ok">Signed in via Keycloak</span>
                  <button type="button" className="button ghost" onClick={p.onLogout}>
                    Sign out
                  </button>
                </>
              ) : (
                <button type="button" className="button ghost" onClick={p.onLogin}>
                  Sign in with Keycloak
                </button>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default SourcesView;
