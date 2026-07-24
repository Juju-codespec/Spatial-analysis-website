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

  if (file.exists(dataset_path(id))) {
    ds <- load_dataset(id)
    changed <- FALSE
    if (id == "vpd-ovarian" && "sex" %in% names(ds$survival)) {
      ds$survival$sex <- NULL
      changed <- TRUE
    }
    enriched <- enrich_vpd_clinical(ds$survival, id)
    if (!identical(enriched, ds$survival)) {
      ds$survival <- enriched
      changed <- TRUE
    }
    if (changed) save_dataset(ds)
    return(ds)
  }

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
  message(sprintf("Loading VectraPolarisData::%s() ...", hub_name))
  se <- if (id == "vpd-lung") {
    VectraPolarisData::HumanLungCancerV3()
  } else {
    VectraPolarisData::HumanOvarianCancerVP()
  }

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

  tissue_col <- pick_col_name(cd, c("tissue_category", "tissue.region",
                                    "tissue_region"))

  cells <- data.table::data.table(
    sample_id  = as.character(sample_id),
    patient_id = as.character(patient_id),
    x          = as.numeric(x),
    y          = as.numeric(y),
    cell_type  = cell_type
  )
  if (!is.null(tissue_col)) {
    cells$tissue_category <- as.character(cd[[tissue_col]])
  }

  # Preserve raw phenotype booleans (0/1) for downstream filtering.
  for (col in phen_cols) {
    raw <- as.character(pheno_df[[col]])
    cells[[col]] <- as.integer(grepl("\\+$", raw))
  }

  cells <- cells[!is.na(x) & !is.na(y)]

  samples <- build_sample_summary(cells)

  surv <- enrich_vpd_clinical(extract_vpd_survival(se, samples), id)

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

#' Enrich bundled VPD clinical metadata (aliases, optional supplements).
#'
#' Lung cohorts ship `gender` (M/F), mapped to `sex`. Ovarian metadata has no
#' sex field. Race is not in VectraPolarisData but can be merged from
#' `inst/extdata/vpd_ovarian_race.csv` or `VPD_OVARIAN_RACE_CSV`.
enrich_vpd_clinical <- function(surv, id = NULL) {
  if (is.null(surv) || nrow(surv) == 0L) {
    return(surv)
  }
  if (!"sex" %in% names(surv) && "gender" %in% names(surv)) {
    surv$sex <- as.character(surv$gender)
  }
  if (!"race" %in% names(surv) && "ethnicity" %in% names(surv)) {
    surv$race <- as.character(surv$ethnicity)
  }
  if (!is.null(id) && id == "vpd-ovarian" && !"race" %in% names(surv)) {
    surv <- merge_ovarian_race_from_sources(surv)
  }
  surv
}

#' Merge race/ethnicity into ovarian VPD survival from optional local sources.
merge_ovarian_race_from_sources <- function(surv) {
  sup_path <- vpd_ovarian_race_supplement_path()
  if (nzchar(sup_path) && file.exists(sup_path)) {
    return(merge_clinical_supplement(surv, sup_path, columns = "race"))
  }
  for (path in ovarian_clinical_source_paths()) {
    if (!file.exists(path)) next
    merged <- merge_ovarian_race_from_clinical_file(surv, path)
    if ("race" %in% names(merged)) {
      return(merged)
    }
  }
  surv
}

ovarian_clinical_source_paths <- function() {
  root <- here_root()
  c(
    file.path(root, "data", "ovarian", "Ovarian_clinical.csv"),
    file.path(root, "inst", "extdata", "Ovarian_clinical.csv")
  )
}

