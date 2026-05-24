# Plumber router: REST endpoints for the spatial portal backend.
#
# Each endpoint is intentionally small; heavy work is delegated to functions
# in cells.R / spatial.R / survival.R / jobs.R.

#* @apiTitle Spatial Portal API
#* @apiDescription R backend that ingests Vectra Polaris / VPD-style data,
#*   computes Ripley's K and Nearest Neighbour G statistics for T cells,
#*   and links them to patient survival via Cox proportional hazards.

#* CORS preflight + headers
#* @filter cors
function(req, res) cors_filter(req, res)

#* Optional API key gate (no-op unless API_KEY env is set)
#* @filter auth
function(req, res) api_key_filter(req, res)

# ---- Health ----------------------------------------------------------------

#* Health probe.
#* @get /health
function() {
  list(status = "ok",
       version = cfg()$version,
       time = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC"))
}

# ---- Datasets --------------------------------------------------------------

#* List all known datasets (bundled + uploaded).
#* @get /datasets
function() {
  list_datasets()
}

#* Dataset metadata + cell-type counts + sample list.
#* @get /datasets/<id>
function(id, res) {
  if (!dataset_exists(id)) { res$status <- 404L; return(list(error = "not_found")) }
  ds <- load_dataset(id)
  list(
    meta        = ds$meta,
    samples     = ds$samples,
    cell_types  = cell_type_counts(ds$cells),
    has_survival = !is.null(ds$survival) && nrow(ds$survival) > 0L,
    survival_columns = if (!is.null(ds$survival)) names(ds$survival) else character()
  )
}

cell_type_counts <- function(cells) {
  if (is.null(cells) || nrow(cells) == 0L) return(list())
  tab <- table(cells$cell_type)
  out <- as.list(as.integer(tab))
  names(out) <- names(tab)
  out
}

#* Cells for a dataset (capped + downsampled for plotting).
#* @param id        Dataset id.
#* @param sample_id Optional restrict to one sample.
#* @param cell_type Optional comma-separated list of cell types.
#* @param downsample Optional integer cap on number of cells returned.
#* @get /datasets/<id>/cells
function(id, sample_id = NULL, cell_type = NULL, downsample = NULL, res) {
  if (!dataset_exists(id)) { res$status <- 404L; return(list(error = "not_found")) }
  ds <- load_dataset(id)
  cells <- ds$cells

  # Capture URL params into local names that do NOT shadow column names; this
  # keeps data.table's NSE from matching the column against itself.
  sid_filter <- sample_id
  ct_filter <- cell_type

  if (!is.null(sid_filter) && nzchar(sid_filter)) {
    cells <- cells[get("sample_id") == sid_filter]
  }
  if (!is.null(ct_filter) && nzchar(ct_filter)) {
    wanted <- trimws(strsplit(ct_filter, ",", fixed = TRUE)[[1]])
    cells <- cells[get("cell_type") %in% wanted]
  }

  cap <- cfg()$cells_response_cap
  ds_n <- if (!is.null(downsample)) as.integer(downsample) else cap
  if (!is.na(ds_n) && nrow(cells) > ds_n) {
    cells <- cells[sample(.N, ds_n)]
  }

  keep_cols <- intersect(c("sample_id", "x", "y", "cell_type"), names(cells))
  list(
    n_returned = nrow(cells),
    n_total = nrow(ds$cells),
    cells = as.data.frame(cells[, ..keep_cols])
  )
}

#* Upload a new dataset.
#* @param title:character Optional dataset title.
#* @param cancer_type:character Optional cancer type label.
#* @param tissue:character Optional tissue label.
#* @post /datasets
#* @parser multi
function(req, res, title = NULL, cancer_type = NA_character_,
         tissue = NA_character_) {
  files <- req$body
  cells_part <- find_part(files, c("cells", "cells.csv", "cells_csv", "file"))
  if (is.null(cells_part)) {
    res$status <- 400L
    return(list(error = "missing_cells", message = "cells CSV part required"))
  }

  cells_path <- write_part_to_tmp(cells_part, suffix = ".csv")
  cells <- tryCatch(parse_cells_csv(cells_path), error = function(e) e)
  if (inherits(cells, "error")) {
    res$status <- 400L
    return(list(error = "parse_cells", message = conditionMessage(cells)))
  }

  surv_df <- NULL
  surv_part <- find_part(files, c("survival", "survival.csv"))
  if (!is.null(surv_part)) {
    surv_path <- write_part_to_tmp(surv_part, suffix = ".csv")
    surv_df <- tryCatch(parse_survival_csv(surv_path), error = function(e) e)
    if (inherits(surv_df, "error")) {
      res$status <- 400L
      return(list(error = "parse_survival", message = conditionMessage(surv_df)))
    }
  }

  ds_id <- paste0("upload-", substr(uuid::UUIDgenerate(), 1L, 8L))
  ds <- build_uploaded_dataset(
    id = ds_id,
    title = title %||% sprintf("Upload %s", format(Sys.time(), "%Y-%m-%d %H:%M")),
    cells = cells,
    survival = surv_df,
    cancer_type = cancer_type %||% NA_character_,
    tissue = tissue %||% NA_character_
  )
  save_dataset(ds)
  list(id = ds_id, meta = ds$meta, message = "Dataset uploaded")
}

#* Delete a user-uploaded dataset.
#*
#* Refuses to delete the bundled VPD demo datasets. Returns 404 if the
#* dataset does not exist.
#* @delete /datasets/<id>
function(id, res) {
  if (id %in% c("vpd-lung", "vpd-ovarian")) {
    res$status <- 403L
    return(list(error = "forbidden",
                message = "Bundled demo datasets cannot be deleted."))
  }
  if (!dataset_exists(id)) {
    res$status <- 404L
    return(list(error = "not_found"))
  }
  ok <- tryCatch(delete_dataset(id), error = function(e) e)
  if (inherits(ok, "error")) {
    res$status <- 500L
    return(list(error = "delete_failed", message = conditionMessage(ok)))
  }
  list(id = id, deleted = isTRUE(ok), message = "Dataset deleted")
}

#* Attach (or replace) the survival CSV for an existing dataset.
#*
#* Accepts a multipart form upload with a `survival` part (CSV/TSV). The
#* CSV must include sample_id (or patient_id), time, and status columns;
#* extra columns are preserved as covariates.
#* @post /datasets/<id>/survival
#* @parser multi
function(req, res, id) {
  if (!dataset_exists(id)) {
    res$status <- 404L
    return(list(error = "not_found"))
  }
  files <- req$body
  surv_part <- find_part(files, c("survival", "survival.csv", "file"))
  if (is.null(surv_part)) {
    res$status <- 400L
    return(list(error = "missing_survival",
                message = "survival CSV part required"))
  }
  surv_path <- write_part_to_tmp(surv_part, suffix = ".csv")
  surv_df <- tryCatch(parse_survival_csv(surv_path), error = function(e) e)
  if (inherits(surv_df, "error")) {
    res$status <- 400L
    return(list(error = "parse_survival", message = conditionMessage(surv_df)))
  }

  ds <- load_dataset(id)
  # Keep only rows whose id matches a known sample/patient so the Cox join
  # later in /analyze/cox has a chance of producing overlap.
  keep <- surv_df$sample_id %in% ds$samples$sample_id |
          surv_df$sample_id %in% ds$samples$patient_id
  matched <- surv_df[keep, , drop = FALSE]
  if (nrow(matched) == 0L) {
    res$status <- 400L
    return(list(error = "no_matching_samples",
                message = paste(
                  "No rows in the survival CSV match a sample_id or",
                  "patient_id from the uploaded cells."
                )))
  }

  ds$survival <- matched
  save_dataset(ds)

  list(
    id = id,
    has_survival = TRUE,
    survival_rows = nrow(matched),
    survival_columns = names(matched),
    message = sprintf("Attached survival data with %d matched samples.",
                      nrow(matched))
  )
}

# ---- Analysis: Ripley's K --------------------------------------------------

#* Compute Ripley's K (or cross-K) for a dataset.
#* @param datasetId Dataset id.
#* @param typeA     Focal cell type.
#* @param typeB     Optional second cell type (cross-K).
#* @param sampleId  Optional single sample id; default = all samples.
#* @param rMax      Optional max radius.
#* @param correction One of iso/trans/border/han. Default iso.
#* @param async     If true, run as a background job.
#* @post /analyze/ripleys-k
function(req, res) {
  body <- parse_json_body(req)
  run_spatial_endpoint(body, res, kind = "K")
}

#* Compute Nearest-Neighbour G (or cross-G) for a dataset.
#* @post /analyze/nn-g
function(req, res) {
  body <- parse_json_body(req)
  run_spatial_endpoint(body, res, kind = "G")
}

run_spatial_endpoint <- function(body, res, kind = c("K", "G")) {
  kind <- match.arg(kind)

  dataset_id <- body$datasetId %||% body$dataset_id
  if (is.null(dataset_id) || !dataset_exists(dataset_id)) {
    res$status <- 400L
    return(list(error = "missing_dataset"))
  }
  type_a <- body$typeA %||% body$type_a %||% "CD8+ T Cell"
  type_b <- body$typeB %||% body$type_b
  if (identical(type_b, "")) type_b <- NULL
  sample_ids <- body$sampleId %||% body$sample_ids
  if (is.character(sample_ids) && length(sample_ids) == 1L &&
      grepl(",", sample_ids)) {
    sample_ids <- trimws(strsplit(sample_ids, ",", fixed = TRUE)[[1]])
  }
  r_max <- body$rMax %||% body$r_max
  r_grid <- if (!is.null(r_max)) seq(0, as.numeric(r_max), length.out = 80L) else NULL
  correction <- body$correction %||% (if (kind == "K") "iso" else "km")
  window_type <- body$windowType %||% body$window_type %||% "convex"
  nsim <- as.integer(body$nsim %||% body$nSim %||% 0L)
  if (nsim < 0L) nsim <- 0L
  async <- isTRUE(body$async)

  ds <- load_dataset(dataset_id)

  fn <- function() {
    if (kind == "K") {
      ripleys_k(ds$cells, sample_ids = sample_ids, type_a = type_a,
                type_b = type_b, r = r_grid, correction = correction,
                max_cells = cfg()$max_cells_per_sample,
                window_type = window_type, nsim = nsim)
    } else {
      nn_g(ds$cells, sample_ids = sample_ids, type_a = type_a,
           type_b = type_b, r = r_grid, correction = correction,
           max_cells = cfg()$max_cells_per_sample,
           window_type = window_type, nsim = nsim)
    }
  }

  if (async) {
    list(jobId = submit_job(fn), status = "queued")
  } else {
    tryCatch(fn(), error = function(e) {
      res$status <- 500L
      list(error = "analysis_failed", message = conditionMessage(e))
    })
  }
}

# ---- Analysis: Cox survival ------------------------------------------------

#* Fit a Cox PH model on a per-sample spatial summary.
#* Body: {datasetId, statistic: "K"|"G", typeA, typeB?, radius,
#*        correction?, dichotomize?, covariates?}
#* @post /analyze/cox
function(req, res) {
  body <- parse_json_body(req)

  dataset_id <- body$datasetId %||% body$dataset_id
  if (is.null(dataset_id) || !dataset_exists(dataset_id)) {
    res$status <- 400L
    return(list(error = "missing_dataset"))
  }
  ds <- load_dataset(dataset_id)
  if (is.null(ds$survival) || nrow(ds$survival) == 0L) {
    res$status <- 400L
    return(list(error = "no_survival", message = "Dataset has no survival data"))
  }

  statistic <- toupper(body$statistic %||% "K")
  if (!statistic %in% c("K", "G")) {
    res$status <- 400L
    return(list(error = "bad_statistic", message = "statistic must be K or G"))
  }
  radius <- as.numeric(body$radius %||% if (statistic == "K") 50 else 20)
  type_a <- body$typeA %||% body$type_a %||% "CD8+ T Cell"
  type_b <- body$typeB %||% body$type_b
  if (identical(type_b, "")) type_b <- NULL
  correction <- body$correction %||% (if (statistic == "K") "iso" else "km")
  window_type <- body$windowType %||% body$window_type %||% "convex"
  dichotomize <- body$dichotomize %||% "none"
  covariates <- body$covariates %||% character()
  if (is.list(covariates)) covariates <- unlist(covariates)
  adjust_density <- isTRUE(body$adjustDensity %||% body$adjust_density)
  cluster_patients <- !isFALSE(body$clusterPatients %||% body$cluster_patients)

  r_grid <- seq(0, max(2 * radius, 10), length.out = 80L)
  spatial_res <- if (statistic == "K") {
    ripleys_k(ds$cells, type_a = type_a, type_b = type_b, r = r_grid,
              correction = correction, max_cells = cfg()$max_cells_per_sample,
              window_type = window_type)
  } else {
    nn_g(ds$cells, type_a = type_a, type_b = type_b, r = r_grid,
         correction = correction, max_cells = cfg()$max_cells_per_sample,
         window_type = window_type)
  }
  per_sample_stat <- spatial_summary_at_r(spatial_res, radius = radius,
                                          statistic = statistic)

  # Merge patient_id from sample summary when available for clustering.
  if ("patient_id" %in% names(ds$samples)) {
    pid_map <- ds$samples[, c("sample_id", "patient_id"), drop = FALSE]
    per_sample_stat <- merge(per_sample_stat, pid_map, by = "sample_id",
                             all.x = TRUE)
  }
  if ("patient_id" %in% names(ds$survival)) {
    pid_surv <- unique(ds$survival[, c("sample_id", "patient_id"),
                                   drop = FALSE])
    per_sample_stat <- merge(per_sample_stat, pid_surv, by = "sample_id",
                             all.x = TRUE, suffixes = c("", ".surv"))
    if ("patient_id.surv" %in% names(per_sample_stat)) {
      per_sample_stat$patient_id <- per_sample_stat$patient_id %||%
        per_sample_stat$patient_id.surv
      per_sample_stat$patient_id.surv <- NULL
    }
  }

  cluster_id <- NULL
  if (cluster_patients && "patient_id" %in% names(per_sample_stat)) {
    cluster_id <- "patient_id"
  }

  cox <- tryCatch(
    cox_from_stat(per_sample_stat, ds$survival,
                  covariates = covariates,
                  dichotomize = dichotomize,
                  adjust_density = adjust_density,
                  cluster_id = cluster_id),
    error = function(e) {
      res$status <- 400L
      list(error = "cox_failed", message = conditionMessage(e))
    }
  )
  if (!is.null(cox$error)) return(cox)

  list(
    request    = list(statistic = statistic, radius = radius,
                      typeA = type_a, typeB = type_b,
                      correction = correction, window_type = window_type,
                      dichotomize = dichotomize,
                      covariates = covariates,
                      adjust_density = adjust_density,
                      cluster_patients = cluster_patients),
    stat_summary = per_sample_stat,
    cox        = cox
  )
}

# ---- Jobs ------------------------------------------------------------------

#* Status of an async job.
#* @get /jobs/<id>
function(id, res) {
  j <- get_job(id)
  if (is.null(j)) { res$status <- 404L; return(list(error = "not_found")) }
  j
}

#* List jobs (debug helper).
#* @get /jobs
function() list_jobs()

# ---- Helpers ---------------------------------------------------------------

parse_json_body <- function(req) {
  if (!is.null(req$body) && is.list(req$body) && length(req$body) > 0L &&
      !is.raw(req$body)) {
    return(req$body)
  }
  raw <- req$postBody %||% ""
  if (!nzchar(raw)) return(list())
  jsonlite::fromJSON(raw, simplifyVector = FALSE)
}

find_part <- function(parts, candidates) {
  if (is.null(parts) || length(parts) == 0L) return(NULL)
  nm <- names(parts) %||% character(length(parts))
  for (cand in candidates) {
    hit <- which(nm == cand)
    if (length(hit) > 0L) return(parts[[hit[1]]])
  }
  NULL
}

write_part_to_tmp <- function(part, suffix = ".csv") {
  path <- tempfile(fileext = suffix)
  raw <- if (is.list(part) && !is.null(part$value)) part$value else part
  if (is.character(raw) && length(raw) == 1L && file.exists(raw)) {
    file.copy(raw, path, overwrite = TRUE)
  } else if (is.raw(raw)) {
    writeBin(raw, path)
  } else if (is.character(raw)) {
    writeLines(raw, path)
  } else {
    stop("Unsupported upload payload type", call. = FALSE)
  }
  path
}
