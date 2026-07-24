# Clinical Analysis: merge user-uploaded clinical metadata with
# image-derived cell counts, percentages, and ratios. Bundled VPD cohorts
# provide imaging; survival, stage, grade, treatment, and recurrence are
# supplied via clinical CSV upload. Optional spatial clustering predictors
# can be attached when requested.

sanitize_feature_name <- function(x) {
  out <- gsub("\\+", "plus", as.character(x))
  gsub("[^A-Za-z0-9_]+", "_", out)
}

#' Default cell-type pairs for ratio features (numerator / denominator).
default_ratio_pairs <- function(cell_types) {
  nums <- c("CD8+ T Cell", "CD4+ T Cell", "T Cell")
  den <- "Tumor"
  if (!den %in% cell_types) return(list())
  pairs <- list()
  for (num in nums) {
    if (num %in% cell_types) pairs <- c(pairs, list(c(num, den)))
  }
  if (all(c("CD8+ T Cell", "CD4+ T Cell") %in% cell_types) && den %in% cell_types) {
    pairs <- c(pairs, list(c("T_cells", den)))
  }
  pairs
}

#' Aggregate raw counts, percentages, and ratios per sample or patient.
#'
#' @param cells data.table with sample_id, patient_id, cell_type.
#' @param level "sample" or "patient".
#' @param ratio_pairs Optional list of c(numerator, denominator) cell types.
#' @return data.frame with sample_id, patient_id (when present), count_*,
#'   pct_*, ratio_* columns.
aggregate_cell_features <- function(cells, level = c("sample", "patient"),
                                    ratio_pairs = NULL) {
  level <- match.arg(level)
  if (!is.data.frame(cells) && !data.table::is.data.table(cells)) {
    stop("cells must be a data.frame or data.table.", call. = FALSE)
  }
  if (nrow(cells) == 0L) {
    return(data.frame(sample_id = character(), stringsAsFactors = FALSE))
  }
  if (!"cell_type" %in% names(cells)) {
    stop("cells must include a cell_type column.", call. = FALSE)
  }

  id_col <- if (level == "patient") {
    if (!"patient_id" %in% names(cells)) cells$patient_id <- cells$sample_id
    "patient_id"
  } else {
    "sample_id"
  }

  tab <- as.data.frame(table(cells[[id_col]], cells$cell_type), stringsAsFactors = FALSE)
  names(tab) <- c("id", "cell_type", "count")
  tab$count <- as.integer(tab$count)

  ids <- unique(tab$id)
  cell_types <- sort(unique(tab$cell_type))
  if (is.null(ratio_pairs)) ratio_pairs <- default_ratio_pairs(cell_types)

  wide <- data.frame(id = ids, stringsAsFactors = FALSE)
  for (ct in cell_types) {
    key <- sanitize_feature_name(ct)
    sub <- tab[tab$cell_type == ct, , drop = FALSE]
    m <- match(wide$id, sub$id)
    wide[[paste0("count_", key)]] <- ifelse(is.na(m), 0L, sub$count[m])
  }

  wide$n_total <- rowSums(wide[, grep("^count_", names(wide)), drop = FALSE])
  for (ct in cell_types) {
    key <- sanitize_feature_name(ct)
    col <- paste0("count_", key)
    wide[[paste0("pct_", key)]] <- ifelse(
      wide$n_total > 0L, 100 * wide[[col]] / wide$n_total, NA_real_
    )
  }

  for (pair in ratio_pairs) {
    if (length(pair) != 2L) next
    num_label <- pair[[1]]
    den_label <- pair[[2]]
    if (identical(num_label, "T_cells")) {
      num_cols <- paste0("count_", sanitize_feature_name(c("CD8+ T Cell", "CD4+ T Cell", "T Cell")))
      num_cols <- intersect(num_cols, names(wide))
      num <- if (length(num_cols) > 0L) {
        rowSums(wide[, num_cols, drop = FALSE])
      } else {
        rep(0, nrow(wide))
      }
      ratio_name <- "ratio_T_cells_over_Tumor"
    } else {
      num_col <- paste0("count_", sanitize_feature_name(num_label))
      den_col <- paste0("count_", sanitize_feature_name(den_label))
      if (!num_col %in% names(wide) || !den_col %in% names(wide)) next
      num <- wide[[num_col]]
      ratio_name <- paste0(
        "ratio_", sanitize_feature_name(num_label),
        "_over_", sanitize_feature_name(den_label)
      )
    }
    den_col <- paste0("count_", sanitize_feature_name(den_label))
    if (!den_col %in% names(wide)) next
    den <- wide[[den_col]]
    wide[[ratio_name]] <- ifelse(den > 0L, num / den, NA_real_)
  }

  if (level == "sample") {
    wide$sample_id <- wide$id
    if ("patient_id" %in% names(cells)) {
      pid_map <- unique(as.data.frame(cells[, c("sample_id", "patient_id")]))
      wide <- merge(wide, pid_map, by.x = "sample_id", by.y = "sample_id",
                    all.x = TRUE)
    }
  } else {
    wide$patient_id <- wide$id
    if ("sample_id" %in% names(cells) && "patient_id" %in% names(cells)) {
      sid_map <- unique(as.data.frame(cells[, c("patient_id", "sample_id")]))
      sid_map <- sid_map[!duplicated(sid_map$patient_id), , drop = FALSE]
      wide <- merge(wide, sid_map, by = "patient_id", all.x = TRUE)
    } else {
      wide$sample_id <- wide$patient_id
    }
  }
  wide$id <- NULL
  wide
}

#' Feature columns derived from aggregation (counts, pcts, ratios, spatial stat).
clinical_feature_columns <- function(features_df) {
  if (is.null(features_df) || nrow(features_df) == 0L) return(character())
  skip <- c("sample_id", "patient_id", "n_total", "n_focal", "tissue_area")
  cols <- setdiff(names(features_df), skip)
  imaging <- cols[grepl("^(count_|pct_|ratio_)", cols)]
  spatial <- intersect("spatial_cluster_stat", cols)
  c(imaging, spatial)
}

#' Infer whether a column is numeric or categorical for plotting/tests.
clinical_column_type <- function(x) {
  x <- x[!is.na(x)]
  if (length(x) == 0L) return("unknown")
  if (is.numeric(x)) {
    if (length(unique(x)) <= 5L && all(x %in% c(0, 1))) return("categorical")
    return("numeric")
  }
  num <- suppressWarnings(as.numeric(as.character(x)))
  if (sum(is.finite(num)) >= max(5L, ceiling(0.8 * length(x)))) {
    return("numeric")
  }
  "categorical"
}

#' Coalesce dplyr-style .x / .y columns produced by overlapping merge keys.
coalesce_merge_id_columns <- function(df) {
  if (!is.data.frame(df) || ncol(df) == 0L) return(df)
  xy <- grep("\\.(x|y)$", names(df), value = TRUE)
  if (length(xy) == 0L) return(df)
  bases <- unique(sub("\\.(x|y)$", "", xy))
  for (base in bases) {
    cx <- paste0(base, ".x")
    cy <- paste0(base, ".y")
    if (cx %in% names(df) && cy %in% names(df)) {
      df[[base]] <- ifelse(!is.na(df[[cx]]), df[[cx]], df[[cy]])
      df[[cx]] <- NULL
      df[[cy]] <- NULL
    }
  }
  df
}

#' Clinical metadata columns suitable for summary plots and tests.
clinical_plot_columns <- function(merged) {
  if (is.null(merged) || nrow(merged) == 0L) return(character())
  skip <- c("sample_id", "patient_id", "n_total")
  feat_cols <- clinical_feature_columns(merged)
  cols <- setdiff(names(merged), c(skip, feat_cols, "spatial_cluster_stat"))
  cols <- cols[!grepl("\\.(x|y)$", cols)]
  cols <- cols[vapply(cols, function(col) {
    clinical_column_type(merged[[col]]) %in% c("numeric", "categorical")
  }, logical(1))]
  pref <- c("age", "race", "sex", "gender", "ethnicity", "grade", "stage",
            "treatment", "arm", "recurrence", "brca_status", "brca", "status")
  c(intersect(pref, cols), setdiff(cols, pref))
}

#' Whether a clinical column has enough variation for association screening.
is_screenable_clinical_column <- function(merged, col) {
  if (!col %in% names(merged)) return(FALSE)
  x <- merged[[col]]
  ok <- !is.na(x) & nzchar(trimws(as.character(x)))
  x <- x[ok]
  if (length(x) < 5L) return(FALSE)
  ctype <- clinical_column_type(x)
  if (ctype == "numeric") {
    num <- suppressWarnings(as.numeric(as.character(x)))
    num <- num[is.finite(num)]
    return(length(num) >= 5L && length(unique(num)) >= 2L)
  }
  nlevels(factor(as.character(x))) >= 2L
}

