#!/usr/bin/env bash
set -euo pipefail

chmod +x infra/scripts/dev.sh infra/scripts/sanity_check.sh

echo "Starting local infrastructure..."
docker compose up -d

if [[ ! -d node_modules ]]; then
	echo "Installing dependencies..."
	npm install
fi

echo "Starting API and Web apps..."
(npm run dev:api &) >/dev/null 2>&1
(npm run dev:web &) >/dev/null 2>&1

echo "API: http://localhost:3000"
echo "Web: http://localhost:5173"