#' Extract race from the full Ovarian_clinical.csv used to build VectraPolarisData.
merge_ovarian_race_from_clinical_file <- function(surv, path) {
  if (is.null(surv) || nrow(surv) == 0L || !"sample_id" %in% names(surv)) {
    return(surv)
  }
  raw <- utils::read.csv(path, stringsAsFactors = FALSE, check.names = FALSE)
  if (nrow(raw) == 0L) {
    return(surv)
  }
  names(raw) <- gsub("[^a-z0-9_]+", "_", tolower(names(raw)))
  names(raw) <- gsub("_+", "_", names(raw))
  names(raw) <- gsub("^_|_$", "", names(raw))

  race_col <- pick_col_name(raw, c("race", "ethnicity", "race_ethnicity",
                                   "race_ethnic_group"))
  sample_col <- pick_col_name(raw, c("sample_name", "sample_id"))
  if (is.null(race_col) || is.null(sample_col)) {
    return(surv)
  }

  sid <- as.character(raw[[sample_col]])
  sid <- ifelse(is.na(sid), NA_character_,
                paste0("030120 P9HuP6 TMA 1-", sid))
  lookup <- stats::setNames(as.character(raw[[race_col]]), sid)
  vals <- lookup[surv$sample_id]
  if (all(is.na(vals))) {
    return(surv)
  }
  surv$race <- vals
  surv
}

#' Path to optional ovarian race supplement (sample_id + race).
vpd_ovarian_race_supplement_path <- function() {
  cfg <- cfg()
  if (nzchar(cfg$vpd_ovarian_race_csv)) {
    return(cfg$vpd_ovarian_race_csv)
  }
  file.path(here_root(), "inst", "extdata", "vpd_ovarian_race.csv")
}

#' Merge extra clinical columns from a CSV onto survival rows by sample_id.
merge_clinical_supplement <- function(surv, path, columns = NULL) {
  if (is.null(surv) || nrow(surv) == 0L || !file.exists(path)) {
    return(surv)
  }
  sup <- utils::read.csv(path, stringsAsFactors = FALSE, check.names = FALSE)
  names(sup) <- tolower(names(sup))
  id_col <- pick_col_name(sup, c("sample_id", "patient_id", "slide_id"))
  if (is.null(id_col)) {
    return(surv)
  }
  sup[[id_col]] <- as.character(sup[[id_col]])
  if (!is.null(columns)) {
    columns <- tolower(as.character(columns))
    keep <- intersect(columns, names(sup))
    if (length(keep) == 0L && "race" %in% columns) {
      keep <- intersect(c("race", "ethnicity", "race_ethnicity"), names(sup))
      if (length(keep) > 0L && !"race" %in% names(sup)) {
        sup$race <- sup[[keep[[1L]]]]
        keep <- "race"
      }
    }
    if (length(keep) == 0L) {
      return(surv)
    }
    sup <- sup[, c(id_col, keep), drop = FALSE]
  } else {
    sup <- sup[, setdiff(names(sup), id_col), drop = FALSE]
    sup <- cbind(data.frame(sample_id = sup[[id_col]]), sup)
    names(sup)[1L] <- "sample_id"
    sup[[id_col]] <- NULL
    id_col <- "sample_id"
  }
  if (!"sample_id" %in% names(surv)) {
    return(surv)
  }
  merge_cols <- setdiff(names(sup), id_col)
  if (length(merge_cols) == 0L) {
    return(surv)
  }
  idx <- match(surv$sample_id, sup[[id_col]])
  for (col in merge_cols) {
    vals <- sup[[col]][idx]
    if (col %in% names(surv)) {
      fill <- is.na(surv[[col]]) | surv[[col]] == ""
      surv[[col]][fill] <- vals[fill]
    } else {
      surv[[col]] <- vals
    }
  }
  surv
}