#' Clinical columns eligible for marker × clinical screening.
screening_clinical_columns <- function(merged, candidates = NULL) {
  if (is.null(merged) || nrow(merged) == 0L) return(character())
  cols <- candidates %||% clinical_plot_columns(merged)
  cols <- setdiff(cols, c("time", "status", "sample_id", "patient_id"))
  cols <- cols[!grepl("\\.(x|y)$", cols)]
  cols[vapply(cols, function(col) is_screenable_clinical_column(merged, col),
              logical(1))]
}

#' Per cell-type marker column names (count and percent).
marker_options_for_types <- function(cell_types) {
  lapply(cell_types, function(ct) {
    key <- sanitize_feature_name(ct)
    list(
      cell_type = ct,
      count_column = paste0("count_", key),
      pct_column = paste0("pct_", key)
    )
  })
}

#' Build cell (and optional spatial) feature table at sample or patient level.
build_clinical_features <- function(ds, level = c("sample", "patient"),
                                    spatial_cfg = NULL, dataset_id = NULL) {
  level <- match.arg(level)
  features <- aggregate_cell_features(ds$cells, level = level)
  if (!is.null(spatial_cfg) && isTRUE(spatial_cfg$enabled)) {
    features <- attach_spatial_cluster_stat(features, ds$cells, spatial_cfg,
                                            level = level, dataset_id = dataset_id)
  }
  features
}

#' Build merged feature + clinical table for summary plots.
clinical_summary_data <- function(ds, level = c("sample", "patient"),
                                  spatial_cfg = NULL, dataset_id = NULL) {
  level <- match.arg(level)
  features <- build_clinical_features(ds, level = level, spatial_cfg = spatial_cfg,
                                      dataset_id = dataset_id)
  cell_types <- sort(unique(ds$cells$cell_type))
  markers <- marker_options_for_types(cell_types)
  ratio_cols <- grep("^ratio_", names(features), value = TRUE)

  if (is.null(ds$survival) || nrow(ds$survival) == 0L) {
    return(list(
      has_clinical = FALSE,
      level = level,
      n_rows = nrow(features),
      cell_types = cell_types,
      markers = markers,
      marker_columns = clinical_feature_columns(features),
      ratio_columns = ratio_cols,
      clinical_columns = character(),
      column_types = list(),
      rows = features
    ))
  }

  merged <- merge_features_survival(features, ds$survival)
  clin_cols <- clinical_plot_columns(merged)
  types <- stats::setNames(
    vapply(clin_cols, function(col) clinical_column_type(merged[[col]]),
           character(1)),
    clin_cols
  )

  list(
    has_clinical = TRUE,
    level = level,
    n_rows = nrow(merged),
    cell_types = cell_types,
    markers = markers,
    marker_columns = clinical_feature_columns(features),
    ratio_columns = ratio_cols,
    clinical_columns = clin_cols,
    screenable_clinical_columns = screening_clinical_columns(merged, clin_cols),
    column_types = as.list(types),
    rows = merged
  )
}

#' Signed association direction from a numeric effect size.
effect_direction <- function(x) {
  if (is.null(x) || length(x) != 1L || !is.finite(x) || abs(x) < 1e-9) {
    return("neutral")
  }
  if (x > 0) "positive" else "negative"
}

#' Normalize heterogeneous effect metrics to a comparable signed strength in [-1, 1].
normalize_effect_strength <- function(effect_size, effect_metric) {
  if (is.null(effect_size) || length(effect_size) != 1L || !is.finite(effect_size)) {
    return(NA_real_)
  }
  metric <- tolower(as.character(effect_metric %||% ""))
  if (metric %in% c("rho", "rank_biserial", "eta_squared")) {
    return(max(-1, min(1, effect_size)))
  }
  if (metric %in% c("log_hr", "log_odds")) {
    return(max(-1, min(1, effect_size / log(4))))
  }
  NA_real_
}

#' Default spatial clustering config for association screening.
default_screening_spatial_cfg <- function(cell_types) {
  preferred <- c("CD8+ T Cell", "CD4+ T Cell", "T Cell")
  type_a <- intersect(preferred, cell_types)
  type_a <- if (length(type_a) > 0L) type_a[[1]] else cell_types[[1]]
  list(
    enabled = TRUE,
    statistic = "K",
    type_a = type_a,
    type_b = NULL,
    radius = 50,
    min_focal_cells = 10L,
    window_type = "convex"
  )
}

#' Resolve spatial config for screening (explicit body params or auto defaults).
resolve_screening_spatial_cfg <- function(spatial_cfg, cell_types, auto_spatial = TRUE) {
  if (!is.null(spatial_cfg) && isTRUE(spatial_cfg$enabled)) return(spatial_cfg)
  if (!isTRUE(auto_spatial) || length(cell_types) == 0L) return(NULL)
  default_screening_spatial_cfg(cell_types)
}

#' Extract SE vector from an aod glimML object across package versions.
#'
#' Current aod exposes vcov() as an S4 generic (not stats::vcov). Older builds
#' stored fixed-effect variances in @varcov.
betabin_ses <- function(fit, n_fixed) {
  vc <- tryCatch(
    {
      v <- vcov(fit)
      v[seq_len(n_fixed), seq_len(n_fixed), drop = FALSE]
    },
    error = function(e1) {
      tryCatch(
        fit@varcov[seq_len(n_fixed), seq_len(n_fixed), drop = FALSE],
        error = function(e2) matrix(NA_real_, n_fixed, n_fixed)
      )
    }
  )
  sqrt(pmax(diag(vc), 0))
}

#' Try glmmTMB beta-binomial on a cbind(success, failure) ~ predictors formula.
fit_glmmtmb_betabin <- function(formula, data, label = "Beta-binomial (glmmTMB)",
                                control = NULL) {
  if (!requireNamespace("glmmTMB", quietly = TRUE)) return(NULL)
  ctrl <- control
  if (is.null(ctrl)) {
    ctrl <- tryCatch(glmmTMB::glmmTMBControl(), error = function(e) NULL)
  }
  fit <- tryCatch(
    if (is.null(ctrl)) {
      glmmTMB::glmmTMB(formula, data = data, family = glmmTMB::betabinomial())
    } else {
      glmmTMB::glmmTMB(formula, data = data, family = glmmTMB::betabinomial(),
                       control = ctrl)
    },
    error = function(e) NULL
  )
  if (is.null(fit)) return(NULL)
  sm <- tryCatch(summary(fit), error = function(e) NULL)
  if (is.null(sm) || is.null(sm$coefficients$cond)) return(NULL)
  cm <- sm$coefficients$cond
  if (nrow(cm) == 0L) return(NULL)
  se <- cm[, "Std. Error"]
  est <- cm[, "Estimate"]
  if (any(!is.finite(est)) || any(!is.finite(se)) || any(se <= 0)) return(NULL)
  list(
    method = label,
    est = stats::setNames(as.numeric(est), rownames(cm)),
    se = stats::setNames(as.numeric(se), rownames(cm)),
    dispersion = tryCatch(as.numeric(stats::sigma(fit)), error = function(e) NA_real_),
    aic = tryCatch(stats::AIC(fit), error = function(e) NA_real_),
    family_name = "beta_binomial_glmmTMB"
  )
}

#' Try aod::betabin on a cbind(success, failure) ~ predictors formula.
fit_aod_betabin <- function(formula, data, label = "Beta-binomial (aod)") {
  if (!requireNamespace("aod", quietly = TRUE)) return(NULL)
  fit_bb <- tryCatch(aod::betabin(formula, ~ 1, data = data), error = function(e) NULL)
  if (is.null(fit_bb)) return(NULL)
  est_try <- tryCatch(fit_bb@fixed.param, error = function(e) NULL)
  if (is.null(est_try) || length(est_try) == 0L) return(NULL)
  se_try <- betabin_ses(fit_bb, length(est_try))
  if (any(!is.finite(se_try)) || any(se_try <= 0)) return(NULL)
  phi_vec <- tryCatch(fit_bb@random.param, error = function(e) numeric(0))
  dispersion <- if (length(phi_vec) > 0L && is.finite(phi_vec[[1L]])) {
    as.numeric(phi_vec[[1L]])
  } else {
    NA_real_
  }
  list(
    method = label,
    est = stats::setNames(as.numeric(est_try), names(est_try)),
    se = stats::setNames(as.numeric(se_try), names(est_try)),
    dispersion = dispersion,
    aic = tryCatch(-2 * fit_bb@logL + 2 * fit_bb@np, error = function(e) NA_real_),
    family_name = "beta_binomial_aod"
  )
}

