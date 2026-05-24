# spatial-portal-api

R backend service for the Spatial Portal web application. Ingests
Vectra Polaris / VPD-style tumor imaging data, computes spatial
statistics for T-cell populations, and links them to survival outcomes
via Cox proportional hazards models.

```
+----------------+      REST + CORS      +-------------------------+
|  spatial-portal| --------------------> |  spatial-portal-api     |
|  (React/Vite)  |                       |  plumber on :8000       |
+----------------+                       |                         |
                                         |  spatstat (Kest, Gest)  |
                                         |  survival (coxph, KM)   |
                                         |  VectraPolarisData      |
                                         +-------------------------+
```

## Endpoints

| Method | Path                              | Description                                                 |
| ------ | --------------------------------- | ----------------------------------------------------------- |
| GET    | `/health`                         | Liveness probe                                              |
| GET    | `/datasets`                       | List bundled VPD demos + user uploads                       |
| GET    | `/datasets/:id`                   | Metadata, sample list, cell-type counts, survival columns   |
| GET    | `/datasets/:id/cells`             | Downsampled cells for plotting                              |
| POST   | `/datasets`                       | Multipart upload (`cells.csv`, optional `survival.csv`)     |
| POST   | `/analyze/ripleys-k`              | Per-sample Ripley K (`Kest` / `Kcross`); optionally async   |
| POST   | `/analyze/nn-g`                   | Per-sample Nearest-Neighbour G (`Gest` / `Gcross`)          |
| POST   | `/analyze/cox`                    | Cox PH using a per-sample K/G summary at a chosen radius    |
| GET    | `/jobs/:id`                       | Status of an async analysis job                             |

Interactive docs are mounted by plumber at `/__docs__/`.

### Cox summary statistic

Each sample's K or G curve is reduced to one scalar before regression:

- **K**: `L(r0) − r0` (Besag's L deviation from CSR; positive = clustering).
- **G**: `G(r0) − G_csr(r0)` (excess nearest-neighbour density).

The scalar enters `survival::coxph(Surv(time, status) ~ stat + covariates)`.
With `dichotomize = "median"` (default), samples are also split into
high/low groups and Kaplan-Meier points are returned for plotting.

## Data inputs

### Bundled cohorts (`source: vpd`)

Two `SpatialExperiment` objects from the
[`VectraPolarisData`](https://bioconductor.org/packages/VectraPolarisData/)
Bioconductor package are exposed as lazy datasets:

- `vpd-lung` — `HumanLungCancerV3` (non-small-cell lung cancer)
- `vpd-ovarian` — `HumanOvarianCancerVP` (ovarian cancer)

They are fetched from ExperimentHub on first request and then cached as
RDS under `data-cache/`.

### User uploads (`source: upload`)

`POST /datasets` accepts multipart form data:

- `cells` (required): CSV/TSV with `x`, `y` columns and either
  `phenotype_*` boolean columns (e.g. `phenotype_cd3`, `phenotype_cd8`)
  in the Vectra Polaris layout, or a single `cell_type` column.
- `survival` (optional): CSV/TSV with `sample_id`, `time`, `status`,
  plus any covariate columns to use in the Cox model.

## Quick start

```bash
# 1. Install the (CRAN) deps.
Rscript -e 'install.packages(c("plumber","spatstat.geom","spatstat.explore","spatstat.random","survival","dplyr","data.table","jsonlite","future","promises","uuid","vroom","logger","testthat","httr","callr","BiocManager"))'

# 2. Optional — install the VPD demo data package (large; ~2 GB on first hub fetch).
Rscript -e 'BiocManager::install(c("SpatialExperiment","SummarizedExperiment","S4Vectors","MultiAssayExperiment","VectraPolarisData"))'

# 3. Run the test suite.
Rscript tests/testthat.R

# 4. Start the API.
Rscript R/main.R
# Listening on http://0.0.0.0:8000 — Swagger docs at /__docs__/
```

Sanity check from a second shell:

```bash
curl -s http://localhost:8000/health
# {"status":"ok","version":"0.1.0","time":"..."}
```

## Configuration

All knobs are environment variables; see `R/config.R`.

| Variable                | Default                  | Purpose                                              |
| ----------------------- | ------------------------ | ---------------------------------------------------- |
| `HOST`                  | `0.0.0.0`                | Bind address                                         |
| `PORT`                  | `8000`                   | Listening port                                       |
| `CORS_ORIGIN`           | `http://localhost:5173`  | Allow-listed origin(s), comma separated, or `*`      |
| `API_KEY`               | _empty_                  | Optional; clients send `X-API-Key: <value>`          |
| `DATA_CACHE`            | `./data-cache`           | RDS cache root                                       |
| `MAX_CELLS_PER_SAMPLE`  | `30000`                  | Per-sample cap before downsampling for K/G          |
| `CELLS_RESPONSE_CAP`    | `50000`                  | Hard cap on `/datasets/:id/cells` payload size       |
| `ENABLE_VPD`            | `true`                   | Set to `false` to hide the lazy VPD demos            |
| `FUTURE_PLAN`           | `multisession`           | Or `sequential` for single-threaded tests/dev        |
| `FUTURE_WORKERS`        | `cores - 1`              | Number of `future` workers                           |

## Docker

```bash
docker build -t spatial-portal-api .
docker run -p 8000:8000 --rm \
  -e CORS_ORIGIN=http://localhost:5173 \
  -v $(pwd)/data-cache:/app/data-cache \
  spatial-portal-api
```

The image installs `VectraPolarisData` from Bioconductor at build time.
The dataset blobs themselves are pulled by ExperimentHub the first time
`/datasets/vpd-lung` (or `vpd-ovarian`) is hit; mounting `data-cache/`
into the container persists the RDS caches across restarts.

## Project layout

```
spatial-portal-api/
├── DESCRIPTION
├── Dockerfile
├── NAMESPACE
├── README.md
├── R/
│   ├── cells.R          # VPD loader + CSV parser + phenotype harmonization
│   ├── config.R         # Env-driven runtime config
│   ├── cors.R           # CORS + optional API-key filter
│   ├── jobs.R           # future-backed async job registry
│   ├── main.R           # Entry point (Rscript R/main.R)
│   ├── plumber.R        # Endpoint declarations
│   ├── spatial.R        # Ripley K, NN G, scalar summary at radius
│   ├── storage.R        # RDS cache helpers
│   └── survival.R       # cox_from_stat + Kaplan-Meier points
├── data-cache/          # gitignored; per-dataset RDS files
└── tests/
    ├── testthat.R
    └── testthat/
        ├── helper-setup.R
        ├── test-cells.R
        ├── test-spatial.R
        ├── test-survival.R
        ├── test-storage.R
        └── test-plumber-smoke.R
```

## Roadmap / non-goals

- Multi-tenant auth (currently a single shared API key).
- Database-backed storage (currently file-based RDS).
- Envelope tests / Monte-Carlo CIs for K and G (sketched via `future`,
  not exposed as an endpoint yet).
- Cross-K cohort mean is currently per-sample only; envelopes for
  cross-K would extend `R/spatial.R::ripleys_k`.
