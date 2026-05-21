package trace

import rego.v1

# ---------------------------------------------------------------------------
# allow_query
# Allow a SQL query only when it is a read-only SELECT statement.
# Blocks writes (INSERT/UPDATE/DELETE), DDL (CREATE/DROP/ALTER/TRUNCATE),
# and multi-statement batches.
# ---------------------------------------------------------------------------

allow_query if {
    input.action == "query"
    not is_write_statement
    not is_multi_statement
}

is_write_statement if {
    pattern := `(?i)^\s*(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|REPLACE|MERGE)\b`
    regex.match(pattern, input.sql)
}

is_multi_statement if {
    # Strip trailing semicolon then look for another semicolon
    stripped := trim_suffix(input.sql, ";")
    contains(stripped, ";")
}

# ---------------------------------------------------------------------------
# mask_columns
# Returns the set of column names to redact for the requesting role.
# ---------------------------------------------------------------------------

pii_columns := {"name", "ssn", "email", "phone", "address"}

mask_columns contains col if {
    input.role != "admin"
    col := pii_columns[_]
}

# ---------------------------------------------------------------------------
# allow_export
# Only admins may trigger CSV exports.
# ---------------------------------------------------------------------------

allow_export if {
    input.action == "export"
    input.role == "admin"
}

# ---------------------------------------------------------------------------
# allow
# Top-level composite rule — used by the API at POST /v1/data/trace/allow.
# ---------------------------------------------------------------------------

allow if {
    input.action == "query"
    allow_query
}

allow if {
    input.action == "export"
    allow_export
}

allow if {
    input.action in {"schema", "explain", "activate_source"}
}
