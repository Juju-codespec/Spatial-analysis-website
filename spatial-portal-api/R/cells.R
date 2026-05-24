# Cell-level data ingestion.
#
# Supports two input paths:
#   1. The Bioconductor `VectraPolarisData` package (lazy demo cohorts).
#   2. User-uploaded CSV/TSV files in the multi-phenotype layout produced by
#      Vectra Polaris (matching the frontend's PHENOTYPE_MAP).

# Phenotype -> cell type priority table. Mirrors PHENOTYPE_MAP in
# spatial-portal/src/utils/cellParser.ts so the same labels flow end-to-end.
PHENOTYPE_MAP <- data.table::data.table(
  marker    = c("cd8", "cd4", "cd3", "cd68", "cd163",
                "cd19", "cd20", "cd56", "ck", "panck",
                "epcam", "fap", "asma", "sma"),
  cell_type = c("CD8+ T Cell", "CD4+ T Cell", "T Cell", "Macrophage", "Macrophage",
                "B Cell", "B Cell", "NK Cell", "Tumor", "Tumor",
                "Tumor", "CAF", "CAF", "CAF")
)

T_CELL_TYPES <- c("T Cell", "CD4+ T Cell", "CD8+ T Cell")

# ---- VPD loaders -----------------------------------------------------------

#' Load and cache one of the bundled VectraPolarisData cohorts.
#' @param id One of "vpd-lung", "vpd-ovarian".
#' @return The dataset list (also persisted to disk).
load_vpd_dataset <- function(id) {
  stopifnot(id %in% c("vpd-lung", "vpd-ovarian"))

  if (file.exists(dataset_path(id))) return(readRDS(dataset_path(id)))

  if (!requireNamespace("VectraPolarisData", quietly = TRUE)) {
    stop(
      "Package 'VectraPolarisData' is required for demo cohorts. ",
      "Install via BiocManager::install('VectraPolarisData').",
      call. = FALSE
    )
  }
  if (!requireNamespace("SpatialExperiment", quietly = TRUE)) {
    stop("Package 'SpatialExperiment' is required.", call. = FALSE)
  }

  hub_name <- if (id == "vpd-lung") "HumanLungCancerV3" else "HumanOvarianCancerVP"
  message(sprintf("Loading VectraPolarisData::%s ...", hub_name))
  se <- VectraPolarisData::VectraPolarisData()[[hub_name]]

  ds <- spe_to_dataset(se, id = id, title = vpd_meta_stub(id)$title,
                       cancer_type = vpd_meta_stub(id)$cancer_type,
                       tissue = vpd_meta_stub(id)$tissue)
  save_dataset(ds)
  ds
}

#' Convert a SpatialExperiment from VectraPolarisData into our dataset list.
#' @noRd
spe_to_dataset <- function(se, id, title, cancer_type, tissue) {
  if (!requireNamespace("SpatialExperiment", quietly = TRUE)) {
    stop("SpatialExperiment is required", call. = FALSE)
  }
  coords <- SpatialExperiment::spatialCoords(se)
  cd <- as.data.frame(SummarizedExperiment::colData(se))

  # VPD column names: cell_x_position / cell_y_position, sample_id, slide_id,
  # plus phenotype_cd3, phenotype_cd8, etc. Defensive fallbacks below.
  x <- coalesce_col(coords, cd, c("Cell.X.Position", "cell_x_position", "x"))
  y <- coalesce_col(coords, cd, c("Cell.Y.Position", "cell_y_position", "y"))

  sample_id <- pick_col(cd, c("sample_id", "slide_id", "image_id"),
                        default = "sample_1")
  patient_col <- pick_col_name(cd, c("patient_id", "subject_id"))
  patient_id <- if (is.null(patient_col)) sample_id else cd[[patient_col]]

  phen_cols <- grep("^phenotype_", names(cd), value = TRUE, ignore.case = TRUE)
  # Map phenotype columns into a single cell_type using PHENOTYPE_MAP priority.
  pheno_df <- cd[, phen_cols, drop = FALSE]
  cell_type <- derive_cell_type(pheno_df)

  cells <- data.table::data.table(
    sample_id  = as.character(sample_id),
    patient_id = as.character(patient_id),
    x          = as.numeric(x),
    y          = as.numeric(y),
    cell_type  = cell_type
  )

  # Preserve raw phenotype booleans (0/1) for downstream filtering.
  for (col in phen_cols) {
    raw <- as.character(pheno_df[[col]])
    cells[[col]] <- as.integer(grepl("\\+$", raw))
  }

  cells <- cells[!is.na(x) & !is.na(y)]

  samples <- build_sample_summary(cells)

  surv <- extract_vpd_survival(se, samples)

  list(
    meta = list(
      id           = id,
      title        = title,
      source       = "vpd",
      cancer_type  = cancer_type,
      tissue       = tissue,
      n_cells      = nrow(cells),
      sample_count = nrow(samples),
      cell_types   = sort(unique(cells$cell_type)),
      created_at   = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC")
    ),
    samples  = samples,
    cells    = cells,
    survival = surv
  )
}

