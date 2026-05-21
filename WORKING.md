# Trace Setup and Usage Guide

## What this app does

Trace is a local-first OLAP exploration UI backed by a Fastify API, Trino, and Postgres. It ships with:
- SQL query runner with result cache
- SSE streaming query mode
- Schema browser and visual builder
- Semantic query builder (cube/dimensions/measures from `semantic.yml`)
- 3-D OLAP cube viewer (Three.js + OrbitControls) with Vega-Lite 2-D fallback
- Insight assistant (numeric stats)
- Snapshots, notebooks, and alerts
- Export to CSV (admin role)
- Keycloak OAuth (PKCE) integration
- OPA policy enforcement (optional, off by default in local dev)

## Requirements

- Docker Desktop
- Node.js 20+

## One-command setup

```bash
./run.sh
```

Open:
- UI: http://localhost:5173
- API health: http://localhost:3000/health
- API status: http://localhost:3000/api/v1/status

If deps are missing: `npm install` then re-run `./run.sh`.

## How to use the UI

1. **Query runner** — paste SQL or pick a preset, then click Run Query.
2. **Stream** — click Stream to receive results incrementally via SSE.
3. **Semantic builder** — pick a cube, measure, and dimensions; click Generate SQL to build a GROUP BY query automatically.
4. **Schema browser** — click a table to inspect columns; click Preview to run a quick SELECT.
5. **Visual builder** — select table, columns, and limit; click Build SQL.
6. **Results table** — shows rows with cache/masking status. Click Cube View to switch to the 3-D viewer.
7. **3-D cube viewer** — displays a pivot heatmap as 3-D bars. Drag to rotate, scroll to zoom, click a bar to drill down. Falls back to a Vega-Lite heatmap when FPS < 20.
8. **Insight assistant** — click Summarize to see numeric min/max/avg stats.
9. **Snapshots** — click Save snapshot to persist current SQL; click any snapshot to reload it.
10. **Notebook** — write markdown notes; create/save multiple notebooks.
11. **Alerts** — define a threshold and click Evaluate to check in real time.
12. **Query history** — click any history item to reload the SQL.
13. **Keycloak sign-in** — click Sign in with Keycloak in the Access panel for OAuth-backed sessions.

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /health | Liveness probe |
| GET | /api/v1/status | Trino and Postgres health |
| GET | /api/v1/metrics | Query and cache counters |
| POST | /api/v1/query | Synchronous query (returns JSON) |
| POST | /api/v1/query/next | Fetch next page (nextUri) |
| POST | /api/v1/queries | Create streaming query job |
| GET | /api/v1/queries/:id/stream | SSE stream for query results |
| GET | /api/v1/schema | List tables or describe a table |
| POST | /api/v1/explain | Get Trino EXPLAIN plan |
| GET | /api/v1/semantic | Return parsed semantic model |
| POST | /api/v1/exports | Create CSV export (admin) |
| GET | /api/v1/exports/:id/download | Download CSV |
| GET | /api/v1/data-sources | List configured sources |
| POST | /api/v1/data-sources/:id/activate | Switch active source |
| GET | /api/v1/history | Query history |
| GET | /api/v1/audit | Audit event log |
| POST | /api/v1/assistant/summary | Numeric stats for a SQL result |
| GET/POST | /api/v1/notebooks | Notebook CRUD |
| GET/POST | /api/v1/snapshots | Snapshot CRUD |
| GET/POST | /api/v1/alerts | Alert CRUD |
| POST | /api/v1/alerts/:id/evaluate | Evaluate alert threshold |

## Optional settings (`.env`)

| Variable | Default | Purpose |
|----------|---------|---------|
| `AUTH_REQUIRED` | `false` | Enforce API key on all requests |
| `API_KEY` | — | Bearer token when `AUTH_REQUIRED=true` |
| `MASK_COLUMNS` | `name` | Columns masked for non-admin roles |
| `OPA_ENABLED` | `false` | Use OPA sidecar for policy decisions |
| `OPA_URL` | `http://localhost:8181` | OPA endpoint |
| `KEYCLOAK_URL` | — | Keycloak base URL (enables JWT verification) |
| `TRINO_URL` | `http://localhost:8080` | Trino REST endpoint |
| `CACHE_TTL_MS` | `30000` | Query cache TTL |
| `RATE_LIMIT_MAX` | `0` | Requests/minute (0 = disabled) |

## Stop everything

```bash
./stop.sh
```

## Common issues

- **Web won't start** — run `npm install` then `./run.sh`.
- **API not reachable** — open http://localhost:3000/health.
- **Keycloak not available** — OAuth sign-in requires `docker compose up -d keycloak`.
- **3-D cube shows "Cube view unavailable"** — run a query that returns exactly 3 columns: row dimension, column dimension, and a numeric measure.
- **Large vega-embed chunk** — expected; vega is loaded lazily only when the 2-D fallback activates.
