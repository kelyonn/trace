# @trace/shared-types

Shared TypeScript types consumed by `apps/api` and `apps/web`. Single source of truth for all API contracts.

## Usage

```typescript
import type { QueryRequest, QueryResponse, HistoryItem } from "@trace/shared-types";
```

## Exported types

| Type | Description |
|------|-------------|
| `Column` | `{ name: string; type: string }` |
| `QueryRequest` | `{ sql: string }` |
| `QueryResponse` | Query result with columns, rows, metadata |
| `HistoryItem` | A recorded query execution |
| `AuditEvent` | An immutable audit log entry |
| `AlertRule` | Alert definition and last evaluation state |
| `Snapshot` | Saved SQL with metadata |
| `Notebook` | Title + freeform content note |
| `DataSource` | Source configuration and status |
| `SemanticModel` | Parsed `semantic.yml` cube definition |

## Development

The package is a workspace-internal package (`"@trace/shared-types": "*"` in dependents). Changes here are picked up immediately — no publish step required.
