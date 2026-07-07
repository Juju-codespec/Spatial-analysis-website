# Plumber router: REST endpoints for the spatial portal backend.
#
# Each endpoint is intentionally small; heavy work is delegated to functions
# in cells.R / spatial.R / survival.R / jobs.R.

#* @apiTitle Spatial Portal API
#* @apiDescription R backend for Vectra Polaris / VPD imaging and Clinical
#*   Analysis. Spatial endpoints compute Ripley's K and Nearest Neighbour G;
#*   clinical endpoints merge user-uploaded metadata (survival, stage, grade,
#*   treatment, recurrence) with image-derived cell features. Bundled
#*   vpd-ovarian is an imaging example; clinical outcomes come from CSV upload.
#*   Datasets are persisted in Parquet format (via the Arrow package) for
#*   columnar-efficient storage; CSV and RDS uploads are also supported.

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
       time = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC"),
       capabilities = list(
         clinical_summary = TRUE,
         clinical_features = TRUE,
         clinical_analysis = TRUE,
         association_screening = TRUE
       ))
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

#* Per-cell-type mean phenotype positivity for the Expression Heatmap view.
#* Returns each phenotype_* column averaged per cell type so the frontend
#* can render a meaningful heatmap even when continuous intensity data is
#* not available (0/1 positivity → % positive per type).
#* @get /datasets/<id>/phenotype-summary
function(id, res) {
  if (!dataset_exists(id)) { res$status <- 404L; return(list(error = "not_found")) }
  ds <- load_dataset(id)
  compute_phenotype_summary(ds$cells)
}

compute_phenotype_summary <- function(cells) {
  if (is.null(cells) || nrow(cells) == 0L) {
    return(list(cell_types = character(), markers = character(), matrix = list()))
  }
  phen_cols <- grep("^phenotype_", names(cells), value = TRUE)
  if (length(phen_cols) == 0L) {
    return(list(cell_types = character(), markers = character(), matrix = list()))
  }
  # Human-readable labels: "phenotype_cd8" -> "CD8"
  marker_labels <- toupper(sub("^phenotype_", "", phen_cols))
  cell_types    <- sort(unique(as.character(cells$cell_type)))

  mat <- lapply(cell_types, function(ct) {
    sub_cells <- cells[cells$cell_type == ct, phen_cols, with = FALSE]
    if (nrow(sub_cells) == 0L) {
      return(as.list(stats::setNames(rep(0.0, length(phen_cols)), marker_labels)))
    }
    vals <- colMeans(as.data.frame(sub_cells), na.rm = TRUE)
    as.list(stats::setNames(as.numeric(vals), marker_labels))
  })
  names(mat) <- cell_types

  list(cell_types = cell_types, markers = marker_labels, matrix = mat)
}

#* Cells for a dataset (capped + downsampled for plotting).
#* @param id        Dataset id.
#* @param sample_id Optional restrict to one sample.
#* @param cell_type Optional comma-separated list of cell types.
#* @param downsample Optional integer cap on number of cells returned.
#* @get /datasets/<id>/cells
function(id, sample_id = NULL, cell_type = NULL, downsample = NULL, res) {
  if (!dataset_exists(id)) { res$status <- 404L; return(list(error = "not_found")) }

  # Normalise filter params before any data loading.
  sid_filter <- sample_id
  ct_filter  <- if (!is.null(cell_type) && nzchar(cell_type))
    trimws(strsplit(cell_type, ",", fixed = TRUE)[[1]]) else NULL

  # Fast path: Arrow predicate pushdown for Parquet-backed datasets.
  # Avoids loading the full cells table — only matching rows and the four
  # columns needed for the scatter plot are read from disk.
  fast <- load_cells_filtered(id,
                               sample_id_filter = sid_filter,
                               cell_type_filter = ct_filter)

  if (!is.null(fast)) {
    cells   <- fast$cells
    n_total <- fast$n_total
  } else {
    # Legacy RDS path or Arrow unavailable — load full dataset, filter in R.
    ds      <- load_dataset(id)
    n_total <- nrow(ds$cells)
    cells   <- ds$cells

    if (!is.null(sid_filter) && nzchar(sid_filter)) {
      cells <- cells[get("sample_id") == sid_filter]
    }
    if (!is.null(ct_filter)) {
      cells <- cells[get("cell_type") %in% ct_filter]
    }
  }

  n_filtered  <- nrow(cells)
  type_counts <- cell_type_counts(cells)
  if (!is.null(sid_filter) && nzchar(sid_filter)) {
    n_total <- n_filtered
  }

  cap  <- cfg()$cells_response_cap
  ds_n <- if (!is.null(downsample)) as.integer(downsample) else cap
  if (!is.na(ds_n) && nrow(cells) > ds_n) {
    cells <- cells[sample(.N, ds_n)]
  }

  keep_cols <- intersect(c("sample_id", "x", "y", "cell_type"), names(cells))
  list(
    n_returned = nrow(cells),
    n_total    = n_total,
    cell_types = type_counts,
    cells      = as.data.frame(cells[, ..keep_cols])
  )
}

