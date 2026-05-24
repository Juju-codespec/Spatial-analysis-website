# RDS-backed dataset cache.
#
# A dataset is a list with these slots:
#   meta     : list(id, title, source, cancer_type, tissue, n_cells,
#                   sample_count, created_at, ...)
#   samples  : data.frame(sample_id, patient_id, n_cells, x_range, y_range)
#   cells    : data.table(sample_id, x, y, cell_type, phenotypes...)
#   survival : data.frame(sample_id, patient_id, time, status, ...covariates)
#
# Cache files live under `cfg()$data_cache/<id>.rds`. The `vpd-lung` and
# `vpd-ovarian` ids are reserved for the bundled Bioconductor cohorts.

ensure_cache_dir <- function() {
  dir <- cfg()$data_cache
  if (!dir.exists(dir)) dir.create(dir, recursive = TRUE, showWarnings = FALSE)
  dir
}

dataset_path <- function(id) {
  file.path(ensure_cache_dir(), paste0(id, ".rds"))
}

save_dataset <- function(dataset) {
  if (is.null(dataset$meta) || is.null(dataset$meta$id)) {
    stop("dataset$meta$id is required to save", call. = FALSE)
  }
  saveRDS(dataset, dataset_path(dataset$meta$id))
  invisible(dataset)
}

load_dataset <- function(id) {
  path <- dataset_path(id)
  if (!file.exists(path)) {
    # VPD demos lazy-load on first access.
    if (id %in% c("vpd-lung", "vpd-ovarian")) {
      return(load_vpd_dataset(id))
    }
    stop(sprintf("Dataset '%s' not found", id), call. = FALSE)
  }
  readRDS(path)
}

dataset_exists <- function(id) {
  file.exists(dataset_path(id)) || id %in% c("vpd-lung", "vpd-ovarian")
}

# Delete a user-uploaded dataset from the on-disk cache. Returns TRUE if a
# file was removed, FALSE otherwise. Bundled VPD demos are protected — the
# endpoint should refuse to delete them.
delete_dataset <- function(id) {
  if (id %in% c("vpd-lung", "vpd-ovarian")) {
    stop("Cannot delete bundled VPD demo dataset", call. = FALSE)
  }
  path <- dataset_path(id)
  if (!file.exists(path)) return(FALSE)
  file.remove(path)
}

list_datasets <- function() {
  files <- list.files(ensure_cache_dir(), pattern = "\\.rds$", full.names = TRUE)
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
