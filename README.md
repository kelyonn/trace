# Trace

Trace is a virtual OLAP and semantic exploration product. It connects to one production data source at a time and renders results in a real-time 3-D UI with a 2-D fallback.

## Repo layout

```
apps/
  api/            Fastify API gateway and orchestration
  web/            React UI (query runner, 3-D cube viewer, schema browser)
services/
  connector/      DB connector adapters and schema discovery
  query-engine/   Trino config, deployment assets, and semantic model
  policy/         OPA policies and tests
  auth/           Keycloak realm config and deployment assets
packages/
  shared-types/   Shared TypeScript DTOs and API types
  ui-kit/         Reusable React UI components
infra/
  docker/         Docker Compose and supporting config (canonical)
  scripts/        Local tooling scripts
docs/
  SYSTEM_DESIGN.md
  API_SPEC.md
  REPO_AND_CICD.md
  AUTH_SETUP.md
  MVP_STATUS.md
  pilot/          Pilot launch materials
```

## Quick start

```bash
./run.sh          # starts Docker infra + API + Web
```

Open:
- UI: http://localhost:5173
- API health: http://localhost:3000/health
- API status: http://localhost:3000/api/v1/status

## Manual start

```bash
docker compose up -d          # starts Postgres, Trino, Keycloak, OPA
npm install
npm run dev:api               # API on :3000
npm run dev:web               # Web on :5173
```

## Build

```bash
npm run build:api
npm run build:web
```

## Tests

```bash
npm -w apps/api run test
```

## Smoke test

```bash
bash infra/scripts/sanity_check.sh
```

## Stop everything

```bash
./stop.sh
```

## Configuration

Copy `.env.example` to `.env` and adjust. Key variables:

| Variable | Default | Purpose |
|----------|---------|---------|
| `AUTH_REQUIRED` | `false` | Enforce API key on all requests |
| `API_KEY` | — | Bearer token when `AUTH_REQUIRED=true` |
| `MASK_COLUMNS` | `name` | Columns masked for non-admin roles |
| `OPA_ENABLED` | `false` | Enable OPA policy enforcement |
| `TRINO_URL` | `http://localhost:8080` | Trino REST endpoint |

See `.env.example` for the full list.

## Docs

- [System design](docs/SYSTEM_DESIGN.md)
- [API spec](docs/API_SPEC.md)
- [Repo & CI/CD](docs/REPO_AND_CICD.md)
- [Auth setup](docs/AUTH_SETUP.md)
- [MVP status](docs/MVP_STATUS.md)
- [Working guide](WORKING.md)
