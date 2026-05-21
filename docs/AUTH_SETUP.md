# Auth Setup

Trace supports two authentication modes:

1. **Local dev (default)** — no auth required. Optionally set an API key via `API_KEY` + `AUTH_REQUIRED=true`.
2. **Keycloak OAuth (production)** — PKCE authorization code flow for the web app; JWT verification on the API.

---

## Local dev (no auth)

Leave `AUTH_REQUIRED=false` (the default). The UI still lets you set a manual role (`user` / `admin`) and API key for testing.

---

## Keycloak setup

### 1. Start Keycloak

```bash
docker compose up -d keycloak
```

The `trace` realm is auto-imported from `services/auth/realm-trace.json` on first boot.

### 2. Verify the realm imported

Open http://localhost:8081 and sign in as `admin / admin`. You should see the **trace** realm in the left sidebar.

### 3. Test users

| User | Password | Role |
|------|----------|------|
| `admin@trace.local` | `admin` | admin |
| `analyst@trace.local` | `analyst` | analyst |

### 4. Enable JWT verification on the API

Add to your `.env`:

```
AUTH_REQUIRED=true
KEYCLOAK_URL=http://localhost:8081
KEYCLOAK_REALM=trace
KEYCLOAK_CLIENT_ID=trace-api
```

The API verifies Bearer JWTs using Keycloak's JWKS endpoint, with a 10-minute local cache. The `realm_access.roles` claim maps to the internal role: `admin` → full access, `analyst` → user-level access.

### 5. Sign in from the web UI

Open http://localhost:5173. In the **Access** panel, click **Sign in with Keycloak**. This starts the PKCE flow against `http://localhost:8081/realms/trace`. After sign-in, the web app holds the access token in memory and attaches it to every API call.

### 6. Token refresh

The `useAuth` hook schedules an automatic refresh 30 seconds before the access token expires (default: 1 hour). No page reload needed.

---

## Extending auth

- **Add a social provider** — configure it in the Keycloak admin UI (`Identity Providers`), then export a new `realm-trace.json`.
- **Add a group-based policy** — add groups to the realm, assign roles, and update `services/policy/policy.rego`.
- **Production deployment** — set `KEYCLOAK_URL` to your production Keycloak instance and update the `trace-web` client's redirect URIs via the admin console.
