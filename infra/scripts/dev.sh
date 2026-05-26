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

echo "Starting local infrastructure..."
docker compose up -d

if [[ "${SEED_LARGE:-true}" == "true" ]]; then
  echo "Loading large demo dataset into Postgres (several minutes)..."
  if ! "$root_dir/infra/scripts/seed-postgres.sh"; then
    echo ""
    echo "ERROR: Demo seed failed. The UI will be empty until you run:"
    echo "  ./infra/scripts/seed-postgres.sh"
    echo ""
  fi
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
echo "Keycloak: http://localhost:8081"

# Wait so the script keeps PIDs alive in subshell usage;
# trap handles Ctrl-C cleanly.
trap "kill $API_PID $WEB_PID 2>/dev/null || true" EXIT INT TERM
wait $API_PID $WEB_PID
