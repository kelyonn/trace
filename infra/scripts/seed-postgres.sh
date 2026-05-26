#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/../.." && pwd)"
seed_file="$root_dir/infra/docker/postgres/seed-large.sql"

cd "$root_dir"

if [[ ! -f "$seed_file" ]]; then
  echo "Missing seed file: $seed_file" >&2
  exit 1
fi

echo "Waiting for Postgres..."
for i in $(seq 1 60); do
  if docker compose exec -T postgres pg_isready -U trace -d trace >/dev/null 2>&1; then
    break
  fi
  if [[ "$i" -eq 60 ]]; then
    echo "Postgres did not become ready in time. Is Docker running? Try: docker compose up -d" >&2
    exit 1
  fi
  sleep 1
done

echo "Seeding large demo dataset (this may take a few minutes)..."
docker compose exec -T postgres psql -U trace -d trace -v ON_ERROR_STOP=1 < "$seed_file"
echo "Done."
