# Trace MVP Status

Maps every PRD functional requirement (FR-1 through FR-10) to its current implementation state.

| FR | Requirement | Status | Where |
|----|-------------|--------|-------|
| FR-1 | UI lists all configured database containers with status (connected / auth-required) | Done | `GET /api/v1/data-sources` → `apps/api/src/routes/datasources.ts`; `apps/web/src/App.tsx` Data sources panel |
| FR-2 | Selecting a container initiates an authentication flow; on success the cube loads schema automatically | Partial | Source activation works (`POST /api/v1/data-sources/:id/activate`). OAuth/SAML flow pending — Phase 5 |
| FR-3 | Visual builder or raw SQL; engine parses and executes against the active source | Done | `POST /api/v1/query` → Trino pushdown; Visual builder in `apps/web/src/App.tsx`; semantic builder wired in Phase 3 |
| FR-4 | Query results streamed to 3-D viewer within 2 s for ≤ 50M rows (P95) | Partial | Sync query path live; SSE streaming endpoint in Phase 6; 3-D cube viewer in Phase 7 |
| FR-5 | All data-fetch operations logged with user, timestamp, and source DB | Done | `apps/api/src/lib/store.ts` audit log; `GET /api/v1/audit` |
| FR-6 | Enforce per-user permissions via a central policy engine (OPA) | Partial | Local `isSafeQuery` blocks writes/DDL; full OPA integration in Phase 4 |
| FR-7 | Export function respects the same security constraints as the source DB | Done | `POST /api/v1/exports` gated on admin role via `evaluatePolicy`; `apps/api/src/routes/exports.ts` |
| FR-8 | Runs on macOS, Windows, Linux with Docker + WebGL | Done | Docker Compose at `infra/docker/`; Three.js WebGL rendering in `apps/web/src/ThreePreview.tsx` |
| FR-9 | Query history accessible, replayable, exportable with explain-plan | Done | `GET /api/v1/history`; `POST /api/v1/explain`; history panel in UI |
| FR-10 | 2-D fallback view for hardware that cannot sustain 3-D rendering | Done | FPS sampler in `ThreePreview.tsx`; full Vega-Lite fallback in Phase 7 |

## Out of scope for this MVP iteration

- Snowflake, BigQuery, SQL Server connectors (Postgres only; see `services/connector/README.md`)
- HashiCorp Vault secrets rotation (Vault container present but unused)
- Kubernetes manifests (`infra/k8s/` deferred; see that directory's README)
- OpenTelemetry distributed tracing

## Phase backlog

| Phase | Feature | Notes |
|-------|---------|-------|
| 3 | Shared types, semantic model, `/api/v1/semantic` | In progress |
| 4 | OPA policy enforcement | Rego files in `services/policy/` |
| 5 | Keycloak OAuth (PKCE) | Realm export in `services/auth/` |
| 6 | SSE streaming for query results | Matches `API_SPEC.md §6` |
| 7 | Real 3-D OLAP cube viewer (OrbitControls, drill-through) | Replaces decorative bar chart |
