# Dataset cache — metadata/samples/survival stored in a slim RDS; cells stored
# in a companion Parquet file for columnar efficiency with large datasets.
#
# Layout on disk (new format, arrow available):
#   data-cache/<id>.rds               — meta, samples, survival (no cells)
#   data-cache/<id>_cells.parquet     — cells data.table (columnar, compressed)
#
# Legacy layout (arrow unavailable or pre-migration datasets):
#   data-cache/<id>.rds               — full dataset including cells
#
# The format in use is indicated by ds$meta$.cells_parquet = TRUE in the RDS.
# All public functions (save/load/delete/list) handle both layouts transparently.
#
# A dataset list has these slots:
#   meta     : list(id, title, source, cancer_type, tissue, n_cells,
#                   sample_count, created_at, ...)
#   samples  : data.frame(sample_id, patient_id, n_cells, x_range, y_range)
#   cells    : data.table(sample_id, x, y, cell_type, phenotypes...)
#   survival : data.frame(sample_id, patient_id, time, status, ...covariates)

ensure_cache_dir <- function() {
  dir <- cfg()$data_cache
  if (!dir.exists(dir)) dir.create(dir, recursive = TRUE, showWarnings = FALSE)
  dir
}

dataset_path <- function(id) {
  file.path(ensure_cache_dir(), paste0(id, ".rds"))
}

# Path to the companion Parquet file that stores the cells table.
cells_parquet_path <- function(id) {
  file.path(ensure_cache_dir(), paste0(id, "_cells.parquet"))
}

# TRUE when the dataset has a Parquet cells file on disk.
.has_parquet_cells <- function(id) {
  file.exists(cells_parquet_path(id))
}

# ---------------------------------------------------------------------------
# save_dataset
#
# Writes cells to a Parquet file and metadata/samples/survival to a slim RDS
# when the `arrow` package is available. Falls back to a monolithic RDS
# otherwise (fully backward-compatible on read).
# ---------------------------------------------------------------------------
save_dataset <- function(dataset) {
  if (is.null(dataset$meta) || is.null(dataset$meta$id)) {
    stop("dataset$meta$id is required to save", call. = FALSE)
  }
  id    <- dataset$meta$id
  cells <- dataset$cells

  if (!is.null(cells) && nrow(cells) > 0L &&
      requireNamespace("arrow", quietly = TRUE)) {
    # Write cells as columnar Parquet (better compression + column-pruning reads)
    arrow::write_parquet(
      as.data.frame(cells),
      cells_parquet_path(id),
      compression = "snappy"
    )
    # Keep only non-cell slots in the RDS (much smaller, faster to list)
    ds_slim          <- dataset
    ds_slim$cells    <- NULL
    ds_slim$meta$.cells_parquet <- TRUE
    saveRDS(ds_slim, dataset_path(id))
  } else {
    # Fallback: monolithic RDS (no arrow or empty cells table)
    dataset$meta$.cells_parquet <- NULL
    saveRDS(dataset, dataset_path(id))
  }

  invisible(dataset)
}

# ---------------------------------------------------------------------------
# load_dataset
#
# Transparently reconstructs a full dataset list regardless of on-disk layout.
# For Parquet-backed datasets the cells table is read from the companion
# Parquet file; for legacy RDS datasets cells come from within the RDS.
# ---------------------------------------------------------------------------
load_dataset <- function(id) {
  path <- dataset_path(id)
  if (!file.exists(path)) {
    if (id %in% c("vpd-lung", "vpd-ovarian")) {
      return(load_vpd_dataset(id))
    }
    stop(sprintf("Dataset '%s' not found", id), call. = FALSE)
  }

  ds <- readRDS(path)

  if (isTRUE(ds$meta$.cells_parquet)) {
    cp <- cells_parquet_path(id)
    if (file.exists(cp) && requireNamespace("arrow", quietly = TRUE)) {
      ds$cells <- data.table::as.data.table(arrow::read_parquet(cp))
    } else if (!file.exists(cp)) {
      warning(sprintf(
        "Parquet cells file missing for dataset '%s'; cells will be empty.", id
      ))
      ds$cells <- data.table::data.table()
    }
  }

  ds
}

