# Trace

Trace is a virtual OLAP explorer. Point it at a database or drop in a file. It infers a semantic model (fact table, joins, measures, dimensions, time hierarchies and drill paths) and gives you an overview dashboard, an interactive 3-D cube, and a SQL workspace. Queries are pushed down to the source, read-only, policy-checked and audited.

## Quick start (no Docker needed)

```bash
npm install
```

```bash
./run.sh
```

Open http://localhost:5173. Trace starts on the built-in **Retail demo** (an embedded Postgres seeded with about 80k orders on first boot). From **Sources** you can switch to the **Fleet trips** SQLite sample, connect your own database, or upload a CSV/JSON file. Every view re-derives itself from the new source.

`./run.sh` also starts the Docker stack (Postgres + Trino + Keycloak + OPA) when a Docker daemon is available. Set `USE_DOCKER=false` to skip it.

## Data sources (hot-swappable)

| Source | How to add it | Notes |
|---|---|---|
| PostgreSQL | Sources → Add a connection | Connection string or host/port/db/user/password, optional schema & SSL. Sessions are `default_transaction_read_only`. |
| MySQL / MariaDB | Sources → Add a connection | Sessions are `READ ONLY` with `MAX_EXECUTION_TIME`. |
| SQLite | Sources → Add a connection (file path on the API host) | Opened read-only via `node:sqlite`. |
| Trino | Sources → Add a connection | Coordinator URL, catalog, schema. Keys are inferred from `*_id` naming. |
| CSV / JSON | Sources → Upload data (drag & drop) | Loaded into an embedded Postgres workspace with inferred types (int, float, date, timestamp, boolean, text). Several files can be joined via `*_id` columns. |
| Retail demo | built in | Synthetic retail star schema (orders, order lines, customers, products). |
| Fleet trips | built in | Synthetic ride-hailing SQLite database, generated on first use. |

Exactly one source is active at a time. Switching closes the previous connection pool, and models are cached per source. Credentials are stored server-side in `data/sources.json` (mode 600, gitignored) and are always redacted in API responses. With `AUTH_REQUIRED=true`, only `admin` can add or remove sources.

## How the model is inferred

1. **Introspect** tables, columns, primary/foreign keys and row counts (`information_schema`, `PRAGMA`, …). Without declared constraints, `id` / `<table>_id` naming is used.
2. **Pick the fact table**, scoring outbound FKs, numeric columns, dates and size. It can be overridden in the Overview or Cube.
3. **Join** dimension tables by following foreign keys two hops out (snowflake).
4. **Profile** candidate columns in one sampled query per table (distinct counts, text length) to keep readable dimensions and drop free text.
5. **Drill paths**: within a table, dimensions go coarse → fine by cardinality (e.g. region → country → city). Dates become year → quarter → month.
6. **Measures**: row count, `SUM`/`AVG` of numeric fact columns, `COUNT(DISTINCT …)` of joined entities. Money-like names get currency formatting.
7. **SQL is generated per dialect** (Postgres, MySQL, SQLite, Trino), joining only the tables a query needs.

PII columns listed in `MASK_COLUMNS` (bare `email` or qualified `customers.name`) are hidden from the model and masked in raw SQL results for non-admin roles.

## What you can do

- **Overview**: auto-generated KPIs (trailing 12 months vs prior), the main measure over time split by a coarse dimension, breakdowns, a heatmap, top entities, and the inferred model itself. Every panel links to its SQL, and clicking a bar or cell drills into the cube.
- **Cube**: a real X × Y × Z voxel cube (react-three-fiber). Hover for crosshairs and values. Click to select and inspect. Double-click (or Enter) to drill into a cell. Click an axis label to slice; ⇧-click to dice a member out. Sweep a slice with playback, pivot (P), roll up any axis, use camera presets (1–4) and keyboard navigation (arrows, `[` `]`), with a linked pivot table underneath.
- **Query**: schema tree with keys and row counts, model-driven presets and builder, SQL editor (⌘↵), explain, streaming (SSE), table / chart / cube result views, CSV export, snapshots.
- **Activity**: query history with replay, audit trail, insight summaries, alerts and notebooks.

## Repo layout

```
apps/
  api/   Fastify API: connectors, source registry, auto semantic model, query/stream/export routes
  web/   React + Vite UI: overview, cube (three.js / R3F), query workspace, sources
packages/shared-types   DTOs shared by API and web
services/               OPA policies, Keycloak realm, Trino config, legacy semantic.yml
infra/                  Docker compose, seed and launcher scripts
docs/                   Design, API spec, auth, pilot material
```

## Development

```bash
npm run dev:api
```

```bash
npm run dev:web
```

```bash
npm test
```

```bash
npm -w apps/web run typecheck
```

```bash
npm run build:api && npm run build:web
```

```bash
bash infra/scripts/sanity_check.sh
```

The API tests cover the connectors end to end without external services: SQLite through `node:sqlite`, PostgreSQL through the real `pg` driver against PGlite served over the wire protocol, and CSV/JSON uploads.

## Configuration

Copy `.env.example` to `.env`. Key variables:

| Variable | Default | Purpose |
|---|---|---|
| `ENGINE` | `auto` | Initial source: `auto` (Trino if reachable, else last used), `embedded`, `trino` |
| `AUTH_REQUIRED` | `false` | Require an API key / JWT; restricts source management to admins |
| `MASK_COLUMNS` | `customers.name,drivers.name,email,phone` | PII hidden for non-admins |
| `MAX_RESULT_ROWS` | `50000` | Row cap per query |
| `STATEMENT_TIMEOUT_MS` | `30000` | Per-statement timeout on external sources |
| `OPA_ENABLED` | `false` | Enforce policies via OPA |

## Docs

- [Product walkthrough](docs/PRODUCT_WALKTHROUGH.md)
- [System design](docs/SYSTEM_DESIGN.md)
- [API spec](docs/API_SPEC.md)
- [Auth setup](docs/AUTH_SETUP.md)
- [MVP status](docs/MVP_STATUS.md)
