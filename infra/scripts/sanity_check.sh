#!/usr/bin/env bash
set -euo pipefail

api_base="http://localhost:3000/api/v1"

curl -s "$api_base/status" | sed -e 's/"/"/g' >/dev/null
curl -s "$api_base/schema" >/dev/null
curl -s -X POST "$api_base/query" \
  -H "Content-Type: application/json" \
  -d '{"sql":"SELECT 1"}' >/dev/null

printf "Sanity checks passed.\n"