#* Render a ggplot2 cell-type scatter map for one tissue core.
#*
#* Returns a JSON envelope with a base64-encoded PNG. The plot uses
#* coord_equal() so that TMA cores appear as perfect circles rather than
#* ovals — the x and y coordinate scales are locked to the same physical unit.
#*
#* @param sample_id  Required: the sample_id to render.
#* @param cell_type  Optional comma-separated list of cell types to include.
#* @param width      PNG width in pixels (default 800).
#* @param height     PNG height in pixels (default 700).
#* @param point_size ggplot2 dot size (default 0.6; smaller for dense cores).
#* @get /datasets/<id>/plot
function(id, sample_id = NULL, cell_type = NULL,
         width = "800", height = "700", point_size = "0.6", res) {
  if (!dataset_exists(id)) {
    res$status <- 404L
    return(list(error = "not_found"))
  }
  sample_id <- as.character(sample_id %||% "")
  if (!nzchar(sample_id)) {
    res$status <- 400L
    return(list(error = "missing_sample_id",
                message = "sample_id query parameter is required"))
  }

  ct_filter <- if (!is.null(cell_type) && nzchar(as.character(cell_type)))
    trimws(strsplit(as.character(cell_type), ",", fixed = TRUE)[[1]]) else NULL

  fast <- load_cells_filtered(id,
                              sample_id_filter = sample_id,
                              cell_type_filter = ct_filter)
  if (!is.null(fast)) {
    cells <- fast$cells
  } else {
    ds    <- load_dataset(id)
    cells <- ds$cells[get("sample_id") == sample_id]
    if (!is.null(ct_filter)) {
      cells <- cells[get("cell_type") %in% ct_filter]
    }
  }

  if (nrow(cells) == 0L) {
    res$status <- 404L
    return(list(error = "no_cells",
                message = sprintf("No cells found for sample '%s'.", sample_id)))
  }

  raw_bytes <- tryCatch(
    render_cell_plot_png(
      cells,
      title      = sample_id,
      width      = as.integer(width      %||% 800L),
      height     = as.integer(height     %||% 700L),
      point_size = as.numeric(point_size %||% 0.6)
    ),
    error = function(e) e
  )
  if (inherits(raw_bytes, "error")) {
    res$status <- 500L
    return(list(error = "plot_failed", message = conditionMessage(raw_bytes)))
  }

  list(
    sample_id  = sample_id,
    format     = "png",
    width      = as.integer(width  %||% 800L),
    height     = as.integer(height %||% 700L),
    n_cells    = nrow(cells),
    image_b64  = jsonlite::base64_enc(raw_bytes)
  )
}

