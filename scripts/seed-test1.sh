#!/usr/bin/env bash
# Upload the bundled Test 1 ovarian TMA dataset to a running local API.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API_URL="${VITE_API_URL:-http://127.0.0.1:8000}"
DATA_DIR="$ROOT/spatial-portal-api/test-data/test1-ovarian-tma"
CELLS="$DATA_DIR/cells.csv"
SURV="$DATA_DIR/survival.csv"

if [[ ! -f "$CELLS" ]]; then
  echo "ERROR: $CELLS not found."
  echo "Run: cd spatial-portal-api && Rscript scripts/export_test1_rdata.R"
  exit 1
fi

if ! curl -sf "${API_URL}/health" >/dev/null 2>&1; then
  echo "ERROR: API not reachable at ${API_URL}"
  echo "Start it with: npm run dev   (or npm run api)"
  exit 1
fi

echo "Uploading Test 1 dataset to ${API_URL}..."
RESP=$(curl -sf -X POST "${API_URL}/datasets" \
  -F "title=Test 1 Ovarian TMA (local)" \
  -F "cancer_type=Ovarian" \
  -F "tissue=TMA" \
  -F "cells=@${CELLS};type=text/csv" \
  -F "survival=@${SURV};type=text/csv")

ID=$(node -e 'process.stdin.on("data",d=>{const j=JSON.parse(d); console.log(j.id)})' <<<"$RESP")

echo "Uploaded dataset id: $ID"
echo "Open in browser: http://localhost:5173/dataset/${ID}"
echo
echo "On that page:"
echo "  · Spatial Stats tab — Ripley's K / NN G plots"
echo "  · Survival tab — Cox PH (Ripley's K at r=50, CD8+ T Cell)"