#' Quasibinomial GLM used only when all beta-binomial fitters fail.
fit_quasibinomial_last_resort <- function(formula, data) {
  fit_qb <- tryCatch(
    stats::glm(formula, data = data, family = stats::quasibinomial()),
    error = function(e) NULL
  )
  if (is.null(fit_qb)) return(NULL)
  cm <- summary(fit_qb)$coefficients
  if (is.null(cm) || nrow(cm) == 0L) return(NULL)
  se <- cm[, "Std. Error"]
  est <- cm[, "Estimate"]
  if (any(!is.finite(est)) || any(!is.finite(se)) || any(se <= 0)) return(NULL)
  list(
    method = "Quasibinomial (last resort)",
    est = stats::setNames(as.numeric(est), rownames(cm)),
    se = stats::setNames(as.numeric(se), rownames(cm)),
    dispersion = as.numeric(summary(fit_qb)$dispersion),
    aic = NA_real_,
    family_name = "quasibinomial"
  )
}

#' Drop unused factor levels in model data (simplified retry for sparse groups).
droplevels_model_data <- function(data) {
  out <- data
  for (nm in names(out)) {
    if (is.factor(out[[nm]])) out[[nm]] <- droplevels(out[[nm]])
  }
  out
}

#' Fit count/total proportion models with glmmTMB -> retry -> aod -> simplified -> quasibinomial.
fit_proportion_model_cascade <- function(formula, data) {
  attempts <- list(
    function() fit_glmmtmb_betabin(formula, data),
    function() {
      if (!requireNamespace("glmmTMB", quietly = TRUE)) return(NULL)
      ctrl <- glmmTMB::glmmTMBControl(
        optCtrl = list(iter.max = 1000L, eval.max = 1000L),
        profile = FALSE
      )
      fit_glmmtmb_betabin(formula, data,
                          label = "Beta-binomial (glmmTMB, retry)",
                          control = ctrl)
    },
    function() fit_aod_betabin(formula, data)
  )
  for (fn in attempts) {
    res <- fn()
    if (!is.null(res)) return(res)
  }

  data_simple <- droplevels_model_data(data)
  if (!identical(data_simple, data)) {
    simple_attempts <- list(
      function() fit_glmmtmb_betabin(formula, data_simple,
                                     label = "Beta-binomial (glmmTMB, simplified)"),
      function() fit_aod_betabin(formula, data_simple,
                                 label = "Beta-binomial (aod, simplified)")
    )
    for (fn in simple_attempts) {
      res <- fn()
      if (!is.null(res)) return(res)
    }
  }

  fit_quasibinomial_last_resort(formula, data)
}

#' Resolve beta-binomial count inputs for a screening marker.
#'
#' Returns a list with positive and total vectors when marker can be interpreted
#' as a count/proportion-derived endpoint.
resolve_marker_bb_counts <- function(df, marker_column) {
  marker_column <- as.character(marker_column)
  cols <- names(df)

  if (grepl("^count_", marker_column)) {
    if (!"n_total" %in% cols) {
      stop("Missing denominator column 'n_total' for count marker.", call. = FALSE)
    }
    return(list(
      positive = as.numeric(df[[marker_column]]),
      total = as.numeric(df[["n_total"]]),
      source = "count",
      positive_column = marker_column,
      total_column = "n_total"
    ))
  }

  if (grepl("^pct_", marker_column)) {
    count_col <- sub("^pct_", "count_", marker_column)
    if (!count_col %in% cols) {
      stop(sprintf("Missing count column '%s' for proportion marker '%s'.",
                   count_col, marker_column), call. = FALSE)
    }
    if (!"n_total" %in% cols) {
      stop("Missing denominator column 'n_total' for proportion marker.", call. = FALSE)
    }
    return(list(
      positive = as.numeric(df[[count_col]]),
      total = as.numeric(df[["n_total"]]),
      source = "pct",
      positive_column = count_col,
      total_column = "n_total"
    ))
  }

  if (grepl("^ratio_", marker_column)) {
    m <- regexec("^ratio_(.+)_over_(.+)$", marker_column)
    parts <- regmatches(marker_column, m)[[1]]
    if (length(parts) != 3L) {
      stop(sprintf("Could not parse ratio marker '%s'.", marker_column), call. = FALSE)
    }
    num_key <- parts[[2L]]
    den_key <- parts[[3L]]
    den_col <- paste0("count_", den_key)
    if (!den_col %in% cols) {
      stop(sprintf("Missing denominator count column '%s' for ratio marker '%s'.",
                   den_col, marker_column), call. = FALSE)
    }

    if (identical(num_key, "T_cells")) {
      num_cols <- paste0(
        "count_",
        sanitize_feature_name(c("CD8+ T Cell", "CD4+ T Cell", "T Cell"))
      )
      num_cols <- intersect(num_cols, cols)
      if (length(num_cols) == 0L) {
        stop(sprintf("Missing numerator count columns for ratio marker '%s'.",
                     marker_column), call. = FALSE)
      }
      numerator <- rowSums(df[, num_cols, drop = FALSE], na.rm = TRUE)
      positive_column <- paste(num_cols, collapse = "+")
    } else {
      num_col <- paste0("count_", num_key)
      if (!num_col %in% cols) {
        stop(sprintf("Missing numerator count column '%s' for ratio marker '%s'.",
                     num_col, marker_column), call. = FALSE)
      }
      numerator <- as.numeric(df[[num_col]])
      positive_column <- num_col
    }

    denominator <- as.numeric(df[[den_col]])
    return(list(
      positive = as.numeric(numerator),
      total = as.numeric(numerator + denominator),
      source = "ratio",
      positive_column = positive_column,
      total_column = paste0(positive_column, "+", den_col)
    ))
  }

  NULL
}

#' Beta-binomial cascade test for count-derived outcomes.
#'
#' Uses positive_column / total_column as the proportion outcome, with
#' clinical_column as the predictor. Tries glmmTMB, retry, aod, simplified
#' beta-binomial, then quasibinomial as last resort.
clinical_pair_test_bb <- function(df, marker_column, clinical_column,
                                  positive_column = marker_column,
                                  total_column = "n_total",
                                  method_label = "Beta-binomial") {
  if (!positive_column %in% names(df)) {
    stop(sprintf("Positive count column '%s' not found.", positive_column),
         call. = FALSE)
  }
  if (!total_column %in% names(df)) {
    stop(sprintf("Total count column '%s' not found.", total_column),
         call. = FALSE)
  }

  k_raw <- as.numeric(df[[positive_column]])
  n_raw <- as.numeric(df[[total_column]])
  cl <- df[[clinical_column]]

  ok_finite <- !is.na(k_raw) & !is.na(n_raw) & is.finite(k_raw) & is.finite(n_raw)
  ok_bounds <- ok_finite & n_raw > 0 & k_raw >= 0 & k_raw <= n_raw
  ok_clinical <- !is.na(cl) & nzchar(trimws(as.character(cl)))
  ok <- ok_bounds & ok_clinical
  n_invalid <- sum(!ok_bounds & ok_finite, na.rm = TRUE)
  if (n_invalid > 0L) {
    warning(sprintf(
      "Dropped %d rows with invalid count data for marker '%s' (require total > 0 and 0 <= positive <= total).",
      n_invalid, marker_column
    ))
  }
  k <- as.integer(round(k_raw[ok]))
  n <- as.integer(round(n_raw[ok]))
  cl <- cl[ok]

  if (sum(ok) < 5L) {
    stop(
      sprintf(
        "Need at least 5 valid paired observations for beta-binomial test on '%s' after filtering invalid count data.",
        marker_column
      ),
      call. = FALSE
    )
  }

  ok <- !is.na(k) & !is.na(n) & n > 0L & k >= 0L & k <= n & !is.na(cl) &
        nzchar(trimws(as.character(cl)))
  if (sum(ok) < 5L) {
    stop("Need at least 5 paired observations for a beta-binomial test.",
         call. = FALSE)
  }
  k  <- k[ok];  n  <- n[ok];  cl <- cl[ok]

  ctype <- clinical_column_type(cl)
  if (ctype == "numeric") {
    num <- suppressWarnings(as.numeric(as.character(cl)))
    if (sum(is.finite(num)) >= 5L) cl <- num else ctype <- "categorical"
  }
  if (ctype != "numeric") {
    cl <- factor(as.character(cl))
    if (nlevels(cl) < 2L) {
      stop(sprintf("Clinical column '%s' needs at least 2 levels.", clinical_column),
           call. = FALSE)
    }
  }

  tmp  <- data.frame(.k = k, .n = n, .cl = cl, stringsAsFactors = FALSE)
  fml  <- cbind(.k, .n - .k) ~ .cl
  fit  <- fit_proportion_model_cascade(fml, tmp)
  if (is.null(fit)) {
    stop(sprintf("Could not fit a proportion model for marker '%s'.", marker_column),
         call. = FALSE)
  }
  method <- fit$method %||% method_label
  est    <- fit$est
  se     <- fit$se

  # Primary term: first non-intercept coefficient
  non_int <- which(names(est) != "(Intercept)")
  idx     <- if (length(non_int) > 0L) non_int[[1L]] else 1L
  est_p   <- est[[idx]];  se_p <- se[[idx]]
  z_p     <- est_p / se_p
  p_val   <- 2 * stats::pnorm(-abs(z_p))

  effect_summary <- if (ctype != "numeric" && is.factor(cl) && nlevels(cl) == 2L) {
    levs <- levels(cl)
    props <- k / n
    m1 <- mean(props[as.integer(cl) == 1L], na.rm = TRUE)
    m2 <- mean(props[as.integer(cl) == 2L], na.rm = TRUE)
    sprintf("OR = %.2f \u00b7 \u0394 mean prop (%s\u2212%s) = %+.3g",
            exp(est_p), levs[2L], levs[1L], m2 - m1)
  } else {
    sprintf("coef = %+.3g (log-odds)", est_p)
  }

  list(
    marker_column   = marker_column,
    clinical_column = clinical_column,
    association_type = "clinical",
    clinical_type   = ctype,
    method          = method,
    statistic       = unname(z_p),
    effect_size     = unname(est_p),
    effect_metric   = "log_odds",
    effect_strength = normalize_effect_strength(est_p, "log_odds"),
    direction       = effect_direction(est_p),
    effect_summary  = effect_summary,
    p_value         = unname(p_val),
    n               = sum(ok),
    n_levels        = if (is.factor(cl)) nlevels(cl) else NULL
  )
}