#* Upload a new dataset.
#* Accepts multipart `cells` (CSV/TSV/Parquet) or `rds`/`spe` (SpatialExperiment).
#* Parquet uploads require the `arrow` package and are stored directly in
#* columnar format — no conversion needed.
#* @param title:character Optional dataset title.
#* @param cancer_type:character Optional cancer type label.
#* @param tissue:character Optional tissue label.
#* @post /datasets
#* @parser multi
function(req, res, title = NULL, cancer_type = NA_character_,
         tissue = NA_character_) {
  result <- tryCatch({
  files <- req$body
  ds_id <- paste0("upload-", substr(uuid::UUIDgenerate(), 1L, 8L))
  ds_title <- normalize_form_scalar(title) %||%
    sprintf("Upload %s", format(Sys.time(), "%Y-%m-%d %H:%M"))
  cancer_type <- normalize_form_scalar(cancer_type) %||% NA_character_
  tissue <- normalize_form_scalar(tissue) %||% NA_character_

  rds_part <- find_part(files, c("rds", "spe", "spatial"))
  cells_part <- find_part(files, c("cells", "cells.csv", "cells_csv", "parquet", "file"))
  if (is.null(rds_part) && is.null(cells_part)) {
    res$status <- 400L
    return(list(error = "missing_cells",
                message = "cells CSV/TSV/Parquet or rds/spe part required"))
  }

  if (!is.null(rds_part) || is_rds_part(cells_part)) {
    upload_part <- rds_part %||% cells_part
    rds_path <- write_part_to_tmp(upload_part, suffix = ".rds")
    ds <- tryCatch(
      parse_rds_upload(
        rds_path,
        id = ds_id,
        title = ds_title,
        cancer_type = cancer_type %||% NA_character_,
        tissue = tissue %||% NA_character_
      ),
      error = function(e) e
    )
    if (inherits(ds, "error")) {
      res$status <- 400L
      return(list(error = "parse_rds", message = conditionMessage(ds)))
    }
  } else if (!is.null(cells_part) && is_parquet_part(cells_part)) {
    pq_path <- write_part_to_tmp(cells_part, suffix = ".parquet")
    cells <- tryCatch(parse_cells_parquet(pq_path), error = function(e) e)
    if (inherits(cells, "error")) {
      res$status <- 400L
      return(list(error = "parse_cells", message = conditionMessage(cells)))
    }
    ds <- build_uploaded_dataset(
      id = ds_id,
      title = ds_title,
      cells = cells,
      survival = NULL,
      cancer_type = cancer_type %||% NA_character_,
      tissue = tissue %||% NA_character_
    )
  } else {
    cells_path <- write_part_to_tmp(cells_part, suffix = ".csv")
    cells <- tryCatch(parse_cells_csv(cells_path), error = function(e) e)
    if (inherits(cells, "error")) {
      res$status <- 400L
      return(list(error = "parse_cells", message = conditionMessage(cells)))
    }
    ds <- build_uploaded_dataset(
      id = ds_id,
      title = ds_title,
      cells = cells,
      survival = NULL,
      cancer_type = cancer_type %||% NA_character_,
      tissue = tissue %||% NA_character_
    )
  }

  surv_part <- find_part(files, c("survival", "survival.csv"))
  if (!is.null(surv_part)) {
    surv_path <- write_part_to_tmp(surv_part, suffix = ".csv")
    surv_df <- tryCatch(parse_survival_csv(surv_path), error = function(e) e)
    if (inherits(surv_df, "error")) {
      res$status <- 400L
      return(list(error = "parse_survival", message = conditionMessage(surv_df)))
    }
    if (nrow(surv_df) > 0L) {
      keep <- surv_df$sample_id %in% ds$samples$sample_id |
              surv_df$sample_id %in% ds$samples$patient_id
      ds$survival <- dedupe_survival_by_sample(surv_df[keep, , drop = FALSE])
    }
  }

  save_dataset(ds)
  list(id = ds_id, meta = ds$meta, message = "Dataset uploaded")
  }, error = function(e) {
    msg <- conditionMessage(e)
    if (grepl("long vectors not supported|split_by_boundary", msg, ignore.case = TRUE)) {
      res$status <- 413L
      return(list(
        error = "file_too_large",
        message = paste(
          "Upload is too large for the HTTP parser (typically >~400 MB RDS).",
          "Export a cell CSV from Vectra Polaris instead, or open the bundled",
          "vpd-lung / vpd-ovarian datasets from Explore (no upload needed)."
        )
      ))
    }
    res$status <- 500L
    list(error = "upload_failed", message = msg)
  })
  result
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
  surv_df <- tryCatch(
    parse_survival_csv(surv_path),
    error = function(e) {
      tryCatch(
        parse_clinical_supplement_csv(surv_path),
        error = function(e2) e
      )
    }
  )
  if (inherits(surv_df, "error")) {
    res$status <- 400L
    return(list(error = "parse_survival", message = conditionMessage(surv_df)))
  }

  ds <- load_dataset(id)
  # Keep only rows whose id matches a known sample/patient so the Cox join
  # later in /analyze/cox has a chance of producing overlap.
  keep <- surv_df$sample_id %in% ds$samples$sample_id |
          surv_df$sample_id %in% ds$samples$patient_id
  matched <- dedupe_survival_by_sample(surv_df[keep, , drop = FALSE])
  if (nrow(matched) == 0L) {
    res$status <- 400L
    return(list(error = "no_matching_samples",
                message = paste(
                  "No rows in the survival CSV match a sample_id or",
                  "patient_id from the uploaded cells."
                )))
  }

  ds$survival <- merge_survival_clinical(ds$survival, matched)
  save_dataset(ds)

  list(
    id = id,
    has_survival = TRUE,
    survival_rows = nrow(matched),
    survival_columns = names(matched),
    message = sprintf("Attached survival data with %d matched sample(s).",
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
  nsim <- as.integer(body$nsim %||% body$nSim %||% cfg()$default_nsim)
  if (nsim < 0L) nsim <- 0L
  min_focal_cells <- as.integer(body$minFocalCells %||% body$min_focal_cells %||% 10L)
  if (min_focal_cells < 1L) min_focal_cells <- 1L

  ds <- load_dataset(dataset_id)
  async <- if ("async" %in% names(body)) {
    isTRUE(body$async)
  } else {
    nsim > 0L || nrow(ds$cells) > cfg()$async_cells_threshold
  }

  fn <- function() {
    if (kind == "K") {
      ripleys_k(ds$cells, sample_ids = sample_ids, type_a = type_a,
                type_b = type_b, r = r_grid, correction = correction,
                max_cells = cfg()$max_cells_per_sample,
                window_type = window_type, nsim = nsim,
                min_focal_cells = min_focal_cells)
    } else {
      nn_g(ds$cells, sample_ids = sample_ids, type_a = type_a,
           type_b = type_b, r = r_grid, correction = correction,
           max_cells = cfg()$max_cells_per_sample,
           window_type = window_type, nsim = nsim,
           min_focal_cells = min_focal_cells)
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
  min_focal_cells <- as.integer(body$minFocalCells %||% body$min_focal_cells %||% 10L)
  if (min_focal_cells < 1L) min_focal_cells <- 1L
  nsim_cox <- 0L

  r_grid <- seq(0, max(2 * radius, 10), length.out = 80L)
  spatial_res <- if (statistic == "K") {
    ripleys_k(ds$cells, type_a = type_a, type_b = type_b, r = r_grid,
              correction = correction, max_cells = cfg()$max_cells_per_sample,
              window_type = window_type, nsim = nsim_cox,
              min_focal_cells = min_focal_cells)
  } else {
    nn_g(ds$cells, type_a = type_a, type_b = type_b, r = r_grid,
         correction = correction, max_cells = cfg()$max_cells_per_sample,
         window_type = window_type, nsim = nsim_cox,
         min_focal_cells = min_focal_cells)
  }
  if (length(spatial_res$per_sample) == 0L) {
    res$status <- 400L
    return(list(
      error = "no_samples_after_filter",
      message = spatial_res$analysis_message %||% sprintf(
        "No samples passed the minimum focal-cell threshold (%d %s cells).",
        min_focal_cells, type_a
      ),
      min_focal_cells = min_focal_cells,
      n_samples_total = spatial_res$n_samples_total %||% 0L,
      n_samples_excluded = spatial_res$n_samples_excluded %||% 0L
    ))
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
                      cluster_patients = cluster_patients,
                      min_focal_cells = min_focal_cells),
    stat_summary = per_sample_stat,
    sample_filter = list(
      min_focal_cells = min_focal_cells,
      n_samples_total = spatial_res$n_samples_total,
      n_samples_analyzed = spatial_res$n_samples_analyzed,
      n_samples_excluded = spatial_res$n_samples_excluded
    ),
    cox        = cox
  )
}

# ---- Analysis: Bivariate Cox (clustering × abundance) ---------------------

#* Fit a Cox PH model on the joint stratification of spatial clustering and
#* T-cell abundance (count or percentage of typeA cells per sample).
#* Body: {datasetId, statistic: "K"|"G", typeA, typeB?, radius,
#*        abundanceType: "pct"|"count", split: "median"|"tertile",
#*        covariates?, clusterPatients?, minFocalCells?}
#* @post /analyze/cox-bivariate
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

  statistic    <- toupper(body$statistic %||% "K")
  if (!statistic %in% c("K", "G")) {
    res$status <- 400L
    return(list(error = "bad_statistic", message = "statistic must be K or G"))
  }
  radius         <- as.numeric(body$radius %||% if (statistic == "K") 50 else 20)
  type_a         <- body$typeA %||% body$type_a %||% "CD8+ T Cell"
  type_b         <- body$typeB %||% body$type_b
  if (identical(type_b, "")) type_b <- NULL
  correction     <- body$correction %||% (if (statistic == "K") "iso" else "km")
  window_type    <- body$windowType %||% body$window_type %||% "convex"
  abundance_type <- body$abundanceType %||% body$abundance_type %||% "pct"
  split          <- body$split %||% "median"
  covariates     <- body$covariates %||% character()
  if (is.list(covariates)) covariates <- unlist(covariates)
  cluster_patients <- !isFALSE(body$clusterPatients %||% body$cluster_patients)
  adjust_density   <- isTRUE(body$adjustDensity %||% body$adjust_density)
  min_focal_cells  <- as.integer(body$minFocalCells %||% body$min_focal_cells %||% 10L)
  if (min_focal_cells < 1L) min_focal_cells <- 1L

  # Compute per-sample spatial clustering statistic.
  r_grid <- seq(0, max(2 * radius, 10), length.out = 80L)
  spatial_res <- if (statistic == "K") {
    ripleys_k(ds$cells, type_a = type_a, type_b = type_b, r = r_grid,
              correction = correction, max_cells = cfg()$max_cells_per_sample,
              window_type = window_type, nsim = 0L,
              min_focal_cells = min_focal_cells)
  } else {
    nn_g(ds$cells, type_a = type_a, type_b = type_b, r = r_grid,
         correction = correction, max_cells = cfg()$max_cells_per_sample,
         window_type = window_type, nsim = 0L,
         min_focal_cells = min_focal_cells)
  }
  if (length(spatial_res$per_sample) == 0L) {
    res$status <- 400L
    return(list(
      error = "no_samples_after_filter",
      message = spatial_res$analysis_message %||% sprintf(
        "No samples passed the minimum focal-cell threshold (%d %s cells).",
        min_focal_cells, type_a
      )
    ))
  }
  per_sample_stat <- spatial_summary_at_r(spatial_res, radius = radius,
                                          statistic = statistic)

  # Attach patient_id.
  if ("patient_id" %in% names(ds$samples)) {
    pid_map <- ds$samples[, c("sample_id", "patient_id"), drop = FALSE]
    per_sample_stat <- merge(per_sample_stat, pid_map, by = "sample_id",
                             all.x = TRUE)
  }

  # Compute per-sample abundance from cell counts.
  feats <- aggregate_cell_features(ds$cells, level = "sample")
  type_a_key <- sanitize_feature_name(type_a)
  abund_col <- if (abundance_type == "count") {
    paste0("count_", type_a_key)
  } else {
    paste0("pct_", type_a_key)
  }
  if (!abund_col %in% names(feats)) {
    res$status <- 400L
    return(list(
      error   = "missing_abundance_column",
      message = sprintf("Abundance column '%s' not found. Available: %s",
                        abund_col,
                        paste(names(feats)[grep("^(count_|pct_)", names(feats))],
                              collapse = ", "))
    ))
  }
  abund_per_sample <- data.frame(
    sample_id = feats$sample_id,
    abund     = as.numeric(feats[[abund_col]]),
    stringsAsFactors = FALSE
  )

  cluster_id <- NULL
  if (cluster_patients && "patient_id" %in% names(per_sample_stat)) {
    cluster_id <- "patient_id"
  }

  cox <- tryCatch(
    cox_bivariate(per_sample_stat, abund_per_sample, ds$survival,
                  split      = split,
                  covariates = covariates,
                  cluster_id = cluster_id,
                  adjust_density = adjust_density),
    error = function(e) {
      res$status <- 400L
      list(error = "bivariate_cox_failed", message = conditionMessage(e))
    }
  )
  if (!is.null(cox$error)) return(cox)

  list(
    request = list(
      statistic       = statistic,
      radius          = radius,
      typeA           = type_a,
      typeB           = type_b,
      correction      = correction,
      window_type     = window_type,
      abundance_type  = abundance_type,
      abund_col       = abund_col,
      split           = split,
      covariates      = covariates,
      adjust_density  = adjust_density,
      cluster_patients = cluster_patients,
      min_focal_cells  = min_focal_cells
    ),
    stat_summary = per_sample_stat,
    abund_summary = abund_per_sample,
    sample_filter = list(
      min_focal_cells    = min_focal_cells,
      n_samples_total    = spatial_res$n_samples_total,
      n_samples_analyzed = spatial_res$n_samples_analyzed,
      n_samples_excluded = spatial_res$n_samples_excluded
    ),
    cox = cox
  )
}

# ---- Analysis: Wilcoxon rank sum -------------------------------------------

#* Compare per-sample spatial summary between two survival-metadata groups.
#* Body: {datasetId, statistic: "K"|"G", typeA, typeB?, radius,
#*        groupColumn, groupA?, groupB?, ...}
#* @post /analyze/wilcoxon
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
    return(list(
      error = "no_survival",
      message = "Dataset has no survival metadata for group comparison"
    ))
  }

  group_column <- body$groupColumn %||% body$group_column %||% "status"
  if (!group_column %in% names(ds$survival)) {
    res$status <- 400L
    return(list(
      error = "missing_group_column",
      message = sprintf("Survival data has no column '%s'.", group_column)
    ))
  }
  eligible <- eligible_group_columns(ds$survival)

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
  min_focal_cells <- as.integer(body$minFocalCells %||% body$min_focal_cells %||% 10L)
  if (min_focal_cells < 1L) min_focal_cells <- 1L
  group_a <- body$groupA %||% body$group_a
  group_b <- body$groupB %||% body$group_b
  if (identical(group_a, "")) group_a <- NULL
  if (identical(group_b, "")) group_b <- NULL

  r_grid <- seq(0, max(2 * radius, 10), length.out = 80L)
  spatial_res <- if (statistic == "K") {
    ripleys_k(ds$cells, type_a = type_a, type_b = type_b, r = r_grid,
              correction = correction, max_cells = cfg()$max_cells_per_sample,
              window_type = window_type, nsim = 0L,
              min_focal_cells = min_focal_cells)
  } else {
    nn_g(ds$cells, type_a = type_a, type_b = type_b, r = r_grid,
         correction = correction, max_cells = cfg()$max_cells_per_sample,
         window_type = window_type, nsim = 0L,
         min_focal_cells = min_focal_cells)
  }
  if (length(spatial_res$per_sample) == 0L) {
    res$status <- 400L
    return(list(
      error = "no_samples_after_filter",
      message = spatial_res$analysis_message %||% sprintf(
        "No samples passed the minimum focal-cell threshold (%d %s cells).",
        min_focal_cells, type_a
      ),
      eligible_group_columns = eligible
    ))
  }

  per_sample_stat <- spatial_summary_at_r(spatial_res, radius = radius,
                                          statistic = statistic)

  wx <- tryCatch(
    wilcox_from_stat(per_sample_stat, ds$survival,
                     group_column = group_column,
                     group_a = group_a, group_b = group_b),
    error = function(e) {
      res$status <- 400L
      list(
        error = "wilcox_failed",
        message = conditionMessage(e),
        eligible_group_columns = eligible
      )
    }
  )
  if (!is.null(wx$error)) return(wx)

  list(
    request = list(
      statistic = statistic,
      radius = radius,
      typeA = type_a,
      typeB = type_b,
      correction = correction,
      window_type = window_type,
      group_column = group_column,
      group_a = wx$group_a,
      group_b = wx$group_b,
      min_focal_cells = min_focal_cells
    ),
    stat_summary = per_sample_stat,
    sample_filter = list(
      min_focal_cells = min_focal_cells,
      n_samples_total = spatial_res$n_samples_total,
      n_samples_analyzed = spatial_res$n_samples_analyzed,
      n_samples_excluded = spatial_res$n_samples_excluded
    ),
    eligible_group_columns = eligible,
    wilcoxon = wx
  )
}

