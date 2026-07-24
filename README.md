# Spatial Analysis Website

Local dev workspace for **spatial-portal** (React + Vite frontend) and **spatial-portal-api** (R/Plumber backend): spatial maps and Ripley's K / NN G (Spatial Stats tab), plus a **Clinical Analysis** tab that merges user-uploaded clinical metadata with image-derived cell features.

Clinical Analysis accepts user-uploaded clinical metadata and merges it with image-derived cell features. The bundled Vectra Polaris ovarian dataset serves as an imaging example, while survival outcomes, stage, grade, treatment, and recurrence data are provided through user-uploaded clinical CSV files.

## Quick start

From the repo root:

```bash
npm run install:local   # frontend npm install + R CRAN deps
npm run dev             # API :8000 + frontend :5173 (Ctrl+C stops both)
```

Open **http://localhost:5173** in your browser.

**Deploy for friends (public URL):** see [DEPLOY.md](DEPLOY.md) (Render + static frontend).

Optional — load the bundled ovarian TMA test cohort (with another terminal, while `npm run dev` is running):

```bash
npm run seed:test1
```

Then open the printed dataset URL. Use **Spatial Map** / **Spatial Stats** for imaging; attach a clinical CSV on **Survival** or **Clinical Analysis**; use **Survival** for spatial clustering vs Cox PH, and **Clinical Analysis** for cell-feature models.

### Run services separately

```bash
npm run api    # R API only → http://127.0.0.1:8000
npm run web    # Vite only   → http://localhost:5173
```

Health check:

```bash
curl -s http://127.0.0.1:8000/health
```

Swagger API docs: http://127.0.0.1:8000/__docs__/

## Structure

| Path | Description |
|------|-------------|
| `spatial-portal/` | React frontend (`VITE_API_URL` in `.env.development`) |
| `spatial-portal-api/` | R Plumber API |
| `scripts/` | `install-local.sh`, `dev.sh`, `seed-test1.sh` |

## Requirements

- **Node.js 18+** — system install, or the bundled binary under `node-bin/` (used automatically when present)
- **R 4.2+** with CRAN packages from `spatial-portal-api/scripts/install_deps.R` (`plumber`, `spatstat.*`, `survival`, `sandwich`, …)

If the frontend cannot reach the API, confirm `curl http://127.0.0.1:8000/health` works and that `spatial-portal/.env.development` has `VITE_API_URL=http://localhost:8000`.
