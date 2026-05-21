#!/usr/bin/env bash
set -euo pipefail

echo "Stopping API and Web dev servers..."
pkill -f "npm run dev:api" || true
pkill -f "npm run dev:web" || true

# Best-effort stop for Vite/tsx when spawned by npm
pkill -f "vite" || true
pkill -f "tsx" || true

echo "Stopping local infrastructure..."
docker compose down

printf "Stopped.\n"
