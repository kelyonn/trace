# Trace — Product walkthrough (A to Z)

Trace is a **local-first OLAP exploration app**: connect to a database, run SQL (or build it visually), and explore results in a table, a **streaming** feed, or a **3-D cube** with drill-down. A Fastify API orchestrates queries; **Trino** reads **Postgres**; optional **Keycloak** and **OPA** handle auth and policy.

**Flow:** start the stack → connect → explore → analyze → govern → wrap up.

---

## A — What you're looking at

**User goal:** Answer business questions on relational data in one UI.

### Architecture (local stack)

```
  Browser UI
       |
       v
  Trace API (:3000) -----> Keycloak (:8081)   [optional OAuth]
       |
       +------> OPA (:8181)                   [optional policy]
       |
       v
    Trino (:8080)
       |
       v
  Postgres (:5432)
```

**Sample data:** tables `customers` and `orders`, seeded for joins and aggregates.

---

## B — Before you open the UI

**Requirements:** Docker Desktop, Node 20+.

**Start:**

```bash
./run.sh
```

Starts Docker (Postgres, Trino, Keycloak, OPA, Vault) plus API and web dev servers.

### Sanity check

- **API health** — open `http://localhost:3000/health` — expect `{"status":"ok"}`
- **Stack status** — open `http://localhost:3000/api/v1/status` — Trino and Postgres should be `"ok": true`
- **Web UI** — open `http://localhost:5173` (or **5174** if 5173 is in use)

Optional smoke test:

```bash
bash infra/scripts/sanity_check.sh
```

**Stop:** `./stop.sh`

---

## C — First screen: hero + access

The **Trace** hero introduces the product: live OLAP exploration with a 3-D edge.

### Access panel

- **API key** — optional Bearer token when `AUTH_REQUIRED=true` in `.env`
- **Role** — `user` or `admin` (manual in dev; from JWT when signed in)
- **Sign in with Keycloak** — PKCE OAuth; required for `auth_required` data sources

**Local dev (default):** No login. Role `user` masks PII (e.g. column `name`); `admin` sees full data and can export CSV.

**Keycloak test users:**

| User | Password | Role |
|------|----------|------|
| admin@trace.local | admin | admin |
| analyst@trace.local | analyst | analyst |

More detail: `docs/AUTH_SETUP.md`

---

## D — Connection status

Shows health of the **active data source**:

- **Trino** — engine version and reachability
- **Postgres** — checked via Trino (`SELECT 1`)

If either fails, run `docker compose up -d` and wait until Trino is healthy.

---

## E — Data sources

**One active source at a time** (MVP).

| Source | Status |
|--------|--------|
| Local Postgres | `connected` — real queries |
| Snowflake (demo) | `auth_required` — OAuth required |

**Activate flow:**

1. Click a source → **Activate**.
2. **Postgres** — immediate; schema reloads.
3. **Snowflake demo** — Keycloak sign-in if needed; then activation and schema load.

---

## F — Schema browser

1. **Table list** — `customers`, `orders`.
2. Click a table → **columns + types**.
3. **Preview** — quick `SELECT`; SQL appears in the query runner.

---

## G — Visual builder

1. Choose **table**.
2. Select **columns** (or `*`).
3. Set **LIMIT**.
4. **Build SQL** → fills the query runner.

Best for simple `SELECT` queries, not aggregates.

---

## H — Semantic builder

Reads `semantic.yml` via `GET /api/v1/semantic`.

- **Cubes:** `orders`, `customers`
- **Measures:** `total_amount`, `order_count`, etc.
- **Dimensions:** `status`, `order_date`, `region`, etc.

**Flow:** cube → measure → dimensions → **Generate SQL** → run in query runner.

---

## I — Query runner

| Action | Purpose |
|--------|---------|
| Presets | Canned analyses |
| Explain | Trino distributed plan |
| Stream | SSE incremental results |
| Run query | Full synchronous result |

**Policy:** Writes, DDL, and multi-statement SQL are blocked. Optional OPA when `OPA_ENABLED=true`.

**Cache:** Identical SQL may return a **cache hit** (see results meta).

---

## J — Results (table)

After **Run query**:

