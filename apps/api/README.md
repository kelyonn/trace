# @trace/api

Fastify API gateway and query orchestration layer.

## Structure

```
src/
  lib/
    trino.ts      Trino REST client (fetchTrinoStatement, collectTrino)
    store.ts      JSON-file persistence for history, audit, notebooks, snapshots, alerts
    cache.ts      LRU + TTL query result cache
    auth.ts       Role extraction, API key validation, column masking
    policy.ts     OPA client + local policy enforcement (isSafeQuery)
    state.ts      In-memory singletons (dataSources, exportJobs, metrics)
  routes/
    status.ts     /health, /api/v1/status, /api/v1/metrics
    query.ts      POST /api/v1/query, /api/v1/query/next, /api/v1/explain
    schema.ts     GET /api/v1/schema
    exports.ts    POST/GET /api/v1/exports
    datasources.ts GET/POST /api/v1/data-sources
    assistant.ts  POST /api/v1/assistant/summary
    notebooks.ts  GET/POST/PUT /api/v1/notebooks
    snapshots.ts  GET/POST /api/v1/snapshots
    alerts.ts     GET/POST /api/v1/alerts, POST /api/v1/alerts/:id/evaluate
    governance.ts GET /api/v1/history, /api/v1/audit
  index.ts        Server bootstrap and plugin registration
  __tests__/      Vitest test suite
```

## Dev

```bash
npm run dev         # tsx watch
npm run test        # vitest run
npm run build       # tsc emit to dist/
```

## Environment variables

See `.env.example` at the repo root.
