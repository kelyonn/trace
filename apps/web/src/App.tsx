import { useEffect, useState, useCallback } from "react";
import { useAuth } from "./hooks/useAuth";
import { useQueryStream } from "./hooks/useQueryStream";
import { apiBase, apiOrigin } from "./config";
import { canPivot, detectPivot } from "./cube/pivot";
import { buildDrillSql, pivotContextFromClick } from "./cube/drill";
import {
  initialSql,
  defaultQuickQuery,
  quickQueryTemplates
} from "./demo-queries";
import AppShell from "./layout/AppShell";
import ConnectionPanel from "./panels/ConnectionPanel";
import SchemaPanel from "./panels/SchemaPanel";
import BuildersPanel from "./panels/BuildersPanel";
import QueryPanel from "./panels/QueryPanel";
import ResultsPanel from "./panels/ResultsPanel";
import GovernancePanel from "./panels/GovernancePanel";
import AccessPanel from "./panels/AccessPanel";
import type { StatusPayload } from "./panels/types";
import type {
  QueryResponse,
  Column,
  HistoryItem,
  DataSource,
  Notebook,
  Snapshot,
  AssistantSummary,
  AlertRule,
  SemanticModel,
  SemanticCube
} from "@trace/shared-types";

type QueryResult = Partial<QueryResponse> & {
  columns: Column[];
  rows: unknown[][];
  nextUri: string | null;
};

type ColumnInfo = Column;

type Metrics = {
  totalQueries: number;
  queryErrors: number;
  cacheHits: number;
  exports: number;
};

