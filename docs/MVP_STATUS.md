# Trace MVP Status

Maps PRD functional requirements (FR-1 through FR-10) to implementation. Last updated for `v0.1.0-mvp` completion pass.

| FR | Requirement | Status | Where |
|----|-------------|--------|-------|
| FR-1 | UI lists configured data sources with status | **Done** | `GET /api/v1/data-sources`; Sources view (add, test, activate, remove, upload) |
| FR-2 | Selecting a source triggers auth; on success schema loads | **Done** | `auth_required` sources require Keycloak JWT on activate; pending source resumed after PKCE (`useAuth`, `activateSource`) |
| FR-3 | Visual / semantic builder or raw SQL against active source | **Done** | `POST /api/v1/query`, semantic builder, visual builder |
| FR-4 | Results streamed to 3-D viewer (P95 ≤ 2s @ 50M rows) | **Partial** | SSE `POST /queries` + `GET /queries/:id/stream`, `?stream=true` on sync query; cube viewer live; large-scale perf not benchmarked |
| FR-5 | All data-fetch ops audited | **Done** | `lib/store.ts` audit log, `GET /api/v1/audit` |
| FR-6 | Central policy engine (OPA) | **Done** | `services/policy/policy.rego`, `OPA_ENABLED`, `evaluatePolicy` on query/schema/export/activate; `getMaskColumns` from OPA |
| FR-7 | Export respects same constraints as source | **Done** | Export gated on admin + query policy on SQL |
| FR-8 | macOS / Windows / Linux + Docker + WebGL | **Done** | Docker Compose, Three.js cube |
| FR-9 | Query history, replay, explain | **Done** | History panel, `POST /api/v1/explain` |
| FR-10 | 2-D fallback when 3-D cannot sustain FPS | **Done** | `CubeViewer` Vega-Lite heatmap when FPS &lt; 20 |

## Platform features (plan phases 1–8)

| Phase | Feature | Status |
|-------|---------|--------|
| 1 | Modular API, tests, CI, infra dedup | **Done** |
| 2 | Tracked docs, `.env.example`, READMEs | **Done** |
| 3 | `@trace/shared-types`, semantic model | **Done** |
| 4 | OPA policies + sidecar + API integration | **Done** |
| 5 | Keycloak realm, PKCE web, JWT + API key auth | **Done** |
| 6 | SSE streaming + token query param for EventSource | **Done** |
| 7 | `CubeViewer`, `pivot.ts`, drill-through, Vega fallback | **Done** |
| 8 | WORKING/TESTING/pilot docs, `v0.1.0-mvp` tag | **Done** |

## Auth modes

| Mode | Env | Behavior |
|------|-----|----------|
| Local dev (default) | `AUTH_REQUIRED=false` | No credential required; optional `x-trace-role` + API key |
| API key | `AUTH_REQUIRED=true` | Bearer must match `API_KEY` |
| Keycloak | `KEYCLOAK_ENABLED=true` | Valid JWT sets role from `realm_access.roles`; API key still accepted when `AUTH_REQUIRED=true` |
| SSE | `?token=` on stream URL | Passes Bearer token when `EventSource` cannot send headers |

## Data sources

Hot-swappable connectors: PostgreSQL, MySQL/MariaDB, SQLite, Trino, CSV/JSON uploads, plus the built-in retail demo and fleet SQLite sample. Each source gets an automatically inferred semantic model (`apps/api/src/lib/automodel.ts`) that drives the overview, the cube and the query builder.

## Out of scope (deferred)

- Snowflake / BigQuery / SQL Server connectors (reachable today through Trino catalogs)
- Vault secrets rotation
- Kubernetes manifests (`infra/k8s/README.md`)
- OpenTelemetry tracing
