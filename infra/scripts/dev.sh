#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/../.." && pwd)"

cd "$root_dir"

echo "Starting local infrastructure..."
docker compose up -d

echo "Starting API and Web apps..."
(npm run dev:api &) >/dev/null 2>&1
(npm run dev:web &) >/dev/null 2>&1

echo "API: http://localhost:3000"
echo "Web: http://localhost:5173"