extract_vpd_survival <- function(se, samples) {
  meta_list <- S4Vectors::metadata(se)
  patient_df <- NULL
  for (slot in names(meta_list)) {
    candidate <- meta_list[[slot]]
    if (is.data.frame(candidate) || inherits(candidate, "DataFrame")) {
      patient_df <- as.data.frame(candidate)
      break
    }
  }
  if (is.null(patient_df)) {
    return(data.frame())
  }

  time_col <- pick_col_name(patient_df,
                            c("survival_days", "survival_time", "os_time",
                              "time", "follow_up"))
  status_col <- pick_col_name(patient_df,
                              c("survival_status", "death", "event",
                                "os_status", "status"))
  id_col <- pick_col_name(patient_df,
                          c("patient_id", "subject_id", "sample_id",
                            "slide_id"))

  if (is.null(time_col) || is.null(status_col) || is.null(id_col)) {
    return(data.frame())
  }

  surv <- data.frame(
    patient_id = as.character(patient_df[[id_col]]),
    time       = as.numeric(patient_df[[time_col]]),
    status     = coerce_status(patient_df[[status_col]]),
    stringsAsFactors = FALSE
  )

  extra_cols <- setdiff(names(patient_df), c(id_col, time_col, status_col))
  for (col in extra_cols) surv[[col]] <- patient_df[[col]]

  # Join through samples so each sample inherits its patient outcome.
  if ("patient_id" %in% names(samples)) {
    surv <- merge(samples[, c("sample_id", "patient_id")],
                  surv, by = "patient_id", all.x = TRUE)
  }
  surv
}

coerce_status <- function(x) {
  if (is.logical(x)) return(as.integer(x))
  if (is.numeric(x)) return(as.integer(x > 0))
  ch <- tolower(as.character(x))
  ifelse(ch %in% c("1", "dead", "deceased", "death", "yes", "true", "event"),
         1L, 0L)
}

# ---- CSV upload parser -----------------------------------------------------

#' Parse a Vectra-style cell CSV/TSV uploaded by the user.
#'
#' Required columns: x and y (numeric). Phenotype assignment uses any
#' `phenotype_*` columns present, falling back to a `cell_type` column if
#' provided. A `sample_id` column is optional; missing values default to
#' "sample_1".
parse_cells_csv <- function(path) {
  if (!file.exists(path)) {
    stop(sprintf("File not found: %s", path), call. = FALSE)
  }
  sep <- if (grepl("\\.tsv$", path, ignore.case = TRUE)) "\t" else ","

  df <- tryCatch(
    vroom::vroom(path, delim = sep, show_col_types = FALSE,
                 .name_repair = "minimal"),
    error = function(e) stop(sprintf("Failed to read CSV: %s", e$message),
                             call. = FALSE)
  )
  if (nrow(df) == 0L) stop("CSV contains no rows", call. = FALSE)

  cols <- tolower(names(df))
  names(df) <- cols

  x_col <- pick_col_name(df, c("x", "cell_x_position", "cell.x.position",
                               "x_centroid", "cell_x"))
  y_col <- pick_col_name(df, c("y", "cell_y_position", "cell.y.position",
                               "y_centroid", "cell_y"))
  if (is.null(x_col) || is.null(y_col)) {
    stop("Required x/y coordinate columns not found.", call. = FALSE)
  }

  sample_col <- pick_col_name(df, c("sample_id", "slide_id", "image_id"))
  patient_col <- pick_col_name(df, c("patient_id", "subject_id"))

  phen_cols <- grep("^phenotype_", names(df), value = TRUE)
  if (length(phen_cols) > 0L) {
    cell_type <- derive_cell_type(df[, phen_cols, drop = FALSE])
  } else {
    ct_col <- pick_col_name(df, c("cell_type", "phenotype", "celltype"))
    if (is.null(ct_col)) {
      stop("No phenotype_* columns and no cell_type column found.",
           call. = FALSE)
    }
    cell_type <- as.character(df[[ct_col]])
  }

  cells <- data.table::data.table(
    sample_id  = if (!is.null(sample_col)) as.character(df[[sample_col]]) else "sample_1",
    patient_id = if (!is.null(patient_col)) as.character(df[[patient_col]]) else NA_character_,
    x          = as.numeric(df[[x_col]]),
    y          = as.numeric(df[[y_col]]),
    cell_type  = cell_type
  )
  if (all(is.na(cells$patient_id))) cells$patient_id <- cells$sample_id

  for (col in phen_cols) {
    raw <- as.character(df[[col]])
    cells[[col]] <- as.integer(grepl("\\+$", raw) | raw %in% c("1", "TRUE", "true"))
  }

  cells <- cells[!is.na(x) & !is.na(y)]
  if (nrow(cells) == 0L) stop("No valid rows after parsing.", call. = FALSE)
  cells
}

