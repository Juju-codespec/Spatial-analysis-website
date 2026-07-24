#!/usr/bin/env bash
# First-time local setup for spatial-portal + spatial-portal-api.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN="$ROOT/node-bin/node-v22.13.1-darwin-arm64/bin"
if [[ -x "$NODE_BIN/node" ]]; then
  export PATH="$NODE_BIN:$PATH"
fi

echo "==> Spatial Portal — local install"
echo "    Root: $ROOT"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node not found."
  echo "  Install Node 18+ from https://nodejs.org/ or extract the bundled binary under:"
  echo "  $NODE_BIN"
  exit 1
fi
echo "Node $(node -v) · npm $(npm -v)"

if ! command -v Rscript >/dev/null 2>&1; then
  echo "ERROR: Rscript not found. Install R 4.2+ from https://cran.r-project.org/"
  exit 1
fi
echo "R $(Rscript -e 'cat(as.character(getRversion()))' 2>/dev/null)"

echo
echo "==> Installing frontend dependencies (spatial-portal/)"
cd "$ROOT/spatial-portal"
npm install

echo
echo "==> Installing R API dependencies (spatial-portal-api/)"
Rscript "$ROOT/spatial-portal-api/scripts/install_deps.R"

echo
echo "==> Done."
echo
echo "Start both services:"
echo "  cd \"$ROOT\" && npm run dev"
echo
echo "Or separately:"
echo "  npm run api   # R backend on http://localhost:8000"
echo "  npm run web   # Vite frontend on http://localhost:5173"
echo
echo "Optional — seed the Test 1 ovarian TMA dataset (after API is running):"
echo "  npm run seed:test1"
