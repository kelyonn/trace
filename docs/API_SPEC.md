# Trace API Contracts (MVP)

## 1. Conventions
- Base URL: /api/v1
- Auth: Bearer token in Authorization header
- Content-Type: application/json
- Errors: {"error": {"code": "string", "message": "string", "details": {}}}
- Pagination: {"items": [], "page": 1, "pageSize": 50, "total": 0}

## 2. Auth
### POST /auth/init
Initiate OAuth/SAML flow for a data source.
Request:
{
  "dataSourceId": "string",
  "redirectUri": "string"
}
Response:
{
  "authUrl": "string"
}

### POST /auth/callback
Finalize auth and mint session token.
Request:
{
  "code": "string",
  "state": "string"
}
Response:
{
  "accessToken": "string",
  "expiresIn": 3600
}

## 3. Data Sources
### GET /data-sources
List configured sources.
Response:
{
  "items": [
    {
      "id": "string",
      "type": "postgres|snowflake|bigquery|sqlserver",
      "name": "string",
      "status": "connected|auth_required|error"
    }
  ]
}

### POST /data-sources/{id}/activate
Activate a data source for the session.
Response:
{
  "active": true
}

## 4. Schema
### GET /schema
Get current schema for the active source.
Response:
{
  "version": "string",
  "dimensions": [{"name": "string", "dataType": "string"}],
  "measures": [{"name": "string", "expression": "string", "aggregation": "string"}]
}

## 5. Query
### POST /queries
Submit a query.
Request:
{
  "queryText": "string",
  "format": "sql",
  "options": {"limit": 1000}
}
Response:
{
  "queryId": "string",
  "status": "running"
}

### GET /queries/{id}
Query status and metadata.
Response:
{
  "id": "string",
  "status": "running|completed|failed",
  "submittedAt": "string",
  "explainPlan": "string"
}

### GET /queries/{id}/results
Retrieve results (non-streaming).
Response:
{
  "columns": [{"name": "string", "type": "string"}],
  "rows": [["any"]],
  "nextPageToken": "string"
}

## 6. Result Streaming
### GET /queries/{id}/stream
Streaming results via WebSocket or SSE (server decides).
Message:
{
  "type": "data|progress|complete|error",
  "payload": {}
}

## 7. Query History
### GET /history
List user query history.
Response:
{
  "items": [
    {
      "id": "string",
      "queryText": "string",
      "submittedAt": "string",
      "status": "completed|failed"
    }
  ]
}

## 8. Audit
### GET /audit
List audit events.
Response:
{
  "items": [
    {
      "id": "string",
      "action": "query|export|schema",
      "dataSourceId": "string",
      "timestamp": "string"
    }
  ]
}

## 9. Export
### POST /exports
Create an export job from a query.
Request:
{
  "queryId": "string",
  "format": "csv|parquet"
}
Response:
{
  "exportId": "string",
  "status": "queued"
}

### GET /exports/{id}
Export job status and download link.
Response:
{
  "id": "string",
  "status": "queued|processing|ready|failed",
  "downloadUrl": "string"
}
