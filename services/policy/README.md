# Policy service

Contains Open Policy Agent (OPA) Rego policies for query, export, and column-level access control.

## Files

| File | Purpose |
|------|---------|
| `policy.rego` | Main policy bundle (`trace` package) |
| `policy_test.rego` | Rego unit tests |

## Policy rules

### `trace.allow_query`

Returns `true` when a query is permitted. Blocks:
- Write statements (`INSERT`, `UPDATE`, `DELETE`, `DROP`, `CREATE`, `ALTER`, `TRUNCATE`, `MERGE`).
- Multi-statement batches (`;` inside the body).
- Any request where `input.role` is not defined.

### `trace.mask_columns`

Returns a set of column names to redact for the given role. Non-admin users have PII columns (`name`, `ssn`, `email`) replaced with `"***"`.

### `trace.allow_export`

Returns `true` only when `input.role == "admin"`.

## Running OPA locally

OPA is included in `infra/docker/docker-compose.yml`:

```bash
docker compose up -d opa
```

Test policies:
```bash
docker exec trace-opa opa test /policies -v
```

## Integration

Set these env vars in the API to enable OPA:

```
OPA_ENABLED=true
OPA_URL=http://localhost:8181
```

When `OPA_ENABLED=false` (default for local dev), the API uses a built-in lightweight policy check in `apps/api/src/lib/policy.ts`.