#' Test association between one cell marker and one clinical variable.
#'
#' Count/proportion-derived markers (count_*, pct_*, ratio_*) use beta-binomial
#' with reconstructed positive/total counts. Other continuous endpoints retain
#' rank/correlation-based workflows.
clinical_pair_test <- function(df, marker_column, clinical_column) {
  marker_column <- as.character(marker_column)
  clinical_column <- as.character(clinical_column)
  if (!marker_column %in% names(df)) {
    stop(sprintf("Marker column '%s' not found.", marker_column), call. = FALSE)
  }
  if (!clinical_column %in% names(df)) {
    stop(sprintf("Clinical column '%s' not found.", clinical_column), call. = FALSE)
  }

  # Beta-binomial path for count/proportion-derived markers.
  bb_counts <- resolve_marker_bb_counts(df, marker_column)
  if (!is.null(bb_counts)) {
    bb_df <- df
    bb_df$.bb_positive <- bb_counts$positive
    bb_df$.bb_total <- bb_counts$total
    return(clinical_pair_test_bb(
      bb_df,
      marker_column = marker_column,
      clinical_column = clinical_column,
      positive_column = ".bb_positive",
      total_column = ".bb_total",
      method_label = "Beta-binomial"
    ))
  }

  mk <- as.numeric(df[[marker_column]])
  cl <- df[[clinical_column]]
  ok <- is.finite(mk) & !is.na(cl)
  mk <- mk[ok]
  cl <- cl[ok]
  if (length(mk) < 5L) {
    stop("Need at least 5 paired observations for a test.", call. = FALSE)
  }

  ctype <- clinical_column_type(cl)
  if (ctype == "numeric") {
    cln <- suppressWarnings(as.numeric(as.character(cl)))
    if (sum(is.finite(cln)) >= 5L) {
      cl <- cln
      ctype <- "numeric"
    }
  }

  if (ctype == "numeric") {
    ct <- stats::cor.test(mk, cl, method = "spearman", exact = FALSE)
    rho <- unname(ct$estimate)
    return(list(
      marker_column = marker_column,
      clinical_column = clinical_column,
      association_type = "clinical",
      clinical_type = "numeric",
      method = "Spearman rank correlation",
      statistic = rho,
      effect_size = rho,
      effect_metric = "rho",
      effect_strength = normalize_effect_strength(rho, "rho"),
      direction = effect_direction(rho),
      effect_summary = sprintf("\u03c1 = %+.3f", rho),
      p_value = unname(ct$p.value),
      n = length(mk)
    ))
  }

  cl_f <- factor(as.character(cl))
  nlev <- nlevels(cl_f)
  if (nlev < 2L) {
    stop(sprintf("Clinical column '%s' needs at least 2 levels.", clinical_column),
         call. = FALSE)
  }
  if (nlev == 2L) {
    wt <- stats::wilcox.test(mk ~ cl_f, exact = FALSE)
    levs <- levels(cl_f)
    m1 <- stats::median(mk[cl_f == levs[1L]], na.rm = TRUE)
    m2 <- stats::median(mk[cl_f == levs[2L]], na.rm = TRUE)
    delta <- m2 - m1
    n_a <- sum(cl_f == levs[1L])
    n_b <- sum(cl_f == levs[2L])
    w <- unname(wt$statistic)
    rank_biserial <- (2 * w / (n_a * n_b)) - 1
    return(list(
      marker_column = marker_column,
      clinical_column = clinical_column,
      association_type = "clinical",
      clinical_type = "categorical",
      method = "Wilcoxon rank sum",
      statistic = w,
      effect_size = rank_biserial,
      effect_metric = "rank_biserial",
      effect_strength = normalize_effect_strength(rank_biserial, "rank_biserial"),
      direction = effect_direction(delta),
      effect_summary = sprintf(
        "r = %+.2f \u00b7 \u0394 median (%s\u2212%s) = %+.3g",
        rank_biserial, levs[2L], levs[1L], delta
      ),
      p_value = unname(wt$p.value),
      n = length(mk),
      n_levels = nlev
    ))
  }

  kt <- stats::kruskal.test(mk ~ cl_f)
  h <- unname(kt$statistic)
  n <- length(mk)
  eta2 <- max(0, (h - nlev + 1) / (n - nlev))
  list(
    marker_column = marker_column,
    clinical_column = clinical_column,
    association_type = "clinical",
    clinical_type = "categorical",
    method = "Kruskal-Wallis",
    statistic = h,
    effect_size = eta2,
    effect_metric = "eta_squared",
    effect_strength = normalize_effect_strength(eta2, "eta_squared"),
    direction = "neutral",
    effect_summary = sprintf("H = %.2f \u00b7 \u03b7\u00b2 = %.3f", h, eta2),
    p_value = unname(kt$p.value),
    n = n,
    n_levels = nlev
  )
}

#' Cox PH screen: marker vs overall survival (continuous predictor).
clinical_survival_screen_test <- function(df, marker_column) {
  marker_column <- as.character(marker_column)
  if (!marker_column %in% names(df)) {
    stop(sprintf("Marker column '%s' not found.", marker_column), call. = FALSE)
  }
  if (!all(c("time", "status") %in% names(df))) {
    stop("Survival screening requires time and status columns.", call. = FALSE)
  }

  stats_per_sample <- data.frame(
    sample_id = df$sample_id,
    stat = as.numeric(df[[marker_column]]),
    stringsAsFactors = FALSE
  )
  if ("patient_id" %in% names(df)) {
    stats_per_sample$patient_id <- df$patient_id
  }

  surv_cols <- intersect(c("sample_id", "patient_id", "time", "status"), names(df))
  surv_df <- unique(df[, surv_cols, drop = FALSE])

  cox <- cox_from_stat(stats_per_sample, surv_df,
                       covariates = character(),
                       dichotomize = "none",
                       adjust_density = FALSE,
                       cluster_id = NULL)
  hr <- cox$primary$hr
  log_hr <- log(hr)
  list(
    marker_column = marker_column,
    clinical_column = "__survival__",
    association_type = "survival",
    clinical_type = "survival",
    method = "Cox proportional hazards",
    statistic = log_hr,
    effect_size = log_hr,
    effect_metric = "log_hr",
    effect_strength = normalize_effect_strength(log_hr, "log_hr"),
    direction = effect_direction(log_hr),
    hr = hr,
    hr_lower = cox$primary$hr_lower,
    hr_upper = cox$primary$hr_upper,
    effect_summary = sprintf(
      "HR = %.2f (%.2f\u2013%.2f)", hr, cox$primary$hr_lower, cox$primary$hr_upper
    ),
    p_value = cox$primary$p_value,
    n = cox$n,
    n_events = cox$n_events
  )
}

