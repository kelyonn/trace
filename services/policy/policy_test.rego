package trace_test

import rego.v1
import data.trace

# ---------------------------------------------------------------------------
# allow_query tests
# ---------------------------------------------------------------------------

test_allow_select if {
    trace.allow_query with input as {
        "action": "query",
        "role": "user",
        "sql": "SELECT * FROM orders"
    }
}

test_allow_select_semicolon if {
    trace.allow_query with input as {
        "action": "query",
        "role": "user",
        "sql": "SELECT 1;"
    }
}

test_block_insert if {
    not trace.allow_query with input as {
        "action": "query",
        "role": "admin",
        "sql": "INSERT INTO orders VALUES (1, 2, 3)"
    }
}

test_block_drop if {
    not trace.allow_query with input as {
        "action": "query",
        "role": "admin",
        "sql": "DROP TABLE orders"
    }
}

test_block_multi_statement if {
    not trace.allow_query with input as {
        "action": "query",
        "role": "user",
        "sql": "SELECT 1; DROP TABLE orders"
    }
}

test_block_update if {
    not trace.allow_query with input as {
        "action": "query",
        "role": "admin",
        "sql": "UPDATE orders SET status = 'shipped'"
    }
}

# ---------------------------------------------------------------------------
# mask_columns tests
# ---------------------------------------------------------------------------

test_mask_non_admin if {
    "name" in trace.mask_columns with input as {"role": "user"}
    "ssn" in trace.mask_columns with input as {"role": "user"}
}

test_no_mask_admin if {
    count(trace.mask_columns) == 0 with input as {"role": "admin"}
}

# ---------------------------------------------------------------------------
# allow_export tests
# ---------------------------------------------------------------------------

test_export_admin if {
    trace.allow_export with input as {"action": "export", "role": "admin"}
}

test_export_user_denied if {
    not trace.allow_export with input as {"action": "export", "role": "user"}
}

# ---------------------------------------------------------------------------
# top-level allow tests
# ---------------------------------------------------------------------------

test_allow_schema if {
    trace.allow with input as {"action": "schema", "role": "user"}
}

test_allow_explain if {
    trace.allow with input as {"action": "explain", "role": "user", "sql": "SELECT 1"}
}

test_deny_write_via_allow if {
    not trace.allow with input as {
        "action": "query",
        "role": "admin",
        "sql": "DELETE FROM orders"
    }
}
