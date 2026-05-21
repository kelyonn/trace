# Testing

## Unit tests

```bash
npm test                    # runs API + web tests
npm -w apps/api run test    # API only (28 tests)
npm -w apps/web run test    # Web only (6 pivot tests)
```

### What is covered

| Suite | Tests |
|-------|-------|
| `policy.test.ts` | `isSafeQuery` — SELECT allowed, writes/DDL/multi-stmt blocked |
| `cache.test.ts` | LRU cache set/get, TTL expiry, key isolation by role |
| `auth.test.ts` | Role extraction, column masking by role |
| `routes.test.ts` | Query happy path, 400 on missing sql, 403 on write stmt, export admin gate, assistant summary |
| `pivot.test.ts` | `pivotRows` shape, value placement, min/max, null inputs |

## Smoke test (requires running stack)

```bash
bash infra/scripts/sanity_check.sh
```

Checks:
- `GET /api/v1/status` returns 200
- `GET /api/v1/schema` returns tables list
- `POST /api/v1/query` returns rows

## Manual test checklist

- [ ] Start stack: `./run.sh`
- [ ] API health: `curl http://localhost:3000/health`
- [ ] API status: `curl http://localhost:3000/api/v1/status` (Trino + Postgres online)
- [ ] Schema: `curl http://localhost:3000/api/v1/schema` (lists customers, orders)
- [ ] Semantic model: `curl http://localhost:3000/api/v1/semantic`
- [ ] Run a query in the UI; results appear in the table
- [ ] Switch to Cube view with a 3-column query; 3-D bars render and rotate
- [ ] Click a bar to drill; SQL updates in the query runner
- [ ] Click Stream; rows appear incrementally in the Stream results panel
- [ ] Export CSV as admin; file downloads
- [ ] Save a snapshot; reopen it
- [ ] Create an alert; evaluate it
- [ ] Sign in with Keycloak (if running); role reflects in header

## OPA policy tests (requires OPA container)

```bash
docker compose up -d opa
docker exec $(docker ps -qf name=opa) opa test /policies -v
```

## Expected results

- API health: `GET /api/v1/status` returns Trino and Postgres online.
- Schema: `GET /api/v1/schema` returns `customers` and `orders`.
- Query: `POST /api/v1/query` returns rows and columns.
- Streaming: `POST /api/v1/queries` + `GET /api/v1/queries/:id/stream` delivers SSE events.
- Cube: 3-D bars render for `SELECT status, region, SUM(amount) FROM orders JOIN customers … GROUP BY 1, 2`.
- 2-D fallback: activates when FPS < 20 for 2+ seconds.