const App = () => {
  const { state: authState, login, logout, accessToken } = useAuth();
  const { state: streamState, runStream, cancel: cancelStream } = useQueryStream();

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
  const [quickQuery, setQuickQuery] = useState(defaultQuickQuery);
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
  const [semanticModel, setSemanticModel] = useState<SemanticModel | null>(null);
  const [selectedCube, setSelectedCube] = useState<SemanticCube | null>(null);
  const [selectedMeasure, setSelectedMeasure] = useState<string>("");
  const [selectedDimensions, setSelectedDimensions] = useState<string[]>([]);
  const [cubeMode, setCubeMode] = useState(true);


  const getHeaders = () => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    // Prefer Keycloak JWT when available; fall back to manual API key
    const token = accessToken ?? (apiKey.trim() || null);
    if (token) {
      headers.Authorization = `Bearer ${token}`;
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

    const loadSemantic = async () => {
      try {
        const response = await fetch(`${apiBase}/semantic`, { headers: getHeaders() });
        if (!response.ok) return;
        const payload = (await response.json()) as SemanticModel;
        setSemanticModel(payload);
        if (payload.cubes?.length) {
          setSelectedCube(payload.cubes[0]);
          const firstMeasure = payload.cubes[0]?.measures?.[0]?.name ?? "";
          setSelectedMeasure(firstMeasure);
        }
      } catch {
        // semantic model is optional — no error surfaced to user
      }
    };
    loadSemantic();
  }, [apiKey, role]);

  useEffect(() => {
    if (!accessToken) return;
    try {
      const payload = JSON.parse(atob(accessToken.split(".")[1])) as {
        realm_access?: { roles?: string[] };
      };
      const roles = payload.realm_access?.roles ?? [];
      if (roles.includes("admin")) {
        setRole("admin");
        localStorage.setItem("trace_role", "admin");
      } else if (roles.includes("analyst")) {
        setRole("user");
        localStorage.setItem("trace_role", "user");
      }
    } catch {
      /* ignore malformed token */
    }
  }, [accessToken]);

  useEffect(() => {
    const onAuthComplete = () => {
      const pending = sessionStorage.getItem("trace_pending_source");
      if (!pending) return;
      sessionStorage.removeItem("trace_pending_source");
      void activateSource(pending);
    };
    window.addEventListener("trace:auth-complete", onAuthComplete);
    return () => window.removeEventListener("trace:auth-complete", onAuthComplete);
  }, [accessToken]);

  const runQuery = async (overrideSql?: string) => {
    const querySql = overrideSql ?? sql;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${apiBase}/query`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ sql: querySql })
      });

      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload?.error?.message ?? "Request failed");
      }

      const payload = (await response.json()) as QueryResult;
      setResult(payload);
      if (canPivot(payload.columns, payload.rows)) {
        setCubeMode(true);
      }
      if (payload.queryId) {
        setHistory((prev) => [
          {
            id: payload.queryId as string,
            sql: querySql,
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
  };

  const applyQuickQuery = (value: string) => {
    setQuickQuery(value);
    setSql(quickQueryTemplates[value] ?? sql);
  };

  const handleDrill = useCallback(
    (rowLabel: string, colLabel: string) => {
      const pivot = result ? detectPivot(result.columns, result.rows) : null;
      if (!pivot) return;
      const ctx = pivotContextFromClick(pivot, rowLabel, colLabel);
      const drillSql = buildDrillSql(ctx, sql);
      if (drillSql) {
        setSql(drillSql);
      }
    },
    [result, sql]
  );

  const runDemoQuery = useCallback(
    (demoSql: string) => {
      setSql(demoSql);
      setQuickQuery("cube_by_status_region");
      void runQuery(demoSql);
    },
    [sql, apiKey, role, accessToken, activeSourceId]
  );

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

  const buildSemanticSql = () => {
    if (!selectedCube || !selectedMeasure) {
      setStatusError("Select a cube and measure to build a semantic query.");
      return;
    }
    const cube = selectedCube;
    const measure = cube.measures.find((m) => m.name === selectedMeasure);
    if (!measure) return;

    const aggFn = (() => {
      switch (measure.type) {
        case "sum": return "SUM";
        case "count": return "COUNT";
        case "avg": return "AVG";
        case "min": return "MIN";
        case "max": return "MAX";
        case "count_distinct": return "COUNT(DISTINCT";
        default: return "SUM";
      }
    })();
    const measureExpr = measure.type === "count_distinct"
      ? `${aggFn} ${measure.sql}) AS ${measure.name}`
      : `${aggFn}(${measure.sql}) AS ${measure.name}`;

    if (selectedDimensions.length === 0) {
      setSql(`SELECT ${measureExpr} FROM ${cube.name};`);
    } else {
      const dims = selectedDimensions.join(", ");
      setSql(`SELECT ${dims}, ${measureExpr} FROM ${cube.name} GROUP BY ${selectedDimensions.map((_, i) => i + 1).join(", ")} ORDER BY ${selectedDimensions.length + 1} DESC;`);
    }
  };

  const activateSource = async (id: string) => {
    setStatusError(null);
    const source = dataSources.find((s) => s.id === id);
    if (source?.status === "auth_required" && !accessToken) {
      await login(id);
      return;
    }
    try {
      const response = await fetch(`${apiBase}/data-sources/${id}/activate`, {
        method: "POST",
        headers: getHeaders()
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        if (body?.error?.code === "AUTH_REQUIRED") {
          await login(id);
          return;
        }
        throw new Error(body?.error?.message ?? "Failed to activate source");
      }
      const payload = (await response.json()) as { activeSourceId: string; status?: string };
      setActiveSourceId(payload.activeSourceId);
      setDataSources((prev) =>
        prev.map((s) =>
          s.id === id ? { ...s, status: (payload.status as DataSource["status"]) ?? "connected" } : s
        )
      );
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
    <AppShell
      hero={
        <>
          <p className="eyebrow">Trace</p>
          <h1>Live OLAP exploration with a 3-D edge.</h1>
          <p className="subhead">
            Explore millions of rows through Trino — pivot in 3D, drill into slices, and export results.
          </p>
        </>
      }
      left={
        <>
          <ConnectionPanel
            status={status}
            statusError={statusError}
            activeSourceId={activeSourceId}
            dataSources={dataSources}
            onActivateSource={(id) => void activateSource(id)}
          />
          <SchemaPanel
            schemaTables={schemaTables}
            selectedTable={selectedTable}
            tableColumns={tableColumns}
            loading={loading}
            onSelectTable={(t) => void loadColumns(t)}
            onPreview={() => void previewTable()}
          />
          <BuildersPanel
            semanticModel={semanticModel}
            selectedCube={selectedCube}
            selectedMeasure={selectedMeasure}
            selectedDimensions={selectedDimensions}
            schemaTables={schemaTables}
            tableColumns={tableColumns}
            builderTable={builderTable}
            builderColumns={builderColumns}
            builderLimit={builderLimit}
            onCubeChange={(cube) => {
              setSelectedCube(cube);
              setSelectedMeasure(cube?.measures?.[0]?.name ?? "");
              setSelectedDimensions([]);
            }}
            onMeasureChange={setSelectedMeasure}
            onDimensionToggle={(dim) =>
              setSelectedDimensions((prev) =>
                prev.includes(dim) ? prev.filter((x) => x !== dim) : [...prev, dim]
              )
            }
            onBuildSemanticSql={buildSemanticSql}
            onBuilderTableChange={(t) => void loadColumns(t)}
            onToggleColumn={toggleColumn}
            onBuilderLimitChange={setBuilderLimit}
            onBuildSql={buildSql}
          />
        </>
      }
      right={
        <>
          <QueryPanel
            sql={sql}
            quickQuery={quickQuery}
            loading={loading}
            error={error}
            plan={plan}
            streamState={streamState}
            onSqlChange={setSql}
            onQuickQueryChange={applyQuickQuery}
            onExplain={() => void explainQuery()}
            onStream={() => runStream(sql, getHeaders())}
            onCancelStream={cancelStream}
            onRun={() => void runQuery()}
          />
          <ResultsPanel
            result={result}
            sql={sql}
            cubeMode={cubeMode}
            loading={loading}
            exportStatus={exportStatus}
            apiOrigin={apiOrigin}
            apiBase={apiBase}
            headers={getHeaders()}
            onToggleCubeMode={() => setCubeMode((v) => !v)}
            onDrill={handleDrill}
            onRunDemoQuery={runDemoQuery}
            onLoadMore={() => void loadMore()}
            onExportStatus={setExportStatus}
          />
        </>
      }
      governance={
        <GovernancePanel
          streamState={streamState}
          assistantSummary={assistantSummary}
          loading={loading}
          history={history}
          metrics={metrics}
          snapshots={snapshots}
          notebooks={notebooks}
          activeNotebookId={activeNotebookId}
          notebookTitle={notebookTitle}
          notebookContent={notebookContent}
          alerts={alerts}
          alertName={alertName}
          alertComparison={alertComparison}
          alertThreshold={alertThreshold}
          onRunAssistant={() => void runAssistant()}
          onFillHistory={fillFromHistory}
          onCreateSnapshot={() => void createSnapshot()}
          onSetSql={setSql}
          onCreateNotebook={() => void createNotebook()}
          onSaveNotebook={() => void saveNotebook()}
          onSelectNotebook={selectNotebook}
          onNotebookTitleChange={setNotebookTitle}
          onNotebookContentChange={setNotebookContent}
          onAlertNameChange={setAlertName}
          onAlertComparisonChange={setAlertComparison}
          onAlertThresholdChange={setAlertThreshold}
          onCreateAlert={() => void createAlert()}
          onEvaluateAlert={(a) => void evaluateAlert(a)}
        />
      }
      access={
        <AccessPanel
          apiKey={apiKey}
          role={role}
          authState={authState}
          onApiKeyChange={(value) => {
            setApiKey(value);
            localStorage.setItem("trace_api_key", value);
          }}
          onRoleChange={(value) => {
            setRole(value);
            localStorage.setItem("trace_role", value);
          }}
          onLogin={() => void login()}
          onLogout={logout}
        />
      }
    />
  );
};

export default App;
