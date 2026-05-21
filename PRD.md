# Trace – Product Requirements Document (PRD)

---

## 1. Summary
Trace is a virtual OLAP and semantic exploration product that connects to one production data source at a time (per‑source authentication) and renders query results in a real‑time, interactive 3‑D UI with a 2‑D fallback. The system favors pushdown execution to the source database, with optional in‑memory caching for interactive exploration. The product is aimed at business professionals and data‑analytics teams who need to explore and validate analytical results on‑the‑fly.

## 2. Problem Statement
Business users currently rely on static reporting pipelines or heavyweight BI tools that (a) require data to be pre‑aggregated, (b) hide the underlying query process, and (c) do not support seamless switching between disparate data sources. A virtual OLAP experience that connects to production databases, while maintaining security and delivering an intuitive 3‑D view, gives analysts immediate insight into data shaping, query performance, and model behavior.

## 3. Goals & Success Metrics
| Goal | Success Metric |
|------|----------------|
| Real‑time analytics | ≤ 2 s P95 latency for standard slice‑and‑dice queries on up to 50M rows with 10 concurrent users |
| Secure per‑source access | OAuth2/SAML auth for each source; audit logs for every data fetch; secret rotation supported |
| Intuitive visual exploration | ≥ 80% of beta users rate the UI “useful” or better; ≤ 5 minutes to first query |
| High‑fidelity rendering | ≥ 60 FPS on commodity workstations for standard cube visualizations; 2‑D fallback at ≥ 30 FPS |
| Extensible connectors | Add a new supported DB connector in ≤ 2 weeks with documented test harness |
| Adoption and retention | ≥ 30% weekly active usage from enrolled pilots; ≥ 50% of pilots run 3+ sessions per week |

## 4. Target Audience
- **Business Professionals** – need quick “what‑if” analysis without deep SQL knowledge.
- **Data Analytics Teams** – require sandboxed, secure access to production databases for ad‑hoc modeling.

## 5. Core Features
1. **Multi‑Source Container Architecture** – each source DB wrapped as an isolated container with its own authentication credentials; UI lets users select the active container (one active at a time in MVP).
2. **Virtual OLAP + Semantic Layer** – SQL‑based semantic model with dimensions/measures; automatic schema discovery and cube definition generation per container; pushdown execution to the source DB by default.
3. **3‑D Interactive Cube Viewer + 2‑D Fallback** – real‑time rendering of dimensions, measures, and hierarchies; drag‑to‑rotate, zoom, and drill‑through.
4. **Authentication & Security** – OAuth2/SAML integration; role‑based access control, row‑level/column‑level policy enforcement, per‑user audit trails, encrypted at‑rest and in‑flight data.
5. **Insight Assistant (Phase 2)** – statistical summaries, anomaly detection, and query explainers with guardrails.
6. **Export & Collaboration** – export query results to CSV/Parquet; share snapshots of the 3‑D view via secure links; watermark and size limits.

## 6. Functional Requirements
| ID | Requirement |
|----|-------------|
| FR‑1 | UI must list all configured database containers with status (connected / auth‑required). |
| FR‑2 | Selecting a container initiates an authentication flow; on success the cube loads schema automatically. |
| FR‑3 | Users can compose queries using a visual builder or raw SQL‑like syntax; the engine parses and executes against the active source. |
| FR‑4 | Query results are streamed to the 3‑D viewer; rendering updates within 2 seconds for ≤ 50M rows (P95). |
| FR‑5 | All data‑fetch operations are logged with user, timestamp, and source DB. |
| FR‑6 | The system must enforce per‑user permissions defined in a central policy engine (e.g., OPA). |
| FR‑7 | Export function must respect the same security constraints as the source DB. |
| FR‑8 | The product must run on macOS, Windows, and Linux with minimal dependencies (Docker for containers, WebGL for rendering). |
| FR‑9 | Query history must be accessible, replayable, and exportable with explain‑plan details. |
| FR‑10 | The system must provide a 2‑D fallback view for hardware that cannot sustain 3‑D rendering. |

## 7. Non‑Functional Requirements
- **Performance** – ≤ 2 s P95 query latency for defined workloads; ≥ 60 FPS rendering.
- **Scalability** – Support up to 20 concurrent container instances per environment; 10 concurrent users per instance.
- **Security** – Enforce TLS 1.3 for all network traffic; secrets stored in a vault (e.g., HashiCorp Vault).
- **Usability** – Onboarding flow ≤ 5 minutes for a new user to connect a database and run first query.
- **Reliability** – 99.5% uptime for the front‑end service; container failures isolated per source.
- **Governance** – Data lineage, PII masking, and export compliance policies.

## 8. Assumptions & Constraints
- No timeline has been defined yet; planning will follow a phased MVP approach.
- All source databases expose a JDBC/ODBC driver compatible with the container runtime.
- Users will have appropriate network access (VPN / firewall rules) to reach production databases.
- MVP supports a limited set of production databases (e.g., Postgres, Snowflake, BigQuery, SQL Server).

