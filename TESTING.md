# Testing

## One-command startup
- `bash infra/scripts/dev.sh`

## Smoke test
- `bash infra/scripts/sanity_check.sh`

## Expected results
- API health: `GET /api/v1/status` returns Trino and Postgres online.
- Schema: `GET /api/v1/schema` returns tables `customers` and `orders`.
- Query: `POST /api/v1/query` returns rows and columns.
- UI: query runner renders results and 3-D preview panel loads.
