# Spatial Analysis Website

Local dev workspace for **spatial-portal** (React + Vite frontend) and **spatial-portal-api** (R/Plumber backend) for spatial biology visualization, Ripley's K / NN G analysis, and Cox survival modeling.

## Quick start

```bash
./scripts/install-local.sh   # npm install + R deps
npm run dev                  # API on :8000, frontend on :5173
```

Optional: seed the Test 1 ovarian TMA dataset (API must be running):

```bash
npm run seed:test1
```

## Structure

| Path | Description |
|------|-------------|
| `spatial-portal/` | React frontend |
| `spatial-portal-api/` | R Plumber API |
| `scripts/` | Install, dev, and seed helpers |

API docs when running: http://127.0.0.1:8000/__docs__/

## Requirements

- Node.js 18+ (or use the bundled binary via `install-local.sh`)
- R 4.2+ with packages listed in `spatial-portal-api/scripts/install_deps.R`
# Spatial-analysis-website
# Spatial-analysis-website