# ---- Clinical: patient-level features --------------------------------------

#* Per-sample or per-patient cell counts, percentages, and ratios.
#* Optional query params: include_spatial_cluster, statistic, type_a, type_b,
#*   radius, min_focal_cells, window_type.
#* @param level sample (default) or patient.
#* @get /datasets/<id>/clinical-features
function(id, level = "sample",
         include_spatial_cluster = "false",
         statistic = "K",
         type_a = NULL,
         type_b = NULL,
         radius = NULL,
         min_focal_cells = NULL,
         window_type = "convex",
         res) {
  if (!dataset_exists(id)) { res$status <- 404L; return(list(error = "not_found")) }
  level <- tolower(level %||% "sample")
  if (!level %in% c("sample", "patient")) {
    res$status <- 400L
    return(list(error = "bad_level", message = "level must be sample or patient"))
  }
  ds <- load_dataset(id)
  spatial_cfg <- spatial_cfg_from_query(
    include_spatial_cluster, statistic, type_a, type_b,
    radius, min_focal_cells, window_type
  )
  features <- build_clinical_features(ds, level = level, spatial_cfg = spatial_cfg,
                                      dataset_id = id)
  list(
    level = level,
    cell_types = sort(unique(ds$cells$cell_type)),
    feature_columns = clinical_feature_columns(features),
    n_rows = nrow(features),
    include_spatial_cluster = !is.null(spatial_cfg),
    features = features
  )
}

