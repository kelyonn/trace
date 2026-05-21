# Pilot Launch Checklist

## Infrastructure

- [ ] Docker Desktop running
- [ ] `./run.sh` completes without errors
- [ ] `curl http://localhost:3000/health` → `{"status":"ok"}`
- [ ] `GET /api/v1/status` → Trino and Postgres both `"ok": true`

## Core features

- [ ] Schema browser lists `customers` and `orders`
- [ ] Visual builder generates SQL from table + column selection
- [ ] Semantic builder lists `orders` and `customers` cubes from `/api/v1/semantic`
- [ ] Run query: results appear in the table
- [ ] Stream mode: rows appear incrementally in the Stream results panel
- [ ] Export CSV works for admin role (download triggers)
- [ ] History panel records completed queries
- [ ] Audit log records query events

## 3-D cube viewer

- [ ] Run a 3-column query (e.g. `SELECT status, region, SUM(amount) FROM orders JOIN customers ON orders.customer_id = customers.id GROUP BY 1, 2`)
- [ ] Cube view renders bars with heatmap colors
- [ ] Drag-to-rotate works (OrbitControls)
- [ ] Scroll-to-zoom works
- [ ] Click a bar → SQL updates with drill-down filter

## Notebook and snapshots

- [ ] Save snapshot from current SQL → appears in Snapshots list
- [ ] Click snapshot → SQL reloads in query runner
- [ ] Create a notebook, enter title + notes, save → appears in Notebooks list
- [ ] Select saved notebook → title and content reload

## Alerts

- [ ] Create an alert with a comparison and threshold
- [ ] Click Evaluate → shows last value and triggered status

## Auth (optional)

- [ ] Keycloak container running: `docker compose up -d keycloak`
- [ ] Click Sign in with Keycloak → redirected to Keycloak login
- [ ] Sign in as `admin@trace.local / admin` → returns to UI with "Signed in" pill
- [ ] Admin role unlocks export; non-admin sees masked columns

## Smoke test

```bash
bash infra/scripts/sanity_check.sh
```

Expected output: `Sanity checks passed.`
