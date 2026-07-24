# Runtime configuration for the spatial-portal-api service.
#
# Values come from environment variables so the same image can be deployed
# in dev / staging / prod without rebuilding. `cfg()` returns a single
# named list; call it without arguments to inspect the resolved config.

.cfg_cache <- new.env(parent = emptyenv())

cfg <- function() {
  if (is.null(.cfg_cache$values)) {
    .cfg_cache$values <- list(
      host          = Sys.getenv("HOST", "0.0.0.0"),
      port          = as.integer(Sys.getenv("PORT", "8000")),
      cors_origin   = Sys.getenv(
        "CORS_ORIGIN",
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174"
      ),
      api_key       = Sys.getenv("API_KEY", ""),
      data_cache    = Sys.getenv("DATA_CACHE",
                                 file.path(here_root(), "data-cache")),
      max_cells_per_sample = as.integer(
        Sys.getenv("MAX_CELLS_PER_SAMPLE", "30000")
      ),
      cells_response_cap   = as.integer(
        Sys.getenv("CELLS_RESPONSE_CAP", "50000")
      ),
      default_nsim = as.integer(Sys.getenv("DEFAULT_NSIM", "49")),
      async_cells_threshold = as.integer(
        Sys.getenv("ASYNC_CELLS_THRESHOLD", "50000")
      ),
      max_samples_analysis = as.integer(
        Sys.getenv("MAX_SAMPLES_ANALYSIS", "500")
      ),
      min_cells_per_sample = as.integer(
        Sys.getenv("MIN_CELLS_PER_SAMPLE", "10")
      ),
      enable_vpd    = tolower(Sys.getenv("ENABLE_VPD", "true")) %in%
        c("1", "true", "yes"),
      # Optional CSV (sample_id + race) merged into vpd-ovarian clinical metadata.
      vpd_ovarian_race_csv = Sys.getenv("VPD_OVARIAN_RACE_CSV", ""),
      version       = "0.1.0"
    )
  }
  .cfg_cache$values
}

# Resolve the project root regardless of where `Rscript` was invoked from.
here_root <- function() {
  # `main.R` sets PROJECT_ROOT; fall back to the current wd otherwise.
  env_root <- Sys.getenv("PROJECT_ROOT", "")
  if (nzchar(env_root)) return(env_root)
  getwd()
}

cfg_reset <- function() {
  rm(list = ls(.cfg_cache), envir = .cfg_cache)
  invisible(NULL)
}
