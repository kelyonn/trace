#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root_dir"

if [[ -f .env ]]; then
  set -a
  # shellcheck source=/dev/null
  source .env
  set +a
  echo "Loaded .env"
fi

# Docker is optional: without it Trace runs on its built-in sources
# (embedded Postgres demo, SQLite sample, file uploads) and any database you connect.
if [[ "${USE_DOCKER:-auto}" != "false" ]] && command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  echo "Starting Docker infrastructure (Postgres, Trino, Keycloak, OPA)..."
  docker compose up -d
  if [[ "${SEED_LARGE:-false}" == "true" ]]; then
    echo "Loading the large demo dataset into the Docker Postgres (several minutes)..."
    "$root_dir/infra/scripts/seed-postgres.sh" || echo "WARNING: seed failed; run ./infra/scripts/seed-postgres.sh later."
  fi
else
  echo "Docker not available (or USE_DOCKER=false): using built-in sources only."
fi

if [[ ! -d node_modules ]]; then
  echo "Installing dependencies..."
  npm install
fi

echo "Starting API and Web apps..."
npm run dev:api &
API_PID=$!
npm run dev:web &
WEB_PID=$!

echo "API: http://localhost:3000"
echo "Web: http://localhost:5173"
echo "Sources: http://localhost:5173/#/settings  (connect Postgres, MySQL, SQLite, Trino or upload CSV/JSON)"

# Wait so the script keeps PIDs alive in subshell usage;
# trap handles Ctrl-C cleanly.
trap "kill $API_PID $WEB_PID 2>/dev/null || true" EXIT INT TERM
wait $API_PID $WEB_PID
