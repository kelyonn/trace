import { useCallback, useRef, useState } from "react";
import type { Column } from "@trace/shared-types";

export type StreamRow = unknown[];

export type StreamState =
  | { status: "idle" }
  | { status: "streaming"; columns: Column[]; rows: StreamRow[]; rowCount: number }
  | { status: "complete"; columns: Column[]; rows: StreamRow[]; rowCount: number; durationMs: number }
  | { status: "error"; message: string };

const API_BASE = "http://localhost:3000/api/v1";

export function useQueryStream() {
  const [state, setState] = useState<StreamState>({ status: "idle" });
  const esRef = useRef<EventSource | null>(null);

  const runStream = useCallback(
    async (sql: string, headers: Record<string, string>) => {
      // Cancel any existing stream
      esRef.current?.close();

      setState({ status: "streaming", columns: [], rows: [], rowCount: 0 });

      try {
        // Step 1: create the query job
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

        // Step 2: open SSE stream
        const streamUrl = `${API_BASE}/queries/${queryId}/stream`;
        const es = new EventSource(streamUrl);
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
            prev.status === "streaming"
              ? { ...prev, rowCount: payload.rowCount }
              : prev
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
          if (e instanceof MessageEvent) {
            const payload = JSON.parse(e.data) as { message?: string };
            message = payload.message ?? message;
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
    },
    [getHeaders]
  );

  const cancel = useCallback(() => {
    esRef.current?.close();
    setState({ status: "idle" });
  }, []);

  return { state, runStream, cancel };
}