- Row count, duration, cache status, masked columns
- Results **table**
- **Cube view** — 3-D pivot (see section M)
- **Export CSV** — admin only

Non-admins see `***` on masked columns.

---

## K — Stream results

1. `POST /api/v1/queries` — create job
2. `GET .../stream` — SSE events: `data`, `progress`, `complete`, `error`
3. **Stream results** panel updates live

Also: `POST /api/v1/query?stream=true` returns `202` and a `streamUrl`.

---

## L — Insight assistant

**Summarize** runs current SQL and returns row/column counts plus min, max, and avg for numeric columns. Quick profiling only (not an LLM).

---

## M — 3-D cube viewer

Needs a **3-column** pivot query: row dimension, column dimension, one measure.

```sql
SELECT c.region, o.status, SUM(o.amount) AS total_amount
FROM orders o
JOIN customers c ON c.id = o.customer_id
GROUP BY c.region, o.status;
```

| Interaction | Effect |
|-------------|--------|
| Drag | Rotate |
| Scroll | Zoom |
| Click bar | Drill-down (updates SQL) |

**2-D fallback:** Vega-Lite heatmap if FPS stays below 20 for about 2 seconds.

Fewer than three columns shows a decorative preview or a “cube unavailable” hint.

---

## N — Snapshots

**Save snapshot** — stores SQL and metadata. Click to reload into the runner.

---

## O — Notebook

Title plus freeform notes. Separate from snapshots; for analysis context.

---

## P — Query history

Past runs with SQL, timing, row count, and status. Click to reload SQL. May show query, error, and cache metrics.

---

## Q — Alerts

Define: name, SQL (single numeric result), comparison operator, threshold.

**Evaluate** runs now and reports whether it **triggered** and the **last value**.

---

## R — Governance (behind the scenes)

| Concern | Location |
|---------|----------|
| Audit log | `GET /api/v1/audit` |
| History | `GET /api/v1/history` |
| OPA policies | `services/policy/policy.rego` |
| Column masking | Applied in API by role |

Set `OPA_ENABLED=true` with the OPA container running.

---

## S — API path (no UI)

Base URL: `http://localhost:3000/api/v1/`

Endpoints include query, stream, schema, semantic, exports, sources, history, audit, notebooks, snapshots, and alerts.

See `docs/API_SPEC.md` and `WORKING.md`.

---

## T — Configuration modes

Copy `.env.example` to `.env`.

| Mode | How to enable |
|------|----------------|
| Casual local | Defaults |
| API key | `AUTH_REQUIRED=true` and `API_KEY` |
| Keycloak | `KEYCLOAK_ENABLED=true` |
| OPA | `OPA_ENABLED=true` |

---

## U — Not in this MVP

- Live Snowflake, BigQuery, or SQL Server (Postgres via Trino only)
- Snowflake in UI is an **auth demo**, not a real connector
- Vault unused; no Kubernetes manifests yet
- No OpenTelemetry; no large-scale performance proof

See `docs/MVP_STATUS.md`.

---

## V — 15-minute demo script

1. Status — green Trino and Postgres; Postgres active
2. Schema — open `orders`, preview
3. Semantic builder — `orders`, `total_amount`, dimensions
4. Run query — table; masking as `user`
5. Cube view — rotate, drill
6. Stream — incremental rows
7. Summarize — numeric stats
8. Role **admin** — Export CSV
9. Save snapshot — reload
10. Alert — evaluate
11. (Optional) Keycloak — Snowflake demo source

Also: `docs/pilot/README.md` and `docs/pilot/LAUNCH_CHECKLIST.md`

---

## Z — Shut down

```bash
./stop.sh
```

Or `docker compose down` from the repo root.

---

## Summary

Connect a source, discover schema or use semantic measures, run SQL, then explore via table, stream, or cube. Snapshot, notebook, alert, and audit are built in. Optional Keycloak and OPA when enabled.

---

## Related docs

| Document | Topic |
|----------|-------|
| WORKING.md | Setup and panels |
| TESTING.md | Tests and checklist |
| AUTH_SETUP.md | Keycloak |
| MVP_STATUS.md | PRD coverage |
| API_SPEC.md | REST API |
| SYSTEM_DESIGN.md | Architecture |