#' Merge uploaded clinical rows into an existing survival table.
#'
#' When the upload omits `time`/`status`, treat it as a column supplement keyed
#' on `sample_id` (or `patient_id`). Full survival uploads replace the table.
merge_survival_clinical <- function(existing, incoming) {
  if (is.null(existing) || nrow(existing) == 0L) {
    return(incoming)
  }
  if (is.null(incoming) || nrow(incoming) == 0L) {
    return(existing)
  }
  is_full <- all(c("time", "status") %in% names(incoming))
  if (is_full) {
    return(incoming)
  }
  key <- if ("sample_id" %in% names(incoming)) {
    "sample_id"
  } else if ("patient_id" %in% names(incoming)) {
    "patient_id"
  } else {
    return(incoming)
  }
  add_cols <- setdiff(names(incoming), key)
  if (length(add_cols) == 0L) {
    return(existing)
  }
  idx <- match(existing[[key]], incoming[[key]])
  for (col in add_cols) {
    vals <- incoming[[col]][idx]
    if (col %in% names(existing)) {
      fill <- is.na(existing[[col]]) | existing[[col]] == ""
      existing[[col]][fill] <- vals[fill]
    } else {
      existing[[col]] <- vals
    }
  }
  existing
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

# ---- CSV / table upload parser ---------------------------------------------

#' Parse a cell-level table (data.frame) into the portal cells schema.
#'
#' Required columns: x and y (numeric). Phenotype assignment uses any
#' `phenotype_*` columns present, falling back to a `cell_type` column if
#' provided. Uses `sample_id` when present; otherwise `patient_id` / `slide_id`.
parse_cells_table <- function(df) {
  if (nrow(df) == 0L) stop("Table contains no rows", call. = FALSE)
  df <- as.data.frame(df)
  names(df) <- tolower(names(df))

  x_col <- pick_col_name(df, c("x", "cell_x_position", "cell.x.position",
                               "x_centroid", "cell_x"))
  y_col <- pick_col_name(df, c("y", "cell_y_position", "cell.y.position",
                               "y_centroid", "cell_y"))
  if (is.null(x_col) || is.null(y_col)) {
    stop("Required x/y coordinate columns not found.", call. = FALSE)
  }

  sample_col <- pick_col_name(df, c("sample_id", "slide_id", "image_id"))
  patient_col <- pick_col_name(df, c("patient_id", "subject_id"))
  if (is.null(sample_col) && !is.null(patient_col)) {
    sample_col <- patient_col
  }

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

  tissue_col <- pick_col_name(df, c("tissue_category", "tissue.region",
                                    "tissue_region"))

  cells <- data.table::data.table(
    sample_id  = if (!is.null(sample_col)) as.character(df[[sample_col]]) else "sample_1",
    patient_id = if (!is.null(patient_col)) as.character(df[[patient_col]]) else NA_character_,
    x          = as.numeric(df[[x_col]]),
    y          = as.numeric(df[[y_col]]),
    cell_type  = cell_type
  )
  if (!is.null(tissue_col)) {
    cells$tissue_category <- as.character(df[[tissue_col]])
  }
  if (all(is.na(cells$patient_id))) cells$patient_id <- cells$sample_id

  for (col in phen_cols) {
    raw <- as.character(df[[col]])
    cells[[col]] <- as.integer(grepl("\\+$", raw) | raw %in% c("1", "TRUE", "true"))
  }

  cells <- cells[!is.na(x) & !is.na(y)]
  if (nrow(cells) == 0L) stop("No valid rows after parsing.", call. = FALSE)
  cells
}

#' Parse a Parquet file uploaded by the user.
#'
#' Requires the `arrow` package. The file must contain x/y coordinates and
#' either `phenotype_*` columns or a `cell_type` column, matching the same
#' schema expected by `parse_cells_csv`.
parse_cells_parquet <- function(path) {
  if (!requireNamespace("arrow", quietly = TRUE)) {
    stop(
      "Package 'arrow' is required to read Parquet files. ",
      "Install with: install.packages('arrow')",
      call. = FALSE
    )
  }
  if (!file.exists(path)) {
    stop(sprintf("Parquet file not found: %s", path), call. = FALSE)
  }
  df <- tryCatch(
    as.data.frame(arrow::read_parquet(path)),
    error = function(e) {
      stop(sprintf("Failed to read Parquet: %s", e$message), call. = FALSE)
    }
  )
  if (nrow(df) == 0L) stop("Parquet file contains no rows", call. = FALSE)
  parse_cells_table(df)
}

#' Parse a Vectra-style cell CSV/TSV uploaded by the user.
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
  parse_cells_table(df)
}