#' Run tests for many marker × clinical pairs.
clinical_summary_tests <- function(df, pairs) {
  if (!is.list(pairs) || length(pairs) == 0L) return(list())
  # When Plumber's default JSON parser simplifies the pairs array into a
  # data.frame, convert it back to a list of row-lists so $-access works.
  if (is.data.frame(pairs)) {
    pairs <- lapply(seq_len(nrow(pairs)), function(i) as.list(pairs[i, , drop = FALSE]))
  }
  out <- vector("list", length(pairs))
  for (i in seq_along(pairs)) {
    p <- pairs[[i]]
    if (!is.list(p)) p <- as.list(p)
    mc <- p$markerColumn %||% p$marker_column
    cc <- p$clinicalColumn %||% p$clinical_column
    out[[i]] <- tryCatch(
      clinical_pair_test(df, mc, cc),
      error = function(e) {
        list(
          marker_column = mc,
          clinical_column = cc,
          error = conditionMessage(e)
        )
      }
    )
  }
  out
}

.spatial_stat_cache <- new.env(parent = emptyenv())

spatial_stat_cache_key <- function(dataset_id, spatial_cfg) {
  paste(
    dataset_id %||% "__anonymous__",
    toupper(spatial_cfg$statistic %||% "K"),
    spatial_cfg$type_a %||% spatial_cfg$typeA %||% "",
    spatial_cfg$type_b %||% spatial_cfg$typeB %||% "",
    as.numeric(spatial_cfg$radius %||% NA),
    as.integer(spatial_cfg$min_focal_cells %||% spatial_cfg$minFocalCells %||% 10L),
    spatial_cfg$window_type %||% spatial_cfg$windowType %||% "convex",
    sep = "|"
  )
}

#' Per-sample spatial clustering scalars (cached when dataset_id is provided).
compute_spatial_per_sample_stat <- function(cells, spatial_cfg, dataset_id = NULL) {
  cache_key <- spatial_stat_cache_key(dataset_id, spatial_cfg)
  if (!is.null(dataset_id) && exists(cache_key, envir = .spatial_stat_cache, inherits = FALSE)) {
    return(get(cache_key, envir = .spatial_stat_cache, inherits = FALSE))
  }

  statistic <- toupper(spatial_cfg$statistic %||% "K")
  type_a <- spatial_cfg$type_a %||% spatial_cfg$typeA %||% "CD8+ T Cell"
  type_b <- spatial_cfg$type_b %||% spatial_cfg$typeB
  if (identical(type_b, "")) type_b <- NULL
  radius <- as.numeric(spatial_cfg$radius %||% if (statistic == "K") 50 else 20)
  correction <- spatial_cfg$correction %||% (if (statistic == "K") "iso" else "km")
  window_type <- spatial_cfg$window_type %||% spatial_cfg$windowType %||% "convex"
  min_focal <- as.integer(spatial_cfg$min_focal_cells %||% spatial_cfg$minFocalCells %||% 10L)

  r_grid <- seq(0, max(2 * radius, 10), length.out = 80L)
  spatial_res <- if (statistic == "K") {
    ripleys_k(cells, type_a = type_a, type_b = type_b, r = r_grid,
              correction = correction, max_cells = cfg()$max_cells_per_sample,
              window_type = window_type, nsim = 0L,
              min_focal_cells = min_focal)
  } else {
    nn_g(cells, type_a = type_a, type_b = type_b, r = r_grid,
         correction = correction, max_cells = cfg()$max_cells_per_sample,
         window_type = window_type, nsim = 0L,
         min_focal_cells = min_focal)
  }
  per_sample_stat <- spatial_summary_at_r(spatial_res, radius = radius,
                                          statistic = statistic)
  per_sample_stat$spatial_cluster_stat <- per_sample_stat$stat
  per_sample_stat$stat <- NULL

  if (!is.null(dataset_id)) {
    assign(cache_key, per_sample_stat, envir = .spatial_stat_cache)
  }
  per_sample_stat
}

#' Compare imaging sample IDs with uploaded clinical metadata IDs.
dataset_id_overlap <- function(ds) {
  cell_sample_ids <- unique(as.character(ds$cells$sample_id))
  cell_patient_ids <- if ("patient_id" %in% names(ds$cells)) {
    unique(as.character(ds$cells$patient_id[!is.na(ds$cells$patient_id)]))
  } else {
    character()
  }

  if (is.null(ds$survival) || nrow(ds$survival) == 0L) {
    return(list(
      has_clinical = FALSE,
      n_cell_samples = length(cell_sample_ids),
      n_clinical_rows = 0L,
      n_matched = 0L,
      match_rate = 0,
      unmatched_clinical = character(),
      unmatched_cell_samples = cell_sample_ids
    ))
  }

  clin_sample_ids <- unique(as.character(ds$survival$sample_id))
  matched <- intersect(cell_sample_ids, clin_sample_ids)
  match_by <- "sample_id"
  if (length(matched) == 0L && "patient_id" %in% names(ds$survival)) {
    clin_patient_ids <- unique(as.character(ds$survival$patient_id[!is.na(ds$survival$patient_id)]))
    matched <- intersect(cell_sample_ids, clin_patient_ids)
    if (length(matched) > 0L) match_by <- "sample_id_to_clinical_patient_id"
    if (length(matched) == 0L && length(cell_patient_ids) > 0L) {
      matched <- intersect(cell_patient_ids, clin_patient_ids)
      if (length(matched) > 0L) match_by <- "patient_id"
    }
  }

  unmatched_clinical <- setdiff(clin_sample_ids, cell_sample_ids)
  if ("patient_id" %in% names(ds$survival)) {
    clin_patient_ids <- unique(as.character(ds$survival$patient_id[!is.na(ds$survival$patient_id)]))
    unmatched_clinical <- unique(c(
      unmatched_clinical,
      setdiff(clin_patient_ids, c(cell_sample_ids, cell_patient_ids))
    ))
  }
  unmatched_cell <- setdiff(cell_sample_ids, matched)

  list(
    has_clinical = TRUE,
    n_cell_samples = length(cell_sample_ids),
    n_clinical_rows = nrow(ds$survival),
    n_matched = length(matched),
    match_rate = if (nrow(ds$survival) > 0L) length(matched) / nrow(ds$survival) else 0,
    match_by = match_by,
    matched_ids = matched,
    unmatched_clinical = unmatched_clinical,
    unmatched_cell_samples = unmatched_cell
  )
}

#' Marker columns for association screening.
#'
#' When include_counts is TRUE, raw count_* columns (tested via beta-binomial)
#' are placed first, immediately after the spatial stat, so the BB-modelled
#' columns dominate the matrix. pct_* columns are retained for reference.
screening_marker_columns <- function(marker_columns, include_counts = FALSE) {
  spatial <- intersect("spatial_cluster_stat", marker_columns)
  pcts    <- grep("^pct_",   marker_columns, value = TRUE)
  ratios  <- grep("^ratio_", marker_columns, value = TRUE)
  counts  <- grep("^count_", marker_columns, value = TRUE)
  if (isTRUE(include_counts)) {
    # Beta-binomial path: counts lead (BB-tested), then ratios, then pcts for reference.
    unique(c(spatial, counts, ratios, pcts))
  } else {
    unique(c(spatial, pcts, ratios))
  }
}

#' Group marker columns by biological feature type for screening summaries.
screening_marker_groups <- function(marker_columns) {
  list(
    spatial = intersect("spatial_cluster_stat", marker_columns),
    abundance = grep("^pct_", marker_columns, value = TRUE),
    ratio = grep("^ratio_", marker_columns, value = TRUE),
    count = grep("^count_", marker_columns, value = TRUE)
  )
}

#' Whether merged clinical table supports survival outcome screening.
has_survival_outcome <- function(merged) {
  if (is.null(merged) || nrow(merged) == 0L) return(FALSE)
  if (!all(c("time", "status") %in% names(merged))) return(FALSE)
  ok <- is.finite(merged$time) & !is.na(merged$status)
  sum(ok) >= 5L && sum(merged$status[ok] == 1L, na.rm = TRUE) >= 1L
}

