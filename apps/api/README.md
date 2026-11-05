# @trace/api

Fastify API gateway and query orchestration layer.

## Structure

```
src/
  lib/
    connectors/     Connector interface, dialects, and Postgres / MySQL / SQLite / Trino / PGlite drivers
    sources.ts      Hot-swappable source registry (add, test, activate, remove; persisted to data/sources.json)
    automodel.ts    Automatic semantic model + dialect-aware aggregate SQL
    model-cache.ts  Per-source schema and model cache
    engine.ts       Query facade over the active source with page:// cursors
    embedded.ts     Built-in retail demo (PGlite) and its seeding
    uploads.ts      CSV / JSON → typed tables in the files workspace
    samples.ts      Generated fleet SQLite sample
    store.ts        JSON-file persistence for history, audit, notebooks, snapshots, alerts
    cache.ts        LRU + TTL result cache
    auth.ts         Roles, API key / JWT validation, PII masking
    policy.ts       OPA client + local policy enforcement
  routes/
    datasources.ts  GET/POST /data-sources, POST /data-sources/test, DELETE /data-sources/:id,
                    POST /data-sources/:id/activate, POST /data-sources/files/upload
    model.ts        GET /model, POST /aggregate
    query.ts        POST /query, /query/next, /explain
    stream.ts       POST /queries, GET /queries/:id/stream (SSE)
    schema.ts       GET /schema (?table=, ?full=true)
    status.ts       /health, /status, /metrics
    …               exports, assistant, notebooks, snapshots, alerts, governance
```

## Dev

```bash
npm run dev         # tsx watch
npm run test        # vitest run
npm run build       # tsc emit to dist/
```

## Environment variables

See `.env.example` at the repo root.