#* Merged cell markers + clinical metadata for summary plots.
#* Optional query params: include_spatial_cluster, statistic, type_a, type_b,
#*   radius, min_focal_cells, window_type.
#* @param level sample (default) or patient.
#* @get /datasets/<id>/clinical-summary
function(id, level = "sample",
         include_spatial_cluster = "false",
         statistic = "K",
         type_a = NULL,
         type_b = NULL,
         radius = NULL,
         min_focal_cells = NULL,
         window_type = "convex",
         res) {
  if (!dataset_exists(id)) { res$status <- 404L; return(list(error = "not_found")) }
  level <- tolower(level %||% "sample")
  if (!level %in% c("sample", "patient")) {
    res$status <- 400L
    return(list(error = "bad_level", message = "level must be sample or patient"))
  }
  ds <- load_dataset(id)
  if (is.null(ds$survival) || nrow(ds$survival) == 0L) {
    res$status <- 400L
    return(list(error = "no_survival",
                message = "Attach clinical metadata before using summary plots."))
  }
  spatial_cfg <- spatial_cfg_from_query(
    include_spatial_cluster, statistic, type_a, type_b,
    radius, min_focal_cells, window_type
  )
  out <- clinical_summary_data(ds, level = level, spatial_cfg = spatial_cfg,
                               dataset_id = id)
  out$include_spatial_cluster <- !is.null(spatial_cfg)
  out
}

#* Sample / patient ID overlap between imaging cells and clinical metadata.
#* @get /datasets/<id>/id-overlap
function(id, res) {
  if (!dataset_exists(id)) { res$status <- 404L; return(list(error = "not_found")) }
  ds <- load_dataset(id)
  dataset_id_overlap(ds)
}

#* Statistical tests for selected marker × clinical variable pairs.
#* Body: {datasetId, level?, pairs: [{markerColumn, clinicalColumn}, ...]}
#* @post /analyze/clinical/summary-tests
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
    return(list(error = "no_survival", message = "Dataset has no clinical metadata"))
  }
  level <- tolower(body$level %||% "sample")
  if (!level %in% c("sample", "patient")) level <- "sample"
  pairs <- body$pairs %||% list()
  if (length(pairs) == 0L) {
    res$status <- 400L
    return(list(error = "missing_pairs", message = "At least one pair is required"))
  }
  if (length(pairs) > 48L) {
    res$status <- 400L
    return(list(error = "too_many_pairs", message = "Maximum 48 pairs per request"))
  }

  summary <- clinical_summary_data(ds, level = level,
                                   spatial_cfg = parse_spatial_cluster_cfg(body),
                                   dataset_id = dataset_id)
  tests <- clinical_summary_tests(summary$rows, pairs)
  list(
    level = level,
    n_rows = summary$n_rows,
    tests = tests
  )
}

