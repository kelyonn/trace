import { useCallback, useRef, useState } from "react";
import type { Column } from "@trace/shared-types";

export type StreamRow = unknown[];

export type StreamState =
  | { status: "idle" }
  | { status: "streaming"; columns: Column[]; rows: StreamRow[]; rowCount: number }
  | { status: "complete"; columns: Column[]; rows: StreamRow[]; rowCount: number; durationMs: number }
  | { status: "error"; message: string };

const API_BASE = "http://localhost:3000/api/v1";

function streamUrl(queryId: string, bearerToken: string | null): string {
  const base = `${API_BASE}/queries/${queryId}/stream`;
  if (!bearerToken) return base;
  return `${base}?token=${encodeURIComponent(bearerToken)}`;
}

function extractBearer(headers: Record<string, string>): string | null {
  const auth = headers.Authorization ?? headers.authorization;
  if (!auth) return null;
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  return token || null;
}

export function useQueryStream() {
  const [state, setState] = useState<StreamState>({ status: "idle" });
  const esRef = useRef<EventSource | null>(null);

  const runStream = useCallback(async (sql: string, headers: Record<string, string>) => {
    esRef.current?.close();
    setState({ status: "streaming", columns: [], rows: [], rowCount: 0 });

    const bearer = extractBearer(headers);

    try {
      const res = await fetch(`${API_BASE}/queries`, {
        method: "POST",
        headers,
        body: JSON.stringify({ sql })
      });
      if (!res.ok) {
        const body = await res.json();
        setState({ status: "error", message: body?.error?.message ?? "Query failed" });
        return;
      }
      const { queryId } = (await res.json()) as { queryId: string };

      const es = new EventSource(streamUrl(queryId, bearer));
      esRef.current = es;

      let currentColumns: Column[] = [];
      let currentRows: StreamRow[] = [];

      es.addEventListener("data", (e) => {
        const payload = JSON.parse(e.data) as { columns: Column[]; rows: StreamRow[] };
        if (payload.columns.length && currentColumns.length === 0) {
          currentColumns = payload.columns;
        }
        currentRows = [...currentRows, ...payload.rows];
        setState({
          status: "streaming",
          columns: currentColumns,
          rows: currentRows,
          rowCount: currentRows.length
        });
      });

      es.addEventListener("progress", (e) => {
        const payload = JSON.parse(e.data) as { rowCount: number };
        setState((prev) =>
          prev.status === "streaming" ? { ...prev, rowCount: payload.rowCount } : prev
        );
      });

      es.addEventListener("complete", (e) => {
        const payload = JSON.parse(e.data) as {
          rowCount: number;
          durationMs: number;
          columns: Column[];
        };
        if (payload.columns.length && currentColumns.length === 0) {
          currentColumns = payload.columns;
        }
        setState({
          status: "complete",
          columns: currentColumns,
          rows: currentRows,
          rowCount: payload.rowCount,
          durationMs: payload.durationMs
        });
        es.close();
      });

      es.addEventListener("error", (e) => {
        let message = "Stream error";
        if (e instanceof MessageEvent && e.data) {
          try {
            const payload = JSON.parse(e.data) as { message?: string };
            message = payload.message ?? message;
          } catch {
            /* ignore */
          }
        }
        setState({ status: "error", message });
        es.close();
      });

      es.onerror = () => {
        if (es.readyState === EventSource.CLOSED) return;
        setState((prev) =>
          prev.status !== "complete" && prev.status !== "error"
            ? { status: "error", message: "Connection lost" }
            : prev
        );
        es.close();
      };
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "Unknown error"
      });
    }
  }, []);

  const cancel = useCallback(() => {
    esRef.current?.close();
    setState({ status: "idle" });
  }, []);

  return { state, runStream, cancel };
}