#' Build marker × clinical pairs with clinical variables cycled before markers.
build_screening_pairs <- function(markers, clinical_cols, max_pairs) {
  if (length(markers) == 0L || length(clinical_cols) == 0L) return(list())
  max_pairs <- min(as.integer(max_pairs), length(markers) * length(clinical_cols))
  pairs <- vector("list", max_pairs)
  idx <- 1L
  for (cc in clinical_cols) {
    for (m in markers) {
      pairs[[idx]] <- list(markerColumn = m, clinicalColumn = cc)
      idx <- idx + 1L
      if (idx > max_pairs) return(pairs)
    }
  }
  pairs
}

#' Apply Benjamini-Hochberg FDR to a list of screening test results.
apply_screening_fdr <- function(tests, fdr_method = "BH") {
  pvals <- vapply(tests, function(t) {
    if (!is.null(t$error) || is.null(t$p_value)) NA_real_ else unname(t$p_value)
  }, numeric(1))
  ok <- is.finite(pvals)
  fdr <- rep(NA_real_, length(pvals))
  if (any(ok)) {
    fdr[ok] <- stats::p.adjust(pvals[ok], method = fdr_method)
  }
  for (i in seq_along(tests)) {
    if (ok[i]) {
      tests[[i]]$fdr <- unname(fdr[i])
    } else {
      tests[[i]]$fdr <- NULL
      if (!is.null(tests[[i]]$error)) tests[[i]]$p_value <- NULL
    }
  }
  tests
}

#' Screen marker × clinical and marker × survival associations with FDR correction.
clinical_association_matrix <- function(ds, level = c("sample", "patient"),
                                      spatial_cfg = NULL,
                                      max_pairs = 48L,
                                      fdr_method = "BH",
                                      dataset_id = NULL,
                                      include_counts = FALSE,
                                      clinical_column_filter = NULL,
                                      include_survival = TRUE,
                                      auto_spatial = TRUE) {
  level <- match.arg(level)
  cell_types <- sort(unique(ds$cells$cell_type))
  resolved_spatial <- resolve_screening_spatial_cfg(spatial_cfg, cell_types,
                                                    auto_spatial = auto_spatial)

  summary <- clinical_summary_data(ds, level = level,
                                   spatial_cfg = resolved_spatial,
                                   dataset_id = dataset_id)
  if (!isTRUE(summary$has_clinical)) {
    stop("Attach clinical metadata before running association screening.",
         call. = FALSE)
  }

  markers <- screening_marker_columns(summary$marker_columns,
                                     include_counts = include_counts)
  marker_groups <- screening_marker_groups(markers)
  clinical_cols <- screening_clinical_columns(
    summary$rows,
    candidates = summary$clinical_columns
  )
  if (!is.null(clinical_column_filter) && length(clinical_column_filter) > 0L) {
    clinical_cols <- intersect(as.character(clinical_column_filter), clinical_cols)
  }

  survival_on <- isTRUE(include_survival) && has_survival_outcome(summary$rows)
  outcome_cols <- if (survival_on) "__survival__" else character()
  all_outcome_cols <- c(clinical_cols, outcome_cols)

  if (length(markers) == 0L) {
    stop("No imaging markers available for screening.", call. = FALSE)
  }
  if (length(all_outcome_cols) == 0L) {
    stop("No clinical variables or survival outcomes available for screening.",
         call. = FALSE)
  }

  n_clinical_pairs <- length(markers) * length(clinical_cols)
  n_survival_pairs <- if (survival_on) length(markers) else 0L
  n_pairs_possible <- n_clinical_pairs + n_survival_pairs

  clinical_budget <- if (survival_on) {
    max(0L, as.integer(max_pairs) - n_survival_pairs)
  } else {
    as.integer(max_pairs)
  }
  clinical_pairs <- if (length(clinical_cols) > 0L && clinical_budget > 0L) {
    build_screening_pairs(markers, clinical_cols, clinical_budget)
  } else {
    list()
  }

  clinical_tests <- clinical_summary_tests(summary$rows, clinical_pairs)
  survival_tests <- if (survival_on) {
    lapply(markers, function(m) {
      tryCatch(
        clinical_survival_screen_test(summary$rows, m),
        error = function(e) {
          list(
            marker_column = m,
            clinical_column = "__survival__",
            association_type = "survival",
            error = conditionMessage(e)
          )
        }
      )
    })
  } else {
    list()
  }

  tests <- c(clinical_tests, survival_tests)
  tests <- apply_screening_fdr(tests, fdr_method = fdr_method)
  n_pairs_screened <- length(tests)

  n_success <- sum(vapply(tests, function(t) {
    is.null(t$error) && !is.null(t$p_value) && is.finite(t$p_value)
  }, logical(1)))
  n_failed <- length(tests) - n_success

  list(
    level = level,
    n_rows = summary$n_rows,
    marker_columns = markers,
    marker_groups = marker_groups,
    clinical_columns = clinical_cols,
    outcome_columns = all_outcome_cols,
    include_survival = survival_on,
    auto_spatial = !is.null(resolved_spatial) && is.null(spatial_cfg),
    spatial_config = if (!is.null(resolved_spatial)) {
      list(
        statistic = resolved_spatial$statistic %||% "K",
        type_a = resolved_spatial$type_a %||% resolved_spatial$typeA,
        type_b = resolved_spatial$type_b %||% resolved_spatial$typeB,
        radius = resolved_spatial$radius %||% 50
      )
    } else {
      NULL
    },
    fdr_method = fdr_method,
    include_counts = isTRUE(include_counts),
    n_pairs_possible = n_pairs_possible,
    n_pairs_screened = n_pairs_screened,
    n_clinical_pairs = length(clinical_pairs),
    n_survival_pairs = length(survival_tests),
    truncated = n_pairs_possible > n_pairs_screened,
    n_tests = length(tests),
    n_success = n_success,
    n_failed = n_failed,
    tests = tests
  )
}

#' Preferred clinical grouping columns (stage, treatment, BRCA, etc.).
preferred_group_columns <- function(surv_df) {
  pref <- c("stage", "treatment", "arm", "status", "recurrence",
            "brca_status", "brca", "grade")
  base <- eligible_group_columns(surv_df)
  c(intersect(pref, base), setdiff(base, pref))
}

merge_features_survival <- function(features_df, surv_df) {
  surv_trim <- surv_df
  if ("patient_id" %in% names(features_df) && "patient_id" %in% names(surv_trim)) {
    surv_trim <- surv_trim[, setdiff(names(surv_trim), "patient_id"), drop = FALSE]
  }
  joined <- merge(features_df, surv_trim, by = "sample_id")
  if (nrow(joined) == 0L && "patient_id" %in% names(surv_df)) {
    joined <- merge(features_df, surv_trim,
                    by.x = "sample_id", by.y = "patient_id")
  }
  if (nrow(joined) == 0L && "patient_id" %in% names(features_df) &&
      "patient_id" %in% names(surv_df)) {
    joined <- merge(features_df, surv_df, by = "patient_id")
  }
  coalesce_merge_id_columns(joined)
}

#' Aggregate per-sample spatial summaries to patient level (mean stat).
aggregate_spatial_to_patient <- function(per_sample_stat, cells) {
  if (!"patient_id" %in% names(cells)) {
    per_sample_stat$patient_id <- per_sample_stat$sample_id
  } else {
    pid_map <- unique(as.data.frame(cells[, c("sample_id", "patient_id")]))
    per_sample_stat <- merge(per_sample_stat, pid_map, by = "sample_id", all.x = TRUE)
    na_pid <- is.na(per_sample_stat$patient_id)
    if (any(na_pid)) per_sample_stat$patient_id[na_pid] <- per_sample_stat$sample_id[na_pid]
  }
  agg <- stats::aggregate(
    cbind(spatial_cluster_stat, n_focal, tissue_area) ~ patient_id,
    data = per_sample_stat,
    FUN = function(x) if (all(is.na(x))) NA_real_ else mean(x, na.rm = TRUE)
  )
  agg
}

#' Optional spatial clustering statistic merged onto feature rows.
attach_spatial_cluster_stat <- function(features_df, cells, spatial_cfg,
                                        level = c("sample", "patient"),
                                        dataset_id = NULL) {
  level <- match.arg(level)
  if (is.null(spatial_cfg) || !isTRUE(spatial_cfg$enabled)) return(features_df)

  per_sample_stat <- compute_spatial_per_sample_stat(cells, spatial_cfg, dataset_id)

  if (level == "sample") {
    return(merge(features_df, per_sample_stat[, c("sample_id", "spatial_cluster_stat",
                                                   "n_focal", "tissue_area")],
                 by = "sample_id", all.x = TRUE))
  }

  per_patient <- aggregate_spatial_to_patient(per_sample_stat, cells)
  merge(features_df, per_patient, by = "patient_id", all.x = TRUE)
}