#' Parse a survival metadata CSV. Required columns: time, status; plus
#' sample_id or patient_id to link to cells.
parse_survival_csv <- function(path) {
  if (!file.exists(path)) {
    stop(sprintf("File not found: %s", path), call. = FALSE)
  }
  sep <- if (grepl("\\.tsv$", path, ignore.case = TRUE)) "\t" else ","
  df <- vroom::vroom(path, delim = sep, show_col_types = FALSE,
                     .name_repair = "minimal")
  names(df) <- tolower(names(df))

  id_col <- pick_col_name(df, c("sample_id", "patient_id", "subject_id"))
  time_col <- pick_col_name(df, c("time", "survival_days", "survival_time",
                                  "os_time"))
  status_col <- pick_col_name(df, c("status", "event", "death",
                                    "survival_status", "os_status"))
  if (is.null(id_col) || is.null(time_col) || is.null(status_col)) {
    stop("Survival CSV must include id (sample_id/patient_id), time, status.",
         call. = FALSE)
  }

  out <- data.frame(
    sample_id = as.character(df[[id_col]]),
    time      = as.numeric(df[[time_col]]),
    status    = coerce_status(df[[status_col]]),
    stringsAsFactors = FALSE
  )
  extras <- setdiff(names(df), c(id_col, time_col, status_col))
  for (col in extras) out[[col]] <- df[[col]]
  out
}

#' Assemble a dataset list from a freshly uploaded cells (and optional
#' survival) data frame.
build_uploaded_dataset <- function(id, title, cells, survival = NULL,
                                   cancer_type = NA_character_,
                                   tissue = NA_character_) {
  stopifnot(data.table::is.data.table(cells))
  samples <- build_sample_summary(cells)

  surv_df <- if (!is.null(survival)) {
    # Make sure every survival row maps to a sample we have cells for.
    keep <- survival$sample_id %in% samples$sample_id |
            survival$sample_id %in% samples$patient_id
    survival[keep, , drop = FALSE]
  } else {
    data.frame()
  }

  list(
    meta = list(
      id           = id,
      title        = title,
      source       = "upload",
      cancer_type  = cancer_type,
      tissue       = tissue,
      n_cells      = nrow(cells),
      sample_count = nrow(samples),
      cell_types   = sort(unique(cells$cell_type)),
      created_at   = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC")
    ),
    samples  = samples,
    cells    = cells,
    survival = surv_df
  )
}

# ---- Internal helpers ------------------------------------------------------

build_sample_summary <- function(cells) {
  if (nrow(cells) == 0L) return(data.frame())
  samples <- cells[, list(
    n_cells = .N,
    x_min   = min(x), x_max = max(x),
    y_min   = min(y), y_max = max(y),
    patient_id = patient_id[1]
  ), by = sample_id]
  as.data.frame(samples)
}

#' Derive a single cell-type label per row from boolean phenotype columns.
#' First positive marker in PHENOTYPE_MAP priority order wins; otherwise "Other".
derive_cell_type <- function(pheno_df) {
  n <- nrow(pheno_df)
  if (n == 0L) return(character())
  out <- rep("Other", n)
  if (length(pheno_df) == 0L) return(out)

  lower_names <- tolower(names(pheno_df))
  # PHENOTYPE_MAP is in priority order; iterate and only fill cells still "Other"
  for (i in seq_len(nrow(PHENOTYPE_MAP))) {
    marker <- PHENOTYPE_MAP$marker[i]
    target <- PHENOTYPE_MAP$cell_type[i]
    col_idx <- which(lower_names == paste0("phenotype_", marker))
    if (length(col_idx) == 0L) next
    raw <- as.character(pheno_df[[col_idx[1]]])
    positive <- grepl("\\+$", raw) | raw %in% c("1", "TRUE", "true")
    mask <- positive & out == "Other"
    if (any(mask)) out[mask] <- target
  }
  out
}

coalesce_col <- function(coords, cd, candidates) {
  for (name in candidates) {
    if (!is.null(coords) && name %in% colnames(coords)) {
      return(as.numeric(coords[, name]))
    }
    if (name %in% names(cd)) return(as.numeric(cd[[name]]))
  }
  rep(NA_real_, max(nrow(coords %||% cd), nrow(cd)))
}

pick_col <- function(df, candidates, default = NA_character_) {
  name <- pick_col_name(df, candidates)
  if (is.null(name)) return(rep(default, nrow(df)))
  df[[name]]
}

pick_col_name <- function(df, candidates) {
  lower_to_actual <- setNames(names(df), tolower(names(df)))
  for (cand in candidates) {
    hit <- lower_to_actual[tolower(cand)]
    if (!is.na(hit)) return(unname(hit))
  }
  NULL
}
