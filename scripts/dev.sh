#!/usr/bin/env bash
# Run spatial-portal-api + spatial-portal frontend together for local dev.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN="$ROOT/node-bin/node-v22.13.1-darwin-arm64/bin"
export PATH="$NODE_BIN:${PATH:-/usr/bin:/bin:/usr/sbin:/sbin}"

API_PORT="${PORT:-8000}"
WEB_PORT="${VITE_PORT:-5173}"
API_URL="http://127.0.0.1:${API_PORT}"
WEB_URL="http://localhost:${WEB_PORT}"

cleanup() {
  echo
  echo "Stopping local servers..."
  [[ -n "${API_PID:-}" ]] && kill "$API_PID" 2>/dev/null || true
  [[ -n "${WEB_PID:-}" ]] && kill "$WEB_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "ERROR: '$1' not found. Run ./scripts/install-local.sh first."
    exit 1
  fi
}

require_cmd node
require_cmd npm
require_cmd Rscript

if [[ ! -d "$ROOT/spatial-portal/node_modules" ]]; then
  echo "Frontend node_modules missing — running install-local.sh..."
  "$ROOT/scripts/install-local.sh"
fi

wait_for_api() {
  local tries="${1:-40}"
  for ((i = 1; i <= tries; i++)); do
    if curl -sf "${API_URL}/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

echo "==> Starting R API on ${API_URL}"
cd "$ROOT/spatial-portal-api"
export PORT="$API_PORT"
export HOST="127.0.0.1"
export CORS_ORIGIN="http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173"
export ENABLE_VPD="${ENABLE_VPD:-false}"
Rscript R/main.R &
API_PID=$!

if ! wait_for_api 60; then
  echo "ERROR: API did not become ready at ${API_URL}/health"
  exit 1
fi
echo "    API ready · Swagger docs at ${API_URL}/__docs__/"

echo "==> Starting Vite frontend on ${WEB_URL}"
cd "$ROOT/spatial-portal"
npm run dev -- --host 127.0.0.1 --port "$WEB_PORT" &
WEB_PID=$!

echo
echo "========================================"
echo " Spatial Portal — local dev"
echo "----------------------------------------"
echo " Frontend:  ${WEB_URL}"
echo " API:       ${API_URL}"
echo " Test data: spatial-portal-api/test-data/test1-ovarian-tma/"
echo "----------------------------------------"
echo " Press Ctrl+C to stop both servers."
echo " Seed test dataset: npm run seed:test1"
echo "========================================"
echo

wait "$WEB_PID"