#' Normalize a survival table to `sample_id`, `time`, `status` (+ covariates).
#'
#' Returns `NULL` when required columns are missing and `stop_on_missing`
#' is FALSE.
parse_survival_table <- function(df, stop_on_missing = TRUE) {
  df <- as.data.frame(df)
  names(df) <- tolower(names(df))

  id_col <- pick_col_name(df, c("sample_id", "patient_id", "subject_id"))
  time_col <- pick_col_name(df, c("time", "survival_days", "survival_time",
                                  "os_time", "futime"))
  status_col <- pick_col_name(df, c("status", "event", "death",
                                    "survival_status", "os_status", "fustat"))
  if (is.null(id_col)) {
    if (stop_on_missing) {
      stop("Survival table must include id (sample_id/patient_id), time, status.",
           call. = FALSE)
    }
    return(NULL)
  }
  if (is.null(time_col) || is.null(status_col)) {
    if (stop_on_missing) {
      stop("Survival table must include id (sample_id/patient_id), time, status.",
           call. = FALSE)
    }
    out <- data.frame(
      sample_id = as.character(df[[id_col]]),
      stringsAsFactors = FALSE
    )
    extras <- setdiff(names(df), id_col)
    for (col in extras) out[[col]] <- df[[col]]
    return(dedupe_survival_by_sample(out))
  }

  out <- data.frame(
    sample_id = as.character(df[[id_col]]),
    time      = as.numeric(df[[time_col]]),
    status    = coerce_status(df[[status_col]]),
    stringsAsFactors = FALSE
  )
  extras <- setdiff(names(df), c(id_col, time_col, status_col))
  for (col in extras) out[[col]] <- df[[col]]
  dedupe_survival_by_sample(out)
}

#' Keep one clinical row per sample_id (cell-level exports often repeat ids).
dedupe_survival_by_sample <- function(surv_df) {
  if (is.null(surv_df) || nrow(surv_df) == 0L) return(surv_df)
  if (!"sample_id" %in% names(surv_df)) return(surv_df)
  surv_df[!duplicated(surv_df$sample_id), , drop = FALSE]
}

#' Extract one survival row per sample/patient from a cell-level table.
extract_survival_from_table <- function(df) {
  surv <- parse_survival_table(df, stop_on_missing = FALSE)
  if (is.null(surv)) return(NULL)
  dedupe_survival_by_sample(surv)
}

#' Parse a clinical supplement CSV (sample_id + covariates, no time/status).
parse_clinical_supplement_csv <- function(path) {
  if (!file.exists(path)) {
    stop(sprintf("File not found: %s", path), call. = FALSE)
  }
  sep <- if (grepl("\\.tsv$", path, ignore.case = TRUE)) "\t" else ","
  df <- vroom::vroom(path, delim = sep, show_col_types = FALSE,
                     .name_repair = "minimal")
  if (nrow(df) == 0L) stop("CSV contains no rows", call. = FALSE)
  out <- parse_survival_table(df, stop_on_missing = FALSE)
  if (is.null(out) || nrow(out) == 0L) {
    stop(
      "Clinical supplement CSV must include sample_id (or patient_id) and at ",
      "least one covariate column (e.g. race).",
      call. = FALSE
    )
  }
  out
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
  parse_survival_table(df, stop_on_missing = TRUE)
}

