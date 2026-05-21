# Trace System Design

## 1. Goals
- Provide a secure, low-latency analytical exploration experience against production databases.
- Support one active data source per session in MVP with a pluggable connector framework.
- Deliver real-time updates to a 3-D UI with a 2-D fallback path.
- Preserve auditability, policy enforcement, and export constraints.

## 2. Non-Goals (MVP)
- Cross-source joins or multi-source queries in a single session.
- Long-term materialized aggregation store.
- Full data catalog or governance suite.

## 3. High-Level Architecture
- Client UI (Web): query builder, 2-D/3-D visualization, session management.
- API Gateway: auth, request routing, rate limits.
- Auth Service: OAuth/SAML integration, token issuance, user metadata.
- Policy Engine: OPA policy evaluation for row/column permissions.
- Connector Service: per-source connectors, schema discovery, query execution.
- Query Orchestrator: query planning, pushdown execution, caching, timeouts.
- Result Streamer: real-time streaming to the UI (WebSocket or SSE).
- Audit and History: immutable event log + query history store.
- Secrets Manager: credentials and rotations (Vault or cloud manager).

## 3.1 Technology Choices (MVP)
- Backend: Node.js + TypeScript (Fastify) for API and orchestration.
- Query engine: Trino for pushdown queries and connector ecosystem.
- Semantic layer: Cube (Cube.js) for fast integration and interactive performance.
- Policy engine: OPA sidecar for row and column enforcement.
- Secrets: HashiCorp Vault (self-hosted) for on-prem.
- Auth: Keycloak for on-prem OAuth/SAML integration.
- Streaming: WebSocket for results and progress.
- Frontend: React + Three.js (3-D) + Vega-Lite (2-D fallback).
- Observability: OpenTelemetry + Grafana/Loki/Tempo.

## 4. Core Data Flows
### 4.1 Connect and Authenticate
1) User selects data source container.
2) UI requests auth initiation.
3) Auth service returns auth URL or token exchange instructions.
4) Upon success, UI receives access token; session is established.

### 4.2 Schema Discovery
1) UI requests schema for the active container.
2) Connector service inspects metadata via JDBC/ODBC.
3) Semantic layer maps tables to dimensions/measures.
4) Schema stored in a versioned model registry.

### 4.3 Query Execution
1) UI sends query (visual model or raw SQL-like) to API.
2) Orchestrator validates query, enforces policy via OPA.
3) Query is pushed down to the source DB; results streamed.
4) Streamer updates the UI; history and audit recorded.

### 4.4 Export
1) UI requests export with a query reference.
2) Policy engine validates export permissions.
3) Export worker produces CSV/Parquet with watermark.
4) Secure download link returned.

## 5. Components and Responsibilities
### 5.1 UI
- Query builder and raw editor.
- 2-D and 3-D renderers.
- Session and source selection.
- Streaming result consumer.

### 5.2 API Gateway
- Auth token validation and routing.
- Rate limits and request tracing.

### 5.3 Auth Service
- OAuth/SAML integrations.
- User sessions and identity claims.

### 5.4 Policy Engine (OPA)
- Row and column rules.
- Export constraints.

### 5.5 Connector Service
- Adapter interface per DB source.
- Metadata discovery and driver management.
- Connection pooling and timeouts.

### 5.6 Query Orchestrator
- Query validation and logical planning.
- Pushdown strategy and fallback caching.
- Explain plan capture.

### 5.7 Result Streamer
- WebSocket or SSE delivery.
- Backpressure and chunking.

### 5.8 Audit and History
- Query history store.
- Immutable audit log.

## 6. Data Model (Logical)
- DataSource: id, type, name, status, authState.
- SchemaVersion: id, dataSourceId, version, createdAt.
- Dimension: id, name, dataType, hierarchy.
- Measure: id, name, expression, aggregation.
- Query: id, userId, dataSourceId, submittedAt, status.
- QueryResultChunk: id, queryId, sequence, payload.
- AuditEvent: id, userId, action, dataSourceId, timestamp.
- ExportJob: id, queryId, status, createdAt, downloadUrl.

## 7. Security Model
- OAuth/SAML for user authentication.
- OPA for per-user row/column policies.
- TLS 1.3 for all network traffic.
- Secrets in Vault or cloud secret manager.
- Audit logs for every fetch and export.

## 8. Performance and Scalability
- Target: <= 2s P95 for defined workloads.
- Query timeouts and async preview fallback.
- Connection pooling per data source.
- Horizontal scaling of orchestrator and streamer.

## 9. Observability
- OpenTelemetry tracing for query lifecycle.
- Metrics: latency, throughput, cache hit, error rates.
- Logs correlated by trace id.

## 10. Deployment
- Docker containers for services and connectors.
- Optional Kubernetes for orchestration.
- CI/CD with unit + integration tests.

## 11. Open Decisions
- Query language: SQL-like only vs MDX support.
- Streaming protocol: WebSocket vs SSE.
- Semantic model storage: database vs file-based registry.
- Caching strategy: in-memory vs external store.
