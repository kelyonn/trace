# Connector service

Owns the per-source adapter layer. Each adapter implements a common interface so the query orchestrator can swap sources without knowing the underlying driver.

## Adapter interface (planned)

```typescript
interface ConnectorAdapter {
  /** Test connectivity and return source metadata. */
  ping(): Promise<{ ok: boolean; version?: string }>;

  /** Return all tables accessible to the configured credentials. */
  listTables(schema?: string): Promise<string[]>;

  /** Return column metadata for a given table. */
  describeTable(table: string): Promise<Column[]>;

  /** Execute SQL and return paginated results. */
  query(sql: string, options?: QueryOptions): Promise<QueryResult>;
}
```

## Supported sources (MVP)

| Source | Status | Driver |
|--------|--------|--------|
| Postgres | Done (via Trino) | Trino postgresql connector |
| Snowflake | Planned | Trino snowflake connector |
| BigQuery | Planned | Trino bigquery connector |
| SQL Server | Planned | Trino sqlserver connector |

## Adding a new connector

1. Create `src/adapters/<name>.ts` implementing `ConnectorAdapter`.
2. Register the adapter in `src/registry.ts`.
3. Add a Trino catalog config in `services/query-engine/trino/catalog/<name>.properties`.
4. Add unit tests in `src/__tests__/<name>.test.ts`.
5. Update `docs/MVP_STATUS.md`.