#* Screen marker × clinical associations with FDR correction (max 48 pairs).
#* Body: {datasetId, level?, includeSpatialCluster?, fdrMethod?, ...}
#* @post /analyze/clinical/association-matrix
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
    return(list(error = "no_survival", message = "Dataset has no clinical metadata"))
  }
  level <- tolower(body$level %||% "sample")
  if (!level %in% c("sample", "patient")) level <- "sample"
  fdr_method <- body$fdrMethod %||% body$fdr_method %||% "BH"
  max_pairs <- as.integer(body$maxPairs %||% body$max_pairs %||% 48L)
  if (max_pairs < 1L || max_pairs > 96L) max_pairs <- 48L
  include_counts <- isTRUE(body$includeCounts %||% body$include_counts)
  include_survival <- !isFALSE(body$includeSurvival %||% body$include_survival)
  auto_spatial <- !isFALSE(body$autoSpatial %||% body$auto_spatial)
  clinical_filter <- body$clinicalColumns %||% body$clinical_columns
  if (!is.null(clinical_filter) && length(clinical_filter) == 0L) {
    clinical_filter <- NULL
  }

  spatial_cfg <- parse_spatial_cluster_cfg(body)
  out <- tryCatch(
    clinical_association_matrix(
      ds, level = level,
      spatial_cfg = spatial_cfg,
      max_pairs = max_pairs,
      fdr_method = fdr_method,
      dataset_id = dataset_id,
      include_counts = include_counts,
      clinical_column_filter = clinical_filter,
      include_survival = include_survival,
      auto_spatial = auto_spatial
    ),
    error = function(e) {
      res$status <- 400L
      list(error = "association_failed", message = conditionMessage(e))
    }
  )
  if (!is.null(out$error)) return(out)
  out$include_spatial_cluster <- !is.null(spatial_cfg) || isTRUE(out$auto_spatial)
  out
}

load_clinical_features <- function(ds, body, dataset_id = NULL) {
  level <- tolower(body$level %||% body$aggregationLevel %||% "sample")
  if (!level %in% c("sample", "patient")) level <- "sample"
  spatial_cfg <- parse_spatial_cluster_cfg(body)
  id <- dataset_id %||% body$datasetId %||% body$dataset_id
  features <- build_clinical_features(ds, level = level, spatial_cfg = spatial_cfg,
                                      dataset_id = id)
  list(features = features, level = level, spatial_cfg = spatial_cfg)
}

#' Parse spatial-cluster query/body params into a config list (or NULL).
parse_spatial_cluster_cfg <- function(body) {
  enabled <- isTRUE(body$includeSpatialCluster %||% body$include_spatial_cluster)
  if (!enabled) return(NULL)
  list(
    enabled = TRUE,
    statistic = body$statistic %||% "K",
    type_a = body$typeA %||% body$type_a %||% "CD8+ T Cell",
    type_b = body$typeB %||% body$type_b,
    radius = body$radius,
    correction = body$correction,
    window_type = body$windowType %||% body$window_type,
    min_focal_cells = body$minFocalCells %||% body$min_focal_cells
  )
}

#' Build spatial config from plumber GET query parameters.
spatial_cfg_from_query <- function(include_spatial_cluster = "false",
                                   statistic = "K",
                                   type_a = NULL,
                                   type_b = NULL,
                                   radius = NULL,
                                   min_focal_cells = NULL,
                                   window_type = "convex") {
  enabled <- isTRUE(tolower(as.character(include_spatial_cluster %||% "false")) %in%
                      c("true", "1", "yes"))
  if (!enabled) return(NULL)
  list(
    enabled = TRUE,
    statistic = statistic %||% "K",
    type_a = type_a %||% "CD8+ T Cell",
    type_b = type_b,
    radius = if (!is.null(radius) && nzchar(as.character(radius))) as.numeric(radius) else NULL,
    min_focal_cells = if (!is.null(min_focal_cells) && nzchar(as.character(min_focal_cells))) {
      as.integer(min_focal_cells)
    } else {
      NULL
    },
    window_type = window_type %||% "convex"
  )
}

# ---- Analysis: clinical (patient-level, no spatial required) -----------------

#* Wilcoxon test on a cell count / ratio feature between clinical groups.
#* @post /analyze/clinical/wilcoxon
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
    return(list(error = "no_survival",
                message = "Dataset has no clinical metadata"))
  }

  feature_column <- body$featureColumn %||% body$feature_column
  group_column <- body$groupColumn %||% body$group_column
  if (is.null(feature_column) || is.null(group_column)) {
    res$status <- 400L
    return(list(error = "missing_params",
                message = "featureColumn and groupColumn are required"))
  }

  ctx <- load_clinical_features(ds, body, dataset_id = dataset_id)
  eligible_groups <- preferred_group_columns(ds$survival)
  if (!group_column %in% names(ds$survival)) {
    res$status <- 400L
    return(list(error = "missing_group_column",
                message = sprintf("No column '%s' in clinical data.", group_column),
                eligible_group_columns = eligible_groups))
  }

  group_a <- body$groupA %||% body$group_a
  group_b <- body$groupB %||% body$group_b
  if (identical(group_a, "")) group_a <- NULL
  if (identical(group_b, "")) group_b <- NULL

  wx <- tryCatch(
    clinical_wilcoxon(ctx$features, ds$survival,
                      feature_column = feature_column,
                      group_column = group_column,
                      group_a = group_a, group_b = group_b),
    error = function(e) {
      res$status <- 400L
      list(error = "wilcox_failed", message = conditionMessage(e),
           eligible_group_columns = eligible_groups)
    }
  )
  if (!is.null(wx$error)) return(wx)

  list(
    request = list(
      feature_column = feature_column,
      group_column = group_column,
      group_a = wx$group_a,
      group_b = wx$group_b,
      level = ctx$level,
      include_spatial_cluster = !is.null(ctx$spatial_cfg)
    ),
    eligible_group_columns = eligible_groups,
    feature_columns = clinical_feature_columns(ctx$features),
    wilcoxon = wx
  )
}