#' Parse a user-uploaded `.rds` file into a portal dataset list.
#'
#' Accepts:
#'   - `SpatialExperiment` objects (Vectra / Bioconductor layout)
#'   - Portal dataset lists saved via `saveRDS()` (must contain `$cells`)
#'   - Plain cell-level `data.frame`s with x/y and cell_type or phenotype_* cols
parse_rds_upload <- function(path, id, title = NULL,
                             cancer_type = NA_character_,
                             tissue = NA_character_) {
  if (!file.exists(path)) {
    stop(sprintf("RDS file not found: %s", path), call. = FALSE)
  }
  obj <- tryCatch(readRDS(path), error = function(e) {
    stop(sprintf("Failed to read RDS: %s", e$message), call. = FALSE)
  })

  if (inherits(obj, "SpatialExperiment")) {
    ds <- spe_to_dataset(
      obj,
      id = id,
      title = title %||% "RDS upload",
      cancer_type = cancer_type %||% NA_character_,
      tissue = tissue %||% NA_character_
    )
    ds$meta$source <- "upload"
    return(ds)
  }

  if (is.list(obj) && !is.null(obj$cells)) {
    cells <- obj$cells
    if (!data.table::is.data.table(cells)) {
      cells <- data.table::as.data.table(cells)
    }
    if (nrow(cells) == 0L) {
      stop("RDS dataset contains no cells.", call. = FALSE)
    }
    meta <- obj$meta %||% list()
    meta$id <- id
    meta$title <- title %||% meta$title %||% "RDS upload"
    meta$source <- "upload"
    meta$cancer_type <- cancer_type %||% meta$cancer_type %||% NA_character_
    meta$tissue <- tissue %||% meta$tissue %||% NA_character_
    meta$n_cells <- nrow(cells)
    meta$sample_count <- length(unique(cells$sample_id))
    meta$cell_types <- sort(unique(as.character(cells$cell_type)))
    meta$created_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC")

    samples <- obj$samples
    if (is.null(samples) || nrow(samples) == 0L) {
      samples <- build_sample_summary(cells)
    }
    survival <- obj$survival
    if (is.null(survival)) survival <- data.frame()

    return(list(
      meta = meta,
      samples = samples,
      cells = cells,
      survival = survival
    ))
  }

  if (is.data.frame(obj) || data.table::is.data.table(obj)) {
    cells <- tryCatch(parse_cells_table(obj), error = function(e) e)
    if (inherits(cells, "error")) {
      stop(
        paste0(
          conditionMessage(cells),
          " Plain RDS uploads need a cell-level data.frame with x/y coordinates ",
          "and cell_type (or phenotype_*) columns."
        ),
        call. = FALSE
      )
    }
    survival <- extract_survival_from_table(obj)
    return(build_uploaded_dataset(
      id = id,
      title = title %||% "RDS upload",
      cells = cells,
      survival = survival,
      cancer_type = cancer_type %||% NA_character_,
      tissue = tissue %||% NA_character_
    ))
  }

  stop(
    paste0(
      "RDS must contain a SpatialExperiment, a portal dataset with a cells ",
      "table, or a cell-level data.frame with x/y coordinates."
    ),
    call. = FALSE
  )
}

#' Assemble a dataset list from a freshly uploaded cells (and optional
#' survival) data frame.
build_uploaded_dataset <- function(id, title, cells, survival = NULL,
                                   cancer_type = NA_character_,
                                   tissue = NA_character_) {
  stopifnot(data.table::is.data.table(cells))
  samples <- build_sample_summary(cells)

  surv_df <- if (!is.null(survival)) {
    keep <- survival$sample_id %in% samples$sample_id |
            survival$sample_id %in% samples$patient_id
    dedupe_survival_by_sample(survival[keep, , drop = FALSE])
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

#' Return sorted tissue-region labels when a tissue_category column exists.
tissue_region_choices <- function(cells) {
  if (is.null(cells) || nrow(cells) == 0L ||
      !"tissue_category" %in% names(cells)) {
    return(character())
  }
  vals <- unique(as.character(cells$tissue_category))
  vals <- vals[!is.na(vals) & nzchar(vals)]
  sort(vals)
}

#' Restrict cells to one tissue region (Tumor, Stroma, etc.).
filter_cells_by_region <- function(cells, region = NULL) {
  if (is.null(cells) || nrow(cells) == 0L) return(cells)
  if (is.null(region) || !nzchar(as.character(region)) ||
      tolower(as.character(region)) %in% c("all", "any")) {
    return(cells)
  }
  if (!"tissue_category" %in% names(cells)) {
    stop(
      "This dataset has no tissue_category column; region filter is unavailable.",
      call. = FALSE
    )
  }
  region_norm <- tolower(as.character(region))
  keep <- tolower(as.character(cells$tissue_category)) == region_norm
  filtered <- cells[keep]
  if (nrow(filtered) == 0L) {
    stop(sprintf("No cells remain after filtering to tissue region '%s'.",
                 region), call. = FALSE)
  }
  filtered
}