# ---------------------------------------------------------------------------
# load_cells_filtered
#
# Arrow-optimised cell loading with predicate pushdown and column pruning.
# Returns list(cells = data.table, n_total = integer) for Parquet-backed
# datasets, or NULL to signal the caller to fall back to load_dataset().
#
# When `dplyr` is installed, Arrow pushes filter predicates into the Parquet
# scan so only matching row-groups are read from disk.  When dplyr is absent
# the full Parquet is read into memory and filtered in R — still faster than
# RDS for wide tables because unused phenotype columns are never materialised
# (arrow::read_parquet with col_select).
# ---------------------------------------------------------------------------
load_cells_filtered <- function(id,
                                 sample_id_filter = NULL,
                                 cell_type_filter = NULL) {
  cp   <- cells_parquet_path(id)
  path <- dataset_path(id)

  if (!file.exists(cp) || !requireNamespace("arrow", quietly = TRUE)) {
    return(NULL)
  }

  if (!file.exists(path)) return(NULL)
  ds_slim  <- readRDS(path)
  n_total  <- ds_slim$meta$n_cells %||% NA_integer_

  cells <- tryCatch({
    if (requireNamespace("dplyr", quietly = TRUE)) {
      # Full predicate pushdown: Arrow reads only matching row-groups
      q <- arrow::open_dataset(cp)
      if (!is.null(sample_id_filter) && nzchar(sample_id_filter)) {
        sid <- sample_id_filter
        q   <- dplyr::filter(q, .data[["sample_id"]] == sid)
      }
      if (!is.null(cell_type_filter) && length(cell_type_filter) > 0L) {
        ct <- cell_type_filter
        q  <- dplyr::filter(q, .data[["cell_type"]] %in% ct)
      }
      data.table::as.data.table(dplyr::collect(q))
    } else {
      # Column-pruning path: skip phenotype columns for the plot query.
      # tidyselect::all_of() is safe to call here — tidyselect is an arrow
      # dependency and does not require dplyr.
      plot_cols <- c("sample_id", "x", "y", "cell_type")
      avail     <- names(arrow::open_dataset(cp)$schema)
      sel_cols  <- intersect(plot_cols, avail)
      dt <- data.table::as.data.table(
        arrow::read_parquet(cp, col_select = tidyselect::all_of(sel_cols))
      )
      if (!is.null(sample_id_filter) && nzchar(sample_id_filter)) {
        dt <- dt[get("sample_id") == sample_id_filter]
      }
      if (!is.null(cell_type_filter) && length(cell_type_filter) > 0L) {
        dt <- dt[get("cell_type") %in% cell_type_filter]
      }
      dt
    }
  }, error = function(e) {
    warning(sprintf("Arrow cells load failed for '%s': %s", id, e$message))
    NULL
  })

  if (is.null(cells)) return(NULL)
  list(cells = cells, n_total = n_total)
}

dataset_exists <- function(id) {
  file.exists(dataset_path(id)) || id %in% c("vpd-lung", "vpd-ovarian")
}

# Delete a user-uploaded dataset (both RDS and Parquet). Returns TRUE if the
# RDS was removed, FALSE otherwise. Bundled VPD demos are protected.
delete_dataset <- function(id) {
  if (id %in% c("vpd-lung", "vpd-ovarian")) {
    stop("Cannot delete bundled VPD demo dataset", call. = FALSE)
  }
  path <- dataset_path(id)
  if (!file.exists(path)) return(FALSE)

  # Remove companion Parquet file if present
  cp <- cells_parquet_path(id)
  if (file.exists(cp)) file.remove(cp)

  file.remove(path)
}

# List all known datasets.  With the new Parquet layout the RDS files contain
# only metadata (no cells), so this is significantly faster for large cohorts.
list_datasets <- function() {
  files   <- list.files(ensure_cache_dir(), pattern = "\\.rds$", full.names = TRUE)
  on_disk <- lapply(files, function(p) {
    ds <- tryCatch(readRDS(p), error = function(e) NULL)
    if (is.null(ds)) return(NULL)
    summarize_dataset_meta(ds)
  })
  on_disk <- Filter(Negate(is.null), on_disk)

  ids_on_disk <- vapply(on_disk, function(d) d$id, character(1))
  demos <- list()
  if (isTRUE(cfg()$enable_vpd)) {
    for (demo_id in c("vpd-lung", "vpd-ovarian")) {
      if (demo_id %in% ids_on_disk) next
      demos[[length(demos) + 1L]] <- vpd_meta_stub(demo_id)
    }
  }

  c(on_disk, demos)
}

summarize_dataset_meta <- function(ds) {
  m <- ds$meta
  list(
    id           = m$id,
    title        = m$title %||% m$id,
    source       = m$source %||% "upload",
    cancer_type  = m$cancer_type %||% NA_character_,
    tissue       = m$tissue %||% NA_character_,
    n_cells      = m$n_cells %||% (if (!is.null(ds$cells)) nrow(ds$cells) else 0L),
    sample_count = m$sample_count %||% (if (!is.null(ds$samples)) nrow(ds$samples) else 0L),
    has_survival = !is.null(ds$survival) && nrow(ds$survival) > 0L,
    cell_types   = m$cell_types %||% unique_cell_types(ds),
    created_at   = m$created_at %||% NA_character_
  )
}

unique_cell_types <- function(ds) {
  if (is.null(ds$cells) || !"cell_type" %in% names(ds$cells)) return(character())
  sort(unique(as.character(ds$cells$cell_type)))
}

vpd_meta_stub <- function(id) {
  if (id == "vpd-lung") {
    list(
      id           = "vpd-lung",
      title        = "Human Lung Cancer (VectraPolarisData)",
      source       = "vpd",
      cancer_type  = "Non-Small Cell Lung Cancer",
      tissue       = "Lung",
      n_cells      = NA_integer_,
      sample_count = NA_integer_,
      has_survival = TRUE,
      cell_types   = character(),
      created_at   = NA_character_,
      lazy         = TRUE
    )
  } else {
    list(
      id           = "vpd-ovarian",
      title        = "Human Ovarian Cancer (VectraPolarisData)",
      source       = "vpd",
      cancer_type  = "Ovarian Cancer",
      tissue       = "Ovary",
      n_cells      = NA_integer_,
      sample_count = NA_integer_,
      has_survival = TRUE,
      cell_types   = character(),
      created_at   = NA_character_,
      lazy         = TRUE
    )
  }
}