#* Linear / logistic models with cell features and clinical covariates.
#* @post /analyze/clinical/linear
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
    return(list(error = "no_survival",
                message = "Dataset has no clinical metadata"))
  }

  outcome_column <- body$outcomeColumn %||% body$outcome_column %||% "status"
  feature_columns <- body$featureColumns %||% body$feature_columns %||% character()
  if (is.list(feature_columns)) feature_columns <- unlist(feature_columns)
  covariates <- body$covariates %||% character()
  if (is.list(covariates)) covariates <- unlist(covariates)
  cluster_patients <- !isFALSE(body$clusterPatients %||% body$cluster_patients)

  ctx <- load_clinical_features(ds, body, dataset_id = dataset_id)
  if (length(feature_columns) == 0L) {
    feats <- clinical_feature_columns(ctx$features)
    if (length(feats) > 0L) feature_columns <- feats[1]
  }
  if ("spatial_cluster_stat" %in% names(ctx$features) &&
      isTRUE(body$includeSpatialCluster %||% body$include_spatial_cluster)) {
    feature_columns <- unique(c(feature_columns, "spatial_cluster_stat"))
  }

  eligible_outcomes <- eligible_outcome_columns(ds$survival)
  eligible_covs <- eligible_covariate_columns(ds$survival, outcome_column)

  cluster_id <- NULL
  if (cluster_patients && "patient_id" %in% names(ctx$features)) {
    cluster_id <- "patient_id"
  }

  lin <- tryCatch(
    clinical_linear(ctx$features, ds$survival,
                    outcome_column = outcome_column,
                    feature_columns = feature_columns,
                    covariates = covariates,
                    cluster_id = cluster_id),
    error = function(e) {
      res$status <- 400L
      list(error = "linear_failed", message = conditionMessage(e),
           eligible_outcome_columns = eligible_outcomes,
           eligible_covariate_columns = eligible_covs)
    }
  )
  if (!is.null(lin$error)) return(lin)

  list(
    request = list(
      outcome_column = outcome_column,
      feature_columns = feature_columns,
      covariates = covariates,
      level = ctx$level,
      include_spatial_cluster = !is.null(ctx$spatial_cfg),
      cluster_patients = cluster_patients
    ),
    eligible_outcome_columns = eligible_outcomes,
    eligible_covariate_columns = eligible_covs,
    feature_columns = clinical_feature_columns(ctx$features),
    linear = lin
  )
}

#* Beta-binomial model: count_column / total_column ~ clinical_variable + covariates.
#* Models per-sample cell-count proportions as overdispersed binomial outcomes,
#* with a clinical variable as the predictor. Uses glmmTMB / aod beta-binomial
#* cascade with quasibinomial as last resort. The count_column is the imaging numerator
#* (e.g. count_CD8plus_T_Cell) and total_column is the denominator (default n_total
#* or any count_* column for compartment-specific denominators).
#* @post /analyze/clinical/beta-binomial
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
    return(list(error = "no_survival",
                message = "Dataset has no clinical metadata"))
  }

  count_column   <- body$countColumn   %||% body$count_column
  total_column   <- body$totalColumn   %||% body$total_column   %||% "n_total"
  outcome_column <- body$outcomeColumn %||% body$outcome_column %||% "status"
  covariates     <- body$covariates    %||% character()
  if (is.list(covariates)) covariates <- unlist(covariates)
  cluster_patients <- !isFALSE(body$clusterPatients %||% body$cluster_patients)

  ctx <- load_clinical_features(ds, body, dataset_id = dataset_id)

  if (is.null(count_column) || !nzchar(count_column)) {
    avail <- beta_binomial_count_columns(ctx$features)
    count_column <- if (length(avail) > 0L) avail[1L] else NULL
  }
  if (is.null(count_column)) {
    res$status <- 400L
    return(list(error = "missing_count_column",
                message = "countColumn is required"))
  }

  eligible_outcomes <- eligible_outcome_columns(ds$survival)
  eligible_covs     <- eligible_covariate_columns(ds$survival, outcome_column)
  avail_counts      <- beta_binomial_count_columns(ctx$features)

  cluster_id <- NULL
  if (cluster_patients && "patient_id" %in% names(ctx$features)) {
    cluster_id <- "patient_id"
  }

  bb <- tryCatch(
    clinical_beta_binomial(ctx$features, ds$survival,
                           count_column   = count_column,
                           outcome_column = outcome_column,
                           total_column   = total_column,
                           covariates     = covariates,
                           cluster_id     = cluster_id),
    error = function(e) {
      res$status <- 400L
      list(error = "beta_binomial_failed", message = conditionMessage(e),
           eligible_outcome_columns   = eligible_outcomes,
           eligible_covariate_columns = eligible_covs)
    }
  )
  if (!is.null(bb$error)) return(bb)

  list(
    request = list(
      count_column     = count_column,
      total_column     = total_column,
      outcome_column   = outcome_column,
      covariates       = covariates,
      level            = ctx$level,
      cluster_patients = cluster_patients
    ),
    eligible_outcome_columns   = eligible_outcomes,
    eligible_covariate_columns = eligible_covs,
    available_count_columns    = avail_counts,
    feature_columns            = clinical_feature_columns(ctx$features),
    beta_binomial              = bb
  )
}

#* Survival: Kaplan-Meier, log-rank, and Cox on a cell feature.
#* @post /analyze/clinical/survival
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
  if (!"time" %in% names(ds$survival) || !"status" %in% names(ds$survival)) {
    res$status <- 400L
    return(list(error = "missing_survival_cols",
                message = "Clinical data must include time and status columns"))
  }

  feature_column <- body$featureColumn %||% body$feature_column
  covariates <- body$covariates %||% character()
  if (is.list(covariates)) covariates <- unlist(covariates)
  dichotomize <- body$dichotomize %||% "median"
  cluster_patients <- !isFALSE(body$clusterPatients %||% body$cluster_patients)

  ctx <- load_clinical_features(ds, body, dataset_id = dataset_id)
  feats <- clinical_feature_columns(ctx$features)
  if (is.null(feature_column) || !nzchar(feature_column)) {
    feature_column <- if (length(feats) > 0L) feats[1] else NULL
  }
  if (is.null(feature_column)) {
    res$status <- 400L
    return(list(error = "missing_feature", message = "featureColumn is required"))
  }

  if ("spatial_cluster_stat" %in% names(ctx$features) &&
      isTRUE(body$includeSpatialCluster %||% body$include_spatial_cluster) &&
      !identical(feature_column, "spatial_cluster_stat")) {
    covariates <- unique(c(covariates, "spatial_cluster_stat"))
  }

  cluster_id <- NULL
  if (cluster_patients && "patient_id" %in% names(ctx$features)) {
    cluster_id <- "patient_id"
  }

  surv <- tryCatch(
    clinical_survival(ctx$features, ds$survival,
                      feature_column = feature_column,
                      covariates = covariates,
                      dichotomize = dichotomize,
                      cluster_id = cluster_id),
    error = function(e) {
      res$status <- 400L
      list(error = "survival_failed", message = conditionMessage(e),
           feature_columns = feats)
    }
  )
  if (!is.null(surv$error)) return(surv)

  list(
    request = list(
      feature_column = feature_column,
      covariates = covariates,
      dichotomize = dichotomize,
      level = ctx$level,
      include_spatial_cluster = !is.null(ctx$spatial_cfg),
      cluster_patients = cluster_patients
    ),
    feature_columns = feats,
    survival = surv
  )
}

