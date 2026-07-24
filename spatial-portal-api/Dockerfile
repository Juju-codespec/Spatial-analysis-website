FROM rocker/r-ver:4.4

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
        curl \
        libcurl4-openssl-dev \
        libssl-dev \
        libxml2-dev \
        libsodium-dev \
        libgit2-dev \
        zlib1g-dev \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# CRAN packages: keep this single layer for cache efficiency.
RUN R -q -e "install.packages(c( \
        'plumber', 'spatstat.geom', 'spatstat.explore', 'spatstat.random', \
        'survival', 'sandwich', 'dplyr', 'data.table', 'jsonlite', 'future', 'promises', \
        'uuid', 'vroom', 'logger', 'ggplot2', 'aod', 'glmmTMB', \
        'BiocManager', 'testthat', 'httr', 'callr' \
    ), repos = 'https://cloud.r-project.org')"

# Bioconductor packages for the VPD demo cohorts. ExperimentHub will lazily
# fetch the actual data the first time `VectraPolarisData()` is called.
RUN R -q -e "BiocManager::install(c( \
        'SpatialExperiment', 'SummarizedExperiment', 'S4Vectors', \
        'MultiAssayExperiment', 'VectraPolarisData' \
    ), update = FALSE, ask = FALSE)"

WORKDIR /app

COPY R/ /app/R/
COPY DESCRIPTION NAMESPACE /app/
COPY tests/ /app/tests/

RUN mkdir -p /app/data-cache

ENV HOST=0.0.0.0
ENV PORT=8000
ENV CORS_ORIGIN=http://localhost:5173
ENV DATA_CACHE=/app/data-cache
ENV ENABLE_VPD=true
ENV FUTURE_PLAN=multisession
ENV PROJECT_ROOT=/app

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT}/health" || exit 1

CMD ["Rscript", "/app/R/main.R"]
