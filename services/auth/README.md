# Auth service

Contains Keycloak realm configuration and deployment assets for OAuth 2.0 / SAML authentication.

## Realm: `trace`

The `realm-trace.json` export defines:

| Item | Value |
|------|-------|
| Realm | `trace` |
| Public client | `trace-web` (PKCE, redirect `http://localhost:5173/*`) |
| Confidential client | `trace-api` (for server-side JWT validation) |
| Roles | `admin`, `analyst` |
| Test users | `admin@trace.local` (password: `admin`), `analyst@trace.local` (password: `analyst`) |

## Importing the realm

The Keycloak container in `infra/docker/docker-compose.yml` auto-imports the realm on first start via the `KC_IMPORT` env var.

Manual import:
1. Open http://localhost:8081 and sign in as `admin / admin`.
2. Create realm → import `services/auth/realm-trace.json`.

## API JWT validation

Set in `.env`:
```
AUTH_REQUIRED=true
KEYCLOAK_URL=http://localhost:8081
KEYCLOAK_REALM=trace
KEYCLOAK_CLIENT_ID=trace-api
```

The API (`apps/api/src/lib/auth.ts`) fetches the JWKS from Keycloak and verifies Bearer JWTs on every request. The `realm_access.roles` claim maps to the `x-trace-role` logic used elsewhere.

## Web PKCE flow

The web app (`apps/web/src/hooks/useAuth.ts`) implements the PKCE authorization code flow against `http://localhost:8081/realms/trace`. Tokens are stored in memory; a refresh timer keeps them alive.

## Extending auth

- To add a social provider (Google, GitHub), configure it in the Keycloak admin UI and export a new `realm-trace.json`.
- To enforce group-based access, add group roles to the realm and update `policy.rego` rules.