# ---- Analysis: linear / logistic clinical outcomes -------------------------

#* Predict a clinical outcome from per-sample spatial clustering + covariates.
#* Body: {datasetId, statistic: "K"|"G", typeA, typeB?, radius,
#*        outcomeColumn, covariates?, adjustDensity?, clusterPatients?, ...}
#* @post /analyze/linear
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
    return(list(
      error = "no_survival",
      message = "Dataset has no clinical metadata for linear modeling"
    ))
  }

  outcome_column <- body$outcomeColumn %||% body$outcome_column %||% "status"
  if (!outcome_column %in% names(ds$survival)) {
    res$status <- 400L
    return(list(
      error = "missing_outcome_column",
      message = sprintf("Clinical data has no column '%s'.", outcome_column),
      eligible_outcome_columns = eligible_outcome_columns(ds$survival)
    ))
  }
  eligible_outcomes <- eligible_outcome_columns(ds$survival)
  eligible_covs <- eligible_covariate_columns(ds$survival, outcome_column)

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
  covariates <- body$covariates %||% character()
  if (is.list(covariates)) covariates <- unlist(covariates)
  dichotomize <- body$dichotomize %||% "none"
  adjust_density <- isTRUE(body$adjustDensity %||% body$adjust_density)
  cluster_patients <- !isFALSE(body$clusterPatients %||% body$cluster_patients)
  min_focal_cells <- as.integer(body$minFocalCells %||% body$min_focal_cells %||% 10L)
  if (min_focal_cells < 1L) min_focal_cells <- 1L

  r_grid <- seq(0, max(2 * radius, 10), length.out = 80L)
  spatial_res <- if (statistic == "K") {
    ripleys_k(ds$cells, type_a = type_a, type_b = type_b, r = r_grid,
              correction = correction, max_cells = cfg()$max_cells_per_sample,
              window_type = window_type, nsim = 0L,
              min_focal_cells = min_focal_cells)
  } else {
    nn_g(ds$cells, type_a = type_a, type_b = type_b, r = r_grid,
         correction = correction, max_cells = cfg()$max_cells_per_sample,
         window_type = window_type, nsim = 0L,
         min_focal_cells = min_focal_cells)
  }
  if (length(spatial_res$per_sample) == 0L) {
    res$status <- 400L
    return(list(
      error = "no_samples_after_filter",
      message = spatial_res$analysis_message %||% sprintf(
        "No samples passed the minimum focal-cell threshold (%d %s cells).",
        min_focal_cells, type_a
      ),
      eligible_outcome_columns = eligible_outcomes,
      eligible_covariate_columns = eligible_covs
    ))
  }

  per_sample_stat <- spatial_summary_at_r(spatial_res, radius = radius,
                                          statistic = statistic)

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

  lin <- tryCatch(
    linear_from_stat(per_sample_stat, ds$survival,
                     outcome_column = outcome_column,
                     covariates = covariates,
                     dichotomize = dichotomize,
                     adjust_density = adjust_density,
                     cluster_id = cluster_id),
    error = function(e) {
      res$status <- 400L
      list(
        error = "linear_failed",
        message = conditionMessage(e),
        eligible_outcome_columns = eligible_outcomes,
        eligible_covariate_columns = eligible_covs
      )
    }
  )
  if (!is.null(lin$error)) return(lin)

  list(
    request = list(
      statistic = statistic,
      radius = radius,
      typeA = type_a,
      typeB = type_b,
      correction = correction,
      window_type = window_type,
      outcome_column = outcome_column,
      covariates = covariates,
      dichotomize = dichotomize,
      adjust_density = adjust_density,
      cluster_patients = cluster_patients,
      min_focal_cells = min_focal_cells
    ),
    stat_summary = per_sample_stat,
    sample_filter = list(
      min_focal_cells = min_focal_cells,
      n_samples_total = spatial_res$n_samples_total,
      n_samples_analyzed = spatial_res$n_samples_analyzed,
      n_samples_excluded = spatial_res$n_samples_excluded
    ),
    eligible_outcome_columns = eligible_outcomes,
    eligible_covariate_columns = eligible_covs,
    linear = lin
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

normalize_form_scalar <- function(x) {
  if (is.null(x) || length(x) == 0L) return(NULL)
  if (is.list(x) && !is.null(x$value)) x <- x$value
  if (length(x) > 1L) x <- x[[1L]]
  ch <- as.character(x)
  if (!nzchar(ch)) return(NULL)
  ch
}

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

part_filename <- function(part) {
  if (is.list(part) && !is.null(part$filename)) return(part$filename)
  NULL
}

is_rds_part <- function(part) {
  fn <- part_filename(part)
  if (!is.null(fn) && grepl("\\.rds$", fn, ignore.case = TRUE)) return(TRUE)
  FALSE
}

is_parquet_part <- function(part) {
  fn <- part_filename(part)
  !is.null(fn) && grepl("\\.parquet$", fn, ignore.case = TRUE)
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
