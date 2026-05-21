# Trace Setup and Usage Guide

## What this app does
Trace is a local-first OLAP exploration UI backed by a Fastify API and Trino. It ships with a query runner, schema browser, visual builder, snapshots, notebooks, alerts, and a 3-D preview with an automatic 2-D fallback.

## Requirements
- Docker Desktop
- Node.js 20+

## One-command setup
1) From the repo root, run:
  - `./run.sh`
2) Open the UI:
  - http://localhost:5173
3) API health checks:
  - http://localhost:3000/health
  - http://localhost:3000/api/v1/status

If you see an error about missing packages, run:
- `npm install`
Then re-run `./run.sh`.

## How to use the UI
1) **Query runner**: paste SQL or pick a preset, then run it.
2) **Schema browser**: select a table to inspect columns or preview data.
3) **Visual builder**: select table/columns/limit and build SQL.
4) **Results**: view rows, cache status, and export CSV (admin only).
5) **3-D preview**: renders a sample visualization with auto fallback.
6) **Assistant**: click Summarize to see numeric stats.
7) **Snapshots**: save and reopen SQL quickly.
8) **Notebook**: write notes and save them.
9) **Alerts**: define a threshold and evaluate on demand.

## API endpoints (high level)
- `POST /api/v1/query` for queries
- `GET /api/v1/schema` for tables/columns
- `GET /api/v1/status` for health
- `GET /api/v1/history` and `GET /api/v1/audit`
- `POST /api/v1/exports` for CSV export (admin)
- `POST /api/v1/assistant/summary` for numeric stats
- `GET/POST /api/v1/notebooks`
- `GET/POST /api/v1/snapshots`
- `GET/POST /api/v1/alerts`

## Optional security settings
- `AUTH_REQUIRED=true` and `API_KEY=...` to require auth.
- `MASK_COLUMNS=name,ssn` to mask columns for non-admins.
- `CACHE_TTL_MS`, `CACHE_MAX`, `TRINO_TIMEOUT_MS`, `RATE_LIMIT_MAX` for tuning.

## Stop everything
- `./stop.sh`

## Common issues
- **Web won’t start**: run `npm install` then `./run.sh`.
- **API not reachable**: open http://localhost:3000/health to verify.
- **Three.js error**: ensure dependencies are installed.
