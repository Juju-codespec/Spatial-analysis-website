#!/usr/bin/env bash
# Start spatial-portal-api, freeing the listen port first so an old process
# cannot keep serving routes from an outdated plumber build.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN="$ROOT/node-bin/node-v22.13.1-darwin-arm64/bin"
if [[ -x "$NODE_BIN/node" ]]; then
  export PATH="$NODE_BIN:$PATH"
fi

API_PORT="${PORT:-8000}"

if command -v lsof >/dev/null 2>&1; then
  PIDS="$(lsof -ti ":${API_PORT}" 2>/dev/null || true)"
  if [[ -n "${PIDS}" ]]; then
    echo "==> Stopping existing listener(s) on port ${API_PORT}..."
    # shellcheck disable=SC2086
    kill -9 ${PIDS} 2>/dev/null || true
    sleep 0.5
  fi
fi

cd "$ROOT/spatial-portal-api"
export PORT="$API_PORT"
export ENABLE_VPD="${ENABLE_VPD:-true}"
export CORS_ORIGIN="${CORS_ORIGIN:-http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174}"
exec Rscript R/main.R
