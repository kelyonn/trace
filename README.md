# trace

Trace is a virtual OLAP and semantic exploration product that connects to one production data source at a time and renders results in a real-time 3-D UI with a 2-D fallback.

## Repo layout
- apps/web: web UI
- apps/api: API gateway and orchestration
- services/connector: DB connector adapters
- services/query-engine: Trino config and deployment assets
- services/policy: OPA policies and tests
- services/auth: Keycloak config and deployment assets
- packages/shared-types: shared DTOs and API types
- packages/ui-kit: reusable UI components
- infra/docker: Dockerfiles and compose files
- infra/k8s: Kubernetes manifests (optional)
- infra/scripts: local tooling scripts
- docs: product and system documentation

## Getting started
- Install dependencies: npm install
- Start API: npm run dev:api
- Start Web: npm run dev:web
- Build API: npm run build:api
- Build Web: npm run build:web

## Local infrastructure
- docker compose -f infra/docker/docker-compose.yml up

## Docs
- docs/SYSTEM_DESIGN.md
- docs/API_SPEC.md
- docs/REPO_AND_CICD.md