#' Wilcoxon test on a clinical feature between two metadata groups.
clinical_wilcoxon <- function(features_df, surv_df, feature_column,
                              group_column, group_a = NULL, group_b = NULL) {
  feature_column <- as.character(feature_column)
  if (!feature_column %in% names(features_df)) {
    stop(sprintf("Feature column '%s' not found.", feature_column), call. = FALSE)
  }
  stats_per_sample <- data.frame(
    sample_id = features_df$sample_id,
    stat = as.numeric(features_df[[feature_column]]),
    stringsAsFactors = FALSE
  )
  if ("patient_id" %in% names(features_df)) {
    stats_per_sample$patient_id <- features_df$patient_id
  }
  wx <- wilcox_from_stat(stats_per_sample, surv_df,
                         group_column = group_column,
                         group_a = group_a, group_b = group_b)
  wx$feature_column <- feature_column
  wx
}

#' Linear / logistic model with cell features and clinical covariates.
clinical_linear <- function(features_df, surv_df, outcome_column,
                            feature_columns = character(),
                            covariates = character(),
                            cluster_id = NULL) {
  outcome_column <- as.character(outcome_column)
  predictors <- unique(c(feature_columns, covariates))
  if (length(predictors) == 0L) {
    stop("At least one predictor (cell feature or covariate) is required.",
         call. = FALSE)
  }

  joined <- merge_features_survival(features_df, surv_df)
  if (nrow(joined) == 0L) {
    stop("No overlap between cell features and clinical metadata.",
         call. = FALSE)
  }

  if (!outcome_column %in% names(joined)) {
    stop(sprintf("Outcome column '%s' not found.", outcome_column),
         call. = FALSE)
  }

  y_raw <- joined[[outcome_column]]
  binary <- is_binary_outcome(y_raw)
  if (binary) {
    joined$.outcome <- coerce_binary_outcome(y_raw)
  } else if (!is.numeric(y_raw)) {
    stop(sprintf("Outcome '%s' must be numeric or binary.", outcome_column),
         call. = FALSE)
  } else {
    joined$.outcome <- as.numeric(y_raw)
  }

  for (col in predictors) {
    if (!col %in% names(joined)) {
      stop(sprintf("Predictor '%s' not found in merged data.", col),
           call. = FALSE)
    }
    joined[[col]] <- prepare_predictor(joined[[col]])
  }

  ok <- is.finite(joined$.outcome)
  for (col in predictors) {
    v <- joined[[col]]
    if (is.numeric(v)) ok <- ok & is.finite(v)
  }
  joined <- joined[ok, , drop = FALSE]

  if (nrow(joined) < 5L) {
    stop("Need at least 5 samples with complete data to fit the model.",
         call. = FALSE)
  }

  # Drop factor predictors with < 2 effective levels after filtering to avoid
  # "contrasts can be applied only to factors with 2 or more levels".
  predictors <- predictors[vapply(predictors, function(col) {
    v <- joined[[col]]
    !is.factor(v) || nlevels(droplevels(v)) >= 2L
  }, logical(1L))]
  if (length(predictors) == 0L) {
    stop("No valid predictors remain after filtering (all factor columns have only one level).",
         call. = FALSE)
  }

  rhs <- paste(predictors, collapse = " + ")
  formula <- stats::as.formula(paste(".outcome ~", rhs))

  cluster_vec <- resolve_cluster_vector(joined, cluster_id)
  fit <- if (binary) {
    stats::glm(formula, data = joined, family = stats::binomial())
  } else {
    stats::lm(formula, data = joined)
  }

  coef_info <- linear_coef_table(fit, cluster_vec, logistic = binary)
  ci_info <- linear_confint(fit, cluster_vec, logistic = binary)

  primary_term <- predictors[[1]]
  primary_idx <- match(primary_term, coef_info$term)
  if (is.na(primary_idx)) primary_idx <- 1L

  primary <- list(
    term            = coef_info$term[primary_idx],
    estimate        = coef_info$estimate[primary_idx],
    estimate_lower  = ci_info$lower[primary_idx],
    estimate_upper  = ci_info$upper[primary_idx],
    se              = coef_info$se[primary_idx],
    p_value         = coef_info$p_value[primary_idx],
    odds_ratio      = if (binary) exp(coef_info$estimate[primary_idx]) else NULL,
    odds_ratio_lower = if (binary) exp(ci_info$lower[primary_idx]) else NULL,
    odds_ratio_upper = if (binary) exp(ci_info$upper[primary_idx]) else NULL
  )

  n_clusters <- if (!is.null(cluster_vec)) length(unique(cluster_vec)) else NA_integer_

  fit_stats <- if (binary) {
    list(aic = stats::AIC(fit), null_deviance = fit$null.deviance,
         deviance = fit$deviance)
  } else {
    s <- summary(fit)
    list(r_squared = unname(s$r.squared), adj_r_squared = unname(s$adj.r.squared),
         sigma = unname(s$sigma))
  }

  supp <- linear_model_supplement(fit, joined, binary,
                                covariates = covariates)
  supp$estimate_table <- build_estimate_table(coef_info, ci_info, binary)

  c(list(
    n                  = nrow(joined),
    formula            = deparse(formula),
    family             = if (binary) "binomial" else "gaussian",
    outcome_column     = outcome_column,
    feature_columns    = feature_columns,
    covariates         = covariates,
    predictors         = predictors,
    clustered          = !is.null(cluster_vec),
    cluster_id         = if (!is.null(cluster_vec)) cluster_id else NULL,
    n_clusters         = n_clusters,
    primary            = primary,
    coefficients       = coef_info,
    confidence_intervals = data.frame(
      term = ci_info$term, lower = ci_info$lower, upper = ci_info$upper,
      stringsAsFactors = FALSE
    ),
    estimate_table     = supp$estimate_table,
    model_rows         = supp$model_rows,
    outcome_frequency  = supp$outcome_frequency,
    observed_predicted = supp$observed_predicted,
    covariate_frequencies = supp$covariate_frequencies
  ), fit_stats)
}

#' Count columns eligible as beta-binomial proportion outcomes (requires n_total).
beta_binomial_count_columns <- function(features_df) {
  if (is.null(features_df) || !"n_total" %in% names(features_df)) return(character())
  sort(grep("^count_", names(features_df), value = TRUE))
}

