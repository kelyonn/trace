#!/usr/bin/env bash
set -euo pipefail

api_base="http://localhost:3000/api/v1"

check() {
  local name="$1"; shift
  if "$@" >/dev/null; then echo "ok   $name"; else echo "FAIL $name"; exit 1; fi
}

check "status"    curl -sf "$api_base/status"
check "sources"   curl -sf "$api_base/data-sources"
check "schema"    curl -sf "$api_base/schema"
check "model"     curl -sf "$api_base/model"
check "query"     curl -sf -X POST "$api_base/query" -H "Content-Type: application/json" -d '{"sql":"SELECT 1"}'

printf "Sanity checks passed.\n"
