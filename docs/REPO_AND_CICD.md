# Repo Structure and CI/CD Plan (Monorepo)

## 1. Monorepo Layout
```
trace/
  apps/
    web/                # React UI (2-D + 3-D views)
    api/                # Fastify API gateway + orchestration
  services/
    connector/          # DB connector adapters + schema discovery
    query-engine/       # Trino config and deployment assets
    policy/             # OPA policies and tests
    auth/               # Keycloak realm config and deployment assets
  packages/
    shared-types/       # Shared DTOs and API types
    ui-kit/             # Reusable UI components
  infra/
    docker/             # Dockerfiles, compose files
    k8s/                # Helm charts or manifests (optional)
    scripts/            # Dev tooling, setup scripts
  docs/
    SYSTEM_DESIGN.md
    API_SPEC.md
    REPO_AND_CICD.md
  .github/
    workflows/          # CI pipelines
  package.json          # Root workspace config
  tsconfig.base.json
  README.md
```

## 2. Package Management
- Use a workspace manager (pnpm or npm workspaces).
- Shared dependencies live at root; app-specific ones in each package.
- Shared types published as internal workspace package.

## 3. CI/CD Stages
### 3.1 Validate
- Lint (ESLint), typecheck (tsc), format (Prettier).
- Run unit tests for packages with changes.

### 3.2 Build
- Build web app and API.
- Build connector service.
- Build Docker images.

### 3.3 Integration Tests
- Spin up Postgres + Trino + API in Docker Compose.
- Run smoke tests for schema discovery and query execution.

### 3.4 Security
- Dependency scanning (npm audit or Snyk).
- Secret scanning for commits.

### 3.5 Deploy (On-Prem)
- Produce Docker images and publish to a local registry.
- Optional: Helm chart packaging for Kubernetes.

## 4. Local Dev Workflow
- `pnpm install` at root.
- `pnpm dev` starts web + api.
- `docker compose up` for local infra (Postgres, Trino, Vault, Keycloak).

## 5. Suggested CI Tools
- GitHub Actions for CI.
- Docker Buildx for multi-arch images.
- OPA test runner for policy validation.

## 6. Next Actions
- Decide workspace manager: pnpm or npm.
- Define basic CI workflow file in .github/workflows/ci.yml.
- Add Docker Compose for local dev.