#' Beta-binomial regression: count_column / total_column ~ clinical_variable + covariates.
#'
#' Models per-sample cell counts as overdispersed binomial proportions. The
#' count_column (successes) and total_column (trials) define the imaging
#' proportion; outcome_column is the clinical variable used as predictor.
#' Uses glmmTMB / aod beta-binomial cascade with quasibinomial last resort.
#'
#' @param features_df  data.frame with count_* and n_total columns.
#' @param surv_df      clinical metadata data.frame.
#' @param count_column count_* column (proportion numerator, e.g. T cells).
#' @param outcome_column clinical predictor column (e.g. stage, age).
#' @param total_column denominator column (default "n_total"; can be another
#'   count_* column for compartment-specific denominators, e.g. count_Tumor).
#' @param covariates   additional clinical covariate columns.
#' @param cluster_id   column for cluster-robust SEs (e.g. "patient_id").
clinical_beta_binomial <- function(features_df, surv_df,
                                   count_column,
                                   outcome_column,
                                   total_column = "n_total",
                                   covariates = character(),
                                   cluster_id = NULL) {
  count_column   <- as.character(count_column)
  outcome_column <- as.character(outcome_column)
  total_column   <- as.character(total_column)

  if (!count_column %in% names(features_df))
    stop(sprintf("Count column '%s' not found in features.", count_column), call. = FALSE)
  if (!total_column %in% names(features_df))
    stop(sprintf("Total column '%s' not found in features.", total_column), call. = FALSE)
  if (!outcome_column %in% names(surv_df))
    stop(sprintf("Outcome column '%s' not found in clinical data.", outcome_column),
         call. = FALSE)

  joined <- merge_features_survival(features_df, surv_df)
  if (nrow(joined) == 0L)
    stop("No overlap between cell features and clinical metadata.", call. = FALSE)
  if (!outcome_column %in% names(joined))
    stop(sprintf("Outcome column '%s' not found after merge.", outcome_column), call. = FALSE)

  joined[[outcome_column]] <- prepare_predictor(joined[[outcome_column]])
  for (col in covariates) {
    if (!col %in% names(joined))
      stop(sprintf("Covariate '%s' not found in merged data.", col), call. = FALSE)
    joined[[col]] <- prepare_predictor(joined[[col]])
  }

  k <- as.integer(round(as.numeric(joined[[count_column]])))
  n <- as.integer(round(as.numeric(joined[[total_column]])))
  ok <- !is.na(k) & !is.na(n) & n > 0L & k >= 0L & k <= n
  for (col in c(outcome_column, covariates)) {
    v <- joined[[col]]
    if (is.numeric(v)) ok <- ok & is.finite(v) else ok <- ok & !is.na(v)
  }
  joined <- joined[ok, , drop = FALSE]
  k <- k[ok]
  n <- n[ok]

  if (nrow(joined) < 5L)
    stop("Need at least 5 samples with complete data to fit the beta-binomial model.",
         call. = FALSE)

  joined$.k <- k
  joined$.n <- n

  # Drop factor covariates with < 2 effective levels after filtering.
  covariates <- covariates[vapply(covariates, function(col) {
    v <- joined[[col]]
    !is.factor(v) || nlevels(droplevels(v)) >= 2L
  }, logical(1L))]

  predictors   <- unique(c(outcome_column, covariates))
  rhs          <- paste(predictors, collapse = " + ")
  formula_full <- stats::as.formula(paste("cbind(.k, .n - .k) ~", rhs))

  fit <- fit_proportion_model_cascade(formula_full, joined)
  if (is.null(fit)) {
    stop("Could not fit a beta-binomial or quasibinomial model for the requested data.",
         call. = FALSE)
  }
  family_name <- fit$family_name
  est    <- fit$est
  se     <- fit$se
  p_vals <- 2 * stats::pnorm(-abs(est / se))
  dispersion <- fit$dispersion
  aic_val    <- fit$aic

  term_names <- names(est)
  coef_info  <- data.frame(
    term     = term_names,
    estimate = as.numeric(est),
    se       = as.numeric(se),
    z        = as.numeric(est / se),
    p_value  = as.numeric(p_vals),
    stringsAsFactors = FALSE
  )
  z_crit  <- stats::qnorm(0.975)
  ci_info <- data.frame(
    term  = term_names,
    lower = as.numeric(est - z_crit * se),
    upper = as.numeric(est + z_crit * se),
    stringsAsFactors = FALSE
  )

  primary_idx <- grep(paste0("^", outcome_column), term_names)
  if (length(primary_idx) == 0L)
    primary_idx <- which(term_names != "(Intercept)")
  if (length(primary_idx) == 0L || all(is.na(primary_idx)))
    primary_idx <- 1L
  primary_idx <- primary_idx[[1L]]

  primary <- list(
    term             = coef_info$term[primary_idx],
    estimate         = coef_info$estimate[primary_idx],
    estimate_lower   = ci_info$lower[primary_idx],
    estimate_upper   = ci_info$upper[primary_idx],
    se               = coef_info$se[primary_idx],
    p_value          = coef_info$p_value[primary_idx],
    odds_ratio       = exp(coef_info$estimate[primary_idx]),
    odds_ratio_lower = exp(ci_info$lower[primary_idx]),
    odds_ratio_upper = exp(ci_info$upper[primary_idx])
  )

  proportions <- k / n
  mean_prop   <- mean(proportions, na.rm = TRUE)
  median_prop <- stats::median(proportions, na.rm = TRUE)

  model_rows <- data.frame(
    sample_id  = as.character(joined$sample_id),
    count      = k,
    n_total    = n,
    proportion = proportions,
    stringsAsFactors = FALSE
  )
  if ("patient_id" %in% names(joined))
    model_rows$patient_id <- as.character(joined$patient_id)
  for (col in predictors) {
    v <- joined[[col]]
    model_rows[[col]] <- if (is.numeric(v)) as.numeric(v) else as.character(v)
  }

  estimate_table <- build_estimate_table(coef_info, ci_info, logistic = TRUE)

  cluster_vec <- resolve_cluster_vector(joined, cluster_id)
  n_clusters  <- if (!is.null(cluster_vec)) length(unique(cluster_vec)) else NA_integer_

  list(
    n                 = nrow(joined),
    formula           = deparse(formula_full),
    family            = family_name,
    count_column      = count_column,
    total_column      = total_column,
    outcome_column    = outcome_column,
    covariates        = covariates,
    predictors        = predictors,
    clustered         = !is.null(cluster_vec),
    cluster_id        = if (!is.null(cluster_vec)) cluster_id else NULL,
    n_clusters        = n_clusters,
    dispersion        = dispersion,
    aic               = aic_val,
    mean_proportion   = mean_prop,
    median_proportion = median_prop,
    primary              = primary,
    coefficients         = coef_info,
    confidence_intervals = ci_info,
    estimate_table       = estimate_table,
    model_rows           = model_rows
  )
}

#' Log-rank test for Kaplan-Meier group comparison.
clinical_logrank <- function(df, group_col = "group") {
  if (!requireNamespace("survival", quietly = TRUE)) {
    stop("Package 'survival' is required.", call. = FALSE)
  }
  if (!group_col %in% names(df)) {
    stop(sprintf("Group column '%s' missing.", group_col), call. = FALSE)
  }
  fit <- survival::survdiff(
    survival::Surv(time, status) ~ get(group_col), data = df
  )
  df_test <- length(fit$n) - 1L
  p <- stats::pchisq(fit$chisq, df_test, lower.tail = FALSE)
  list(
    chisq   = unname(fit$chisq),
    df      = df_test,
    p_value = p,
    n       = as.integer(fit$n),
    events  = as.integer(fit$obs)
  )
}

#' Cox PH, log-rank, and KM using a clinical cell feature (not spatial stat).
clinical_survival <- function(features_df, surv_df, feature_column,
                              covariates = character(),
                              dichotomize = c("none", "median", "tertile", "trichotomize"),
                              cluster_id = NULL) {
  dichotomize <- match.arg(dichotomize)
  feature_column <- as.character(feature_column)
  if (!feature_column %in% names(features_df)) {
    stop(sprintf("Feature column '%s' not found.", feature_column),
         call. = FALSE)
  }

  stats_per_sample <- data.frame(
    sample_id = features_df$sample_id,
    stat = as.numeric(features_df[[feature_column]]),
    stringsAsFactors = FALSE
  )
  if ("patient_id" %in% names(features_df)) {
    stats_per_sample$patient_id <- features_df$patient_id
  }

  cox <- cox_from_stat(stats_per_sample, surv_df,
                       covariates = covariates,
                       dichotomize = dichotomize,
                       adjust_density = FALSE,
                       cluster_id = cluster_id)

  logrank <- NULL
  if (dichotomize != "none" && !is.null(cox$km)) {
    joined <- merge_features_survival(features_df, surv_df)
    joined <- joined[is.finite(joined[[feature_column]]) &
                     is.finite(joined$time) & !is.na(joined$status), ,
                     drop = FALSE]
    if (dichotomize == "median") {
      cut <- stats::median(joined[[feature_column]], na.rm = TRUE)
      joined$group <- factor(ifelse(joined[[feature_column]] >= cut, "high", "low"),
                             levels = c("low", "high"))
    } else if (dichotomize == "tertile") {
      qs <- stats::quantile(joined[[feature_column]], c(1/3, 2/3), na.rm = TRUE)
      grp <- ifelse(joined[[feature_column]] <= qs[1], "low",
                    ifelse(joined[[feature_column]] >= qs[2], "high", NA_character_))
      joined <- joined[!is.na(grp), , drop = FALSE]
      joined$group <- factor(grp, levels = c("low", "high"))
    } else if (dichotomize == "trichotomize") {
      qs <- stats::quantile(joined[[feature_column]], c(1/3, 2/3), na.rm = TRUE)
      grp <- ifelse(joined[[feature_column]] <= qs[1], "low",
                    ifelse(joined[[feature_column]] >= qs[2], "high", "medium"))
      joined$group <- factor(grp, levels = c("low", "medium", "high"))
    }
    if (nrow(joined) >= 5L && length(unique(joined$group)) >= 2L) {
      logrank <- clinical_logrank(joined, "group")
    }
  }

  cox$feature_column <- feature_column
  list(cox = cox, logrank = logrank, feature_column = feature_column)
}
