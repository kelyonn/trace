import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AlertRule, AssistantSummary, DataSource, HistoryItem, Notebook, Snapshot } from "@trace/shared-types";
import { useAuth } from "./hooks/useAuth";
import { useQueryStream } from "./hooks/useQueryStream";
import { apiOrigin } from "./config";
import { detectPivot } from "./cube/pivot";
import { buildDrillSql, pivotContextFromClick } from "./cube/drill";
import { DEFAULT_CUBE, type CubeState } from "./cube/model";
import { initialSql } from "./demo-queries";
import { makeRequester, type QueryPayload } from "./lib/api";
import AppShell, { type ViewKey, VIEWS } from "./layout/AppShell";
import OverviewView from "./views/OverviewView";
import ExploreView from "./views/ExploreView";
import CubeStudioView from "./views/CubeStudioView";
import ActivityView, { type Metrics } from "./views/ActivityView";
import SettingsView from "./views/SettingsView";
import Icon from "./components/Icon";
import type { StatusPayload } from "./panels/types";

type Toast = { id: number; kind: "ok" | "bad" | "info"; text: string };

const readView = (): ViewKey => {
  const h = window.location.hash.replace(/^#\/?/, "") as ViewKey;
  return VIEWS.some((v) => v.key === h) ? h : "overview";
};

const store = {
  get: (k: string, d: string) => {
    try {
      return localStorage.getItem(k) ?? d;
    } catch {
      return d;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* storage unavailable */
    }
  }
};

const App = () => {
  const { state: authState, login, logout, accessToken } = useAuth();
  const { state: streamState, runStream, cancel: cancelStream } = useQueryStream();

  const [view, setView] = useState<ViewKey>(readView);
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme ?? "dark");
  const [apiKey, setApiKey] = useState(() => store.get("trace_api_key", ""));
  const [role, setRole] = useState(() => store.get("trace_role", "user"));

  const [sql, setSql] = useState(initialSql);
  const [result, setResult] = useState<QueryPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<string | null>(null);

  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [dataSources, setDataSources] = useState<DataSource[]>([]);
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [alerts, setAlerts] = useState<AlertRule[]>([]);
  const [assistant, setAssistant] = useState<AssistantSummary | null>(null);
  const [cubeState, setCubeState] = useState<CubeState>(DEFAULT_CUBE);
  const [refreshKey, setRefreshKey] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const headersRef = useRef<Record<string, string>>({});
  const headers = useMemo(() => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    const token = accessToken ?? (apiKey.trim() || null);
    if (token) h.Authorization = `Bearer ${token}`;
    if (role) h["x-trace-role"] = role;
    return h;
  }, [accessToken, apiKey, role]);
  headersRef.current = headers;

  // A new requester identity whenever credentials change → views refetch.
  const request = useMemo(() => makeRequester(() => headersRef.current), [headers]);

  const toast = useCallback((kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const navigate = useCallback((v: ViewKey) => {
    setView(v);
    if (window.location.hash !== `#/${v}`) window.history.pushState(null, "", `#/${v}`);
  }, []);

  useEffect(() => {
    const onHash = () => setView(readView());
    window.addEventListener("popstate", onHash);
    window.addEventListener("hashchange", onHash);
    return () => {
      window.removeEventListener("popstate", onHash);
      window.removeEventListener("hashchange", onHash);
    };
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    store.set("trace_theme", next);
    setTheme(next);
  };

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await request<StatusPayload>("/status"));
    } catch {
      setStatus(null);
    }
  }, [request]);

  const loadMeta = useCallback(async () => {
    const results = await Promise.allSettled([
      request<{ items: DataSource[]; activeSourceId?: string }>("/data-sources"),
      request<{ items: HistoryItem[] }>("/history"),
      request<Metrics>("/metrics"),
      request<{ items: Snapshot[] }>("/snapshots"),
      request<{ items: Notebook[] }>("/notebooks"),
      request<{ items: AlertRule[] }>("/alerts")
    ]);
    const [src, hist, met, snap, nb, al] = results;
    if (src.status === "fulfilled") {
      setDataSources(src.value.items ?? []);
      setActiveSourceId(src.value.activeSourceId ?? null);
    }
    if (hist.status === "fulfilled") setHistory(hist.value.items ?? []);
    if (met.status === "fulfilled") setMetrics(met.value);
    if (snap.status === "fulfilled") setSnapshots(snap.value.items ?? []);
    if (nb.status === "fulfilled") setNotebooks(nb.value.items ?? []);
    if (al.status === "fulfilled") setAlerts(al.value.items ?? []);
  }, [request]);

  useEffect(() => {
    void loadStatus();
    void loadMeta();
  }, [loadStatus, loadMeta]);

  // Keep metrics/history fresh when switching to Activity.
  useEffect(() => {
    if (view === "activity") void loadMeta();
  }, [view, loadMeta]);

  // Embedded engine may still be seeding on first boot: poll status until ready.
  useEffect(() => {
    if (status?.demo?.seeded) return;
    const t = setTimeout(() => void loadStatus(), 3000);
    return () => clearTimeout(t);
  }, [status, loadStatus]);

  useEffect(() => {
    if (!accessToken) return;
    try {
      const payload = JSON.parse(atob(accessToken.split(".")[1])) as { realm_access?: { roles?: string[] } };
      const roles = payload.realm_access?.roles ?? [];
      const next = roles.includes("admin") ? "admin" : "user";
      setRole(next);
      store.set("trace_role", next);
    } catch {
      /* malformed token */
    }
  }, [accessToken]);

  const runQuery = useCallback(
    async (override?: string) => {
      const q = override ?? sql;
      setLoading(true);
      setError(null);
      setPlan(null);
      try {
        const payload = await request<QueryPayload>("/query", { body: { sql: q } });
        setResult(payload);
        if (payload.queryId && !payload.cacheHit) {
          setHistory((prev) => [
            {
              id: payload.queryId as string,
              sql: q,
              submittedAt: new Date().toISOString(),
              durationMs: payload.durationMs ?? 0,
              rowCount: payload.rowCount ?? 0,
              status: "completed",
              dataSourceId: activeSourceId ?? "unknown"
            },
            ...prev
          ]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Request failed");
      } finally {
        setLoading(false);
      }
    },
    [sql, request, activeSourceId]
  );

  const openSql = useCallback(
    (q: string, run = true) => {
      setSql(q);
      navigate("explore");
      if (run) void runQuery(q);
    },
    [navigate, runQuery]
  );

  const openCube = useCallback(
    (state?: CubeState) => {
      if (state) setCubeState(state);
      navigate("cube");
    },
    [navigate]
  );

  const loadMore = async () => {
    if (!result?.nextUri) return;
    setLoading(true);
    try {
      const payload = await request<QueryPayload>("/query/next", {
        body: { nextUri: result.nextUri, columns: result.columns }
      });
      setResult({
        ...result,
        rows: [...result.rows, ...payload.rows],
        rowCount: result.rows.length + payload.rows.length,
        nextUri: payload.nextUri
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  };

  const explain = async () => {
    setPlan(null);
    setError(null);
    try {
      const payload = await request<{ plan: string }>("/explain", { body: { sql } });
      setPlan(payload.plan);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Explain failed");
    }
  };

  const exportCsv = async () => {
    try {
      const payload = await request<{ downloadUrl: string }>("/exports", { body: { sql, format: "csv" } });
      window.open(`${apiOrigin}${payload.downloadUrl}`, "_blank");
      toast("ok", "Export ready — download started");
    } catch (err) {
      toast("bad", err instanceof Error ? err.message : "Export failed");
    }
  };

  const handleDrill = (rowLabel: string, colLabel: string) => {
    const pivot = result ? detectPivot(result.columns, result.rows) : null;
    if (!pivot) return;
    const drillSql = buildDrillSql(pivotContextFromClick(pivot, rowLabel, colLabel), sql);
    if (drillSql) {
      setSql(drillSql);
      toast("info", `Drill-through SQL for ${rowLabel} · ${colLabel} is in the editor`);
    } else {
      toast("info", "Open Cube Studio for multi-level drill-down on this shape");
    }
  };

  const createSnapshot = async () => {
    const summary = result
      ? `${(result.rowCount ?? result.rows.length).toLocaleString()} rows · ${result.durationMs ?? 0} ms`
      : "No results";
    try {
      const snap = await request<Snapshot>("/snapshots", {
        body: { name: `Snapshot ${new Date().toLocaleString()}`, sql, summary }
      });
      setSnapshots((prev) => [snap, ...prev]);
      toast("ok", "Snapshot saved");
    } catch (err) {
      toast("bad", err instanceof Error ? err.message : "Snapshot failed");
    }
  };

  const runAssistant = async () => {
    try {
      setAssistant(await request<AssistantSummary>("/assistant/summary", { body: { sql } }));
    } catch (err) {
      toast("bad", err instanceof Error ? err.message : "Assistant failed");
    }
  };

  const saveNotebook = async (n: { id?: string; title: string; content: string }) => {
    try {
      const saved = n.id
        ? await request<Notebook>(`/notebooks/${n.id}`, { method: "PUT", body: { title: n.title, content: n.content } })
        : await request<Notebook>("/notebooks", { body: { title: n.title, content: n.content } });
      setNotebooks((prev) => [saved, ...prev.filter((x) => x.id !== saved.id)]);
      toast("ok", "Notebook saved");
      return saved;
    } catch (err) {
      toast("bad", err instanceof Error ? err.message : "Notebook save failed");
      return null;
    }
  };

  const createAlert = async (a: { name: string; comparison: AlertRule["comparison"]; threshold: number }) => {
    try {
      const created = await request<AlertRule>("/alerts", { body: { ...a, sql } });
      setAlerts((prev) => [created, ...prev]);
      toast("ok", `Alert “${created.name}” created on the current query`);
    } catch (err) {
      toast("bad", err instanceof Error ? err.message : "Alert create failed");
    }
  };

  const evaluateAlert = async (alert: AlertRule) => {
    try {
      const r = await request<{ id: string; value: number | null; triggered: boolean }>(`/alerts/${alert.id}/evaluate`, {
        method: "POST",
        body: {}
      });
      setAlerts((prev) =>
        prev.map((x) =>
          x.id === r.id
            ? {
                ...x,
                lastValue: r.value ?? undefined,
                lastTriggeredAt: r.triggered ? new Date().toISOString() : undefined
              }
            : x
        )
      );
      toast(r.triggered ? "bad" : "ok", r.triggered ? `${alert.name}: threshold crossed (${r.value})` : `${alert.name}: within threshold`);
    } catch (err) {
      toast("bad", err instanceof Error ? err.message : "Alert evaluation failed");
    }
  };

  const activateSource = async (id: string) => {
    const source = dataSources.find((s) => s.id === id);
    if (source?.status === "auth_required" && !accessToken) {
      sessionStorage.setItem("trace_pending_source", id);
      await login(id);
      return;
    }
    try {
      const payload = await request<{ activeSourceId: string; status?: DataSource["status"] }>(
        `/data-sources/${id}/activate`,
        { method: "POST", body: {} }
      );
      setActiveSourceId(payload.activeSourceId);
      setDataSources((prev) => prev.map((s) => (s.id === id ? { ...s, status: payload.status ?? "connected" } : s)));
      toast("ok", `Connected to ${source?.name ?? id}`);
      void loadStatus();
      setRefreshKey((k) => k + 1);
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.code === "AUTH_REQUIRED") {
        await login(id);
        return;
      }
      toast("bad", e.message);
    }
  };

  useEffect(() => {
    const onAuthComplete = () => {
      const pending = sessionStorage.getItem("trace_pending_source");
      if (!pending) return;
      sessionStorage.removeItem("trace_pending_source");
      void activateSource(pending);
    };
    window.addEventListener("trace:auth-complete", onAuthComplete);
    return () => window.removeEventListener("trace:auth-complete", onAuthComplete);
  });

  const engineOk = status ? status.postgres.ok : null;
  const activeSource = dataSources.find((s) => s.id === (activeSourceId ?? status?.activeSourceId));
  const seeding = status && !status.demo?.seeded && status.engine?.kind === "embedded";

  return (
    <AppShell
      view={view}
      onNavigate={navigate}
      theme={theme}
      onToggleTheme={toggleTheme}
      engineLabel={status?.engine?.label ?? (status ? (status.trino.ok ? "Trino" : "Engine offline") : undefined)}
      engineOk={engineOk}
      role={role}
      activeSourceName={activeSource?.name}
      historyCount={history.length}
      topActions={
        <div className="segmented" title="Role (drives masking and policy)">
          {["user", "admin"].map((r) => (
            <button
              key={r}
              type="button"
              className={role === r ? "active" : ""}
              onClick={() => {
                setRole(r);
                store.set("trace_role", r);
              }}
            >
              <Icon name={r === "admin" ? "key" : "users"} /> {r}
            </button>
          ))}
        </div>
      }
    >
      {seeding ? (
        <div className="banner info">
          <span className="spinner" />
          <div>
            <p className="status-title">Preparing the embedded demo dataset…</p>
            <p className="muted">First boot generates ~80k orders; this takes a few seconds and only happens once.</p>
          </div>
        </div>
      ) : null}
      {status && !status.postgres.ok && !seeding ? (
        <div className="banner warn">
          <Icon name="alert" />
          <div>
            <p className="status-title">The query engine is unavailable</p>
            <p className="muted">{status.postgres.error ?? "Start the API, or set ENGINE=embedded to run without Docker."}</p>
          </div>
        </div>
      ) : null}

      {view === "overview" ? (
        <OverviewView
          request={request}
          theme={theme}
          refreshKey={refreshKey + (status?.demo?.seeded ? 1 : 0)}
          engineLabel={status?.engine?.label}
          onOpenSql={(q) => openSql(q)}
          onOpenCube={openCube}
        />
      ) : null}
      {view === "explore" ? (
        <ExploreView
          request={request}
          theme={theme}
          sql={sql}
          onSqlChange={setSql}
          result={result}
          loading={loading}
          error={error}
          plan={plan}
          streamState={streamState}
          onRun={(q) => void runQuery(q)}
          onExplain={() => void explain()}
          onStream={() => runStream(sql, headers)}
          onCancelStream={cancelStream}
          onLoadMore={() => void loadMore()}
          onExport={() => void exportCsv()}
          onSnapshot={() => void createSnapshot()}
          onDrill={handleDrill}
        />
      ) : null}
      {view === "cube" ? (
        <CubeStudioView
          request={request}
          theme={theme}
          state={cubeState}
          onStateChange={setCubeState}
          onOpenSql={(q) => openSql(q)}
        />
      ) : null}
      {view === "activity" ? (
        <ActivityView
          request={request}
          refreshKey={refreshKey}
          sql={sql}
          history={history}
          metrics={metrics}
          snapshots={snapshots}
          notebooks={notebooks}
          alerts={alerts}
          assistant={assistant}
          onRunAssistant={() => void runAssistant()}
          onOpenSql={(q) => openSql(q)}
          onCreateSnapshot={() => void createSnapshot()}
          onSaveNotebook={saveNotebook}
          onCreateAlert={(a) => void createAlert(a)}
          onEvaluateAlert={(a) => void evaluateAlert(a)}
        />
      ) : null}
      {view === "settings" ? (
        <SettingsView
          status={status}
          dataSources={dataSources}
          activeSourceId={activeSourceId}
          onActivateSource={(id) => void activateSource(id)}
          apiKey={apiKey}
          role={role}
          authState={authState}
          onApiKeyChange={(v) => {
            setApiKey(v);
            store.set("trace_api_key", v);
          }}
          onRoleChange={(v) => {
            setRole(v);
            store.set("trace_role", v);
          }}
          onLogin={() => void login()}
          onLogout={logout}
          onRefreshStatus={() => void loadStatus()}
        />
      ) : null}

      <div className="toast-stack" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <Icon name={t.kind === "ok" ? "check" : t.kind === "bad" ? "alert" : "info"} />
            {t.text}
          </div>
        ))}
      </div>
    </AppShell>
  );
};

export default App;