## 9. Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| Data leakage through mis‑configured credentials | Mandatory secret scanning and automated policy validation before container launch. |
| Performance variability across heterogeneous DBs | Implement per‑source query timeout and fallback to async preview mode. |
| 3‑D rendering breaks on low‑end hardware | Provide a “2‑D fallback” rendering mode. |
| Complexity of managing many auth providers | Abstract auth via a unified OAuth/SAML gateway. |
| Unclear value of 3‑D UI for core tasks | Validate with task‑based usability testing and provide equal‑quality 2‑D UI. |

## 10. Open Questions
1. Should the product support simultaneous connections to multiple containers (e.g., cross‑source joins) in Phase 2?
2. What level of inference assistance is expected for the “assistant” feature, and what guardrails are required?
3. Are there any compliance regimes (GDPR, HIPAA, SOC 2, etc.) that dictate data‑handling specifics?
4. What query language should be supported first: SQL‑like semantic layer, MDX, or both?
5. What is the minimum acceptable hardware for the 3‑D UI, and how should fallback be enforced?

## 11. Suggested Tooling (Industry Standard)
- **Query engines** – Trino, Presto, Apache Spark SQL, Databricks SQL, Arrow Flight SQL.
- **Semantic/OLAP layer** – Cube, dbt Semantic Layer, Apache Druid, ClickHouse, DuckDB (embedded).
- **Connectors/ingestion** – Airbyte, Fivetran, Debezium (CDC), Meltano.
- **Auth & IAM** – Auth0, Okta, Keycloak; Open Policy Agent (OPA) for fine‑grained policies.
- **Secrets & key mgmt** – HashiCorp Vault, AWS Secrets Manager, GCP Secret Manager.
- **Observability** – OpenTelemetry, Grafana/Tempo/Loki, Datadog.
- **Metadata & lineage** – DataHub, Amundsen, OpenMetadata.
- **3‑D rendering** – Three.js, Babylon.js; **2‑D fallback** – D3.js, Vega‑Lite.

## 12. Additional Feature Opportunities
1. **Query History & Replay** – save, replay, and compare query results with explain plans.
2. **Notebook Mode** – SQL + visualization + narrative for analysts.
3. **Data Lineage & Impact Analysis** – show dependencies when schemas change.
4. **Collaboration** – shared workspaces, annotations, reviews, and approvals.
5. **Performance Assistant** – caching suggestions and aggregate recommendations.
6. **Alerting & Monitoring** – KPI alerts, anomaly notifications, and usage dashboards.
7. **API/SDK** – embed Trace visuals and queries into internal tools.

## 13. MVP Scope Proposal
- Support 3–4 core databases (Postgres, Snowflake, BigQuery, SQL Server).
- SQL‑based semantic layer with curated dimensions/measures.
- 2‑D analytics view + 3‑D prototype.
- Auth via one provider + OPA policy file.
- Query history, audit logging, and CSV export.

## 14. Implementation Plan (Phased)
**Phase 0: Foundations (Weeks 1–2)**
- Architecture decisions: source pushdown vs caching strategy, connector interface, semantic model format.
- Select stack: query engine, semantic layer, 3‑D library, policy engine, secrets manager.
- Define API contracts: auth, connector lifecycle, schema discovery, query execution, rendering feed.
- Deliverables: system design doc, API spec, repo structure, CI/CD, baseline observability.

**Phase 1: MVP Core Data Path (Weeks 3–6)**
- Connector framework with 2 sources (Postgres + Snowflake).
- Schema discovery + semantic model generation.
- SQL‑like query parser and pushdown execution.
- Audit logging and query history.
- Deliverables: backend can connect, discover schema, run queries, and log usage.

**Phase 2: UI MVP (Weeks 5–8, parallel)**
- Web app shell, onboarding flow, container list/status.
- Visual query builder + raw SQL editor.
- 2‑D analytics view (tables + charts) with streaming updates.
- Deliverables: end‑to‑end flow to run a query and view results.

**Phase 3: 3‑D Prototype + Fallback (Weeks 7–10)**
- 3‑D cube rendering pipeline with drill/rotate/zoom.
- Performance budget instrumentation and hardware detection.
- 2‑D fallback enforcement rules.
- Deliverables: 3‑D view for core interactions + fallback logic.

**Phase 4: Security & Governance (Weeks 9–12)**
- OAuth/SAML integration (single provider first).
- OPA policy enforcement (row/column policies).
- Secrets management and rotation support.
- Export controls (watermark, size limits).
- Deliverables: production‑ready auth, policy enforcement, and export controls.

**Phase 5: Scale & Reliability (Weeks 11–14)**
- Container lifecycle management (start/idle/terminate).
- Caching strategy and query timeouts.
- Observability (OpenTelemetry traces, metrics).
- Deliverables: stable performance under load, 99.5% uptime readiness.

**Phase 6: Pilot & Validation (Weeks 13–16)**
- Pilot onboarding and feedback loop.
- Usability tests (3‑D value validation).
- KPI tracking: time‑to‑first‑query, WAU, query latency.
- Deliverables: pilot report, prioritized backlog for Phase 2 features.

---

