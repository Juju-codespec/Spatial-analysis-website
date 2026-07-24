# Cox proportional-hazards models built on per-sample spatial summaries.
#
# The pipeline is:
#   1. Compute Ripley's K or Nearest-Neighbour G per sample
#      (see spatial.R::ripleys_k / nn_g).
#   2. Reduce each per-sample curve to a scalar at a chosen radius
#      (see spatial.R::spatial_summary_at_r).
#   3. Join the per-sample statistic onto patient-level survival data and
#      fit `survival::coxph()`, optionally with cluster-robust SE when
#      multiple cores share a patient, and optional density adjustment.
#
# `cox_from_stat()` does steps 2-3 and returns hazard ratios, confidence
# intervals, p-values and Kaplan-Meier curve points ready for plotting.

#' Fit a Cox PH model linking a per-sample spatial statistic to survival.
#'
#' @param stats_per_sample data.frame with columns sample_id, stat, and
#'   optionally n_focal, tissue_area from spatial_summary_at_r().
#' @param surv_df data.frame with sample_id, time, status, plus any
#'   covariates to include in the model.
#' @param covariates Character vector of column names in `surv_df` to add as
#'   additional covariates in the Cox model.
#' @param dichotomize One of "none" (use stat continuously), "median"
#'   (split at median into high/low), "tertile" (drop middle third), or
#'   "trichotomize" (keep all three tertile groups: low/medium/high).
#' @param adjust_density If TRUE, adjust for focal cell count and log tissue
#'   area to reduce confounding between clustering and cell density.
#' @param cluster_id Optional column name in the merged data for cluster-robust
#'   standard errors (e.g. "patient_id" when multiple cores share a patient).
#' @return A list ready for JSON: coefficient table, hazard ratio, 95% CI,
#'   p-value, and KM curve points (for dichotomized fits) or stratified
#'   placeholders.
cox_from_stat <- function(stats_per_sample, surv_df,
                          covariates = character(),
                          dichotomize = c("none", "median", "tertile", "trichotomize"),
                          adjust_density = FALSE,
                          cluster_id = NULL) {
  dichotomize <- match.arg(dichotomize)
  if (!requireNamespace("survival", quietly = TRUE)) {
    stop("Package 'survival' is required.", call. = FALSE)
  }
  if (!is.data.frame(stats_per_sample) || nrow(stats_per_sample) == 0L) {
    stop("stats_per_sample must be a non-empty data.frame.", call. = FALSE)
  }
  if (!is.data.frame(surv_df) || nrow(surv_df) == 0L) {
    stop("surv_df must include at least one row of survival data.",
         call. = FALSE)
  }

  joined <- merge(stats_per_sample, surv_df, by = "sample_id")
  if (nrow(joined) == 0L) {
    # Try patient-level join as fallback (one patient -> multiple samples).
    if ("patient_id" %in% names(surv_df)) {
      joined <- merge(stats_per_sample, surv_df,
                      by.x = "sample_id", by.y = "patient_id")
    }
  }
  if (nrow(joined) == 0L) {
    stop("No overlap between sample_ids in spatial stats and survival data.",
         call. = FALSE)
  }

  # Attach patient_id from survival when only present there.
  if (!"patient_id" %in% names(joined) && "patient_id" %in% names(surv_df)) {
    pid_map <- unique(surv_df[, c("sample_id", "patient_id"), drop = FALSE])
    joined <- merge(joined, pid_map, by = "sample_id", all.x = TRUE,
                    suffixes = c("", ".y"))
    if ("patient_id.y" %in% names(joined)) {
      joined$patient_id <- joined$patient_id %||% joined$patient_id.y
      joined$patient_id.y <- NULL
    }
  }

  joined <- joined[is.finite(joined$stat) &
                   is.finite(joined$time) &
                   !is.na(joined$status), , drop = FALSE]
  if (nrow(joined) < 5L) {
    stop("Need at least 5 samples with complete data to fit Cox model.",
         call. = FALSE)
  }

  density_covariates <- character()
  if (adjust_density) {
    if ("tissue_area" %in% names(joined)) {
      joined$log_area <- log(pmax(joined$tissue_area, 1))
      density_covariates <- c(density_covariates, "log_area")
    }
    if ("n_focal" %in% names(joined)) {
      density_covariates <- c(density_covariates, "n_focal")
    }
  }

  # Optional dichotomization.
  group <- NULL
  if (dichotomize == "median") {
    cut <- stats::median(joined$stat, na.rm = TRUE)
    joined$group <- factor(ifelse(joined$stat >= cut, "high", "low"),
                           levels = c("low", "high"))
    group <- "group"
  } else if (dichotomize == "tertile") {
    qs <- stats::quantile(joined$stat, c(1/3, 2/3), na.rm = TRUE)
    grp <- ifelse(joined$stat <= qs[1], "low",
                  ifelse(joined$stat >= qs[2], "high", NA_character_))
    keep <- !is.na(grp)
    joined <- joined[keep, , drop = FALSE]
    joined$group <- factor(grp[keep], levels = c("low", "high"))
    group <- "group"
  } else if (dichotomize == "trichotomize") {
    qs <- stats::quantile(joined$stat, c(1/3, 2/3), na.rm = TRUE)
    grp <- ifelse(joined$stat <= qs[1], "low",
                  ifelse(joined$stat >= qs[2], "high", "medium"))
    joined$group <- factor(grp, levels = c("low", "medium", "high"))
    group <- "group"
  }

  predictors <- c(
    if (!is.null(group)) "group" else "stat",
    intersect(covariates, names(joined)),
    intersect(density_covariates, names(joined))
  )
  predictors <- unique(predictors)
  formula <- stats::as.formula(
    paste("survival::Surv(time, status) ~", paste(predictors, collapse = " + "))
  )

  cluster_vec <- resolve_cluster_vector(joined, cluster_id)
  fit <- if (!is.null(cluster_vec)) {
    survival::coxph(formula, data = joined, cluster = cluster_vec)
  } else {
    survival::coxph(formula, data = joined)
  }
  s <- summary(fit)

  coef_tbl <- as.data.frame(s$coefficients, stringsAsFactors = FALSE)
  ci_tbl <- as.data.frame(s$conf.int, stringsAsFactors = FALSE)
  coef_tbl$term <- rownames(coef_tbl)
  ci_tbl$term  <- rownames(ci_tbl)
  rownames(coef_tbl) <- NULL
  rownames(ci_tbl) <- NULL

  primary_term <- if (!is.null(group)) "grouphigh" else "stat"
  primary_idx <- match(primary_term, coef_tbl$term)
  if (is.na(primary_idx)) primary_idx <- 1L

  primary <- list(
    term     = coef_tbl$term[primary_idx],
    coef     = coef_tbl[["coef"]][primary_idx],
    hr       = ci_tbl[["exp(coef)"]][primary_idx],
    hr_lower = ci_tbl[["lower .95"]][primary_idx],
    hr_upper = ci_tbl[["upper .95"]][primary_idx],
    se       = coef_tbl[["se(coef)"]][primary_idx],
    p_value  = coef_tbl[[grep("Pr\\(>\\|z\\|\\)|^p$",
                              names(coef_tbl), value = TRUE)[1]]][primary_idx]
  )

  km <- if (!is.null(group)) build_km(joined) else NULL

  n_clusters <- if (!is.null(cluster_vec)) {
    length(unique(cluster_vec))
  } else {
    NA_integer_
  }

  list(
    n               = nrow(joined),
    n_events        = sum(joined$status == 1, na.rm = TRUE),
    n_clusters      = n_clusters,
    formula         = deparse(formula),
    dichotomize     = dichotomize,
    adjust_density  = adjust_density,
    clustered       = !is.null(cluster_vec),
    cluster_id      = if (!is.null(cluster_vec)) cluster_id else NULL,
    density_covariates = intersect(density_covariates, names(joined)),
    primary         = primary,
    coefficients    = coef_tbl,
    confidence_intervals = ci_tbl,
    concordance     = unname(s$concordance[1]),
    logtest         = unname(s$logtest),
    km              = km
  )
}

#' Bivariate Cox PH: joint 2×2 stratification of clustering vs abundance.
#'
#' Dichotomizes the spatial-clustering statistic and an abundance measure
#' (count or percentage of T-cells) independently at their medians (or tertile
#' extremes), forms a 4-level joint group, and fits a Cox PH model with that
#' factor as the sole predictor (plus optional covariates).  The reference
#' level is "low_cluster_low_abund" (cold, dispersed tumour).
#'
#' @param stats_per_sample data.frame with sample_id, stat (clustering scalar),
#'   and optionally n_focal / tissue_area.
#' @param abund_per_sample data.frame with sample_id, abund (abundance scalar).
#' @param surv_df data.frame with sample_id, time, status.
#' @param split One of "median" (split each axis at its median) or "tertile"
#'   (keep only the extreme thirds of each axis; reduces sample size but
#'   maximises contrast).
#' @param covariates Optional character vector of covariate column names in
#'   surv_df.
#' @param cluster_id Optional column for cluster-robust SE (e.g. "patient_id").
#' @param adjust_density If TRUE, add log(tissue_area) and n_focal as Cox
#'   covariates to reduce confounding between the clustering statistic and raw
#'   cell density. Requires n_focal and tissue_area columns in
#'   stats_per_sample (produced automatically by spatial_summary_at_r).
#' @return List with Cox results, 4-strata KM, and per-quadrant sample counts.
cox_bivariate <- function(stats_per_sample, abund_per_sample, surv_df,
                          split = c("median", "tertile"),
                          covariates = character(),
                          cluster_id = NULL,
                          adjust_density = FALSE) {
  split <- match.arg(split)
  if (!requireNamespace("survival", quietly = TRUE)) {
    stop("Package 'survival' is required.", call. = FALSE)
  }
  if (!is.data.frame(stats_per_sample) || nrow(stats_per_sample) == 0L) {
    stop("stats_per_sample must be a non-empty data.frame.", call. = FALSE)
  }
  if (!is.data.frame(abund_per_sample) || nrow(abund_per_sample) == 0L) {
    stop("abund_per_sample must be a non-empty data.frame.", call. = FALSE)
  }
  if (!is.data.frame(surv_df) || nrow(surv_df) == 0L) {
    stop("surv_df must be a non-empty data.frame.", call. = FALSE)
  }

  # Join clustering stat and abundance onto survival.
  # Carry n_focal and tissue_area through so density adjustment is available.
  stat_cols <- intersect(c("sample_id", "stat", "n_focal", "tissue_area"),
                         names(stats_per_sample))
  joined <- merge(stats_per_sample[, stat_cols, drop = FALSE],
                  abund_per_sample[, c("sample_id", "abund"), drop = FALSE],
                  by = "sample_id")
  joined <- merge(joined, surv_df, by = "sample_id")

  # Patient-level fallback.
  if (nrow(joined) == 0L && "patient_id" %in% names(surv_df)) {
    abund_tmp <- abund_per_sample[, c("sample_id", "abund"), drop = FALSE]
    stat_tmp  <- stats_per_sample[, c("sample_id", "stat"), drop = FALSE]
    tmp <- merge(stat_tmp, abund_tmp, by = "sample_id")
    joined <- merge(tmp, surv_df, by.x = "sample_id", by.y = "patient_id")
  }
  if (nrow(joined) == 0L) {
    stop("No overlap between sample_ids across clustering, abundance, and survival data.",
         call. = FALSE)
  }

  # Propagate patient_id for cluster-robust SE.
  if (!"patient_id" %in% names(joined) && "patient_id" %in% names(surv_df)) {
    pid_map <- unique(surv_df[, c("sample_id", "patient_id"), drop = FALSE])
    joined <- merge(joined, pid_map, by = "sample_id", all.x = TRUE,
                    suffixes = c("", ".surv"))
    if ("patient_id.surv" %in% names(joined)) {
      joined$patient_id <- joined$patient_id %||% joined$patient_id.surv
      joined$patient_id.surv <- NULL
    }
  }

  joined <- joined[is.finite(joined$stat) & is.finite(joined$abund) &
                   is.finite(joined$time) & !is.na(joined$status), ,
                   drop = FALSE]
  if (nrow(joined) < 8L) {
    stop("Need at least 8 samples with complete data for bivariate Cox.",
         call. = FALSE)
  }

  # Optional density adjustment: add log(tissue_area) and n_focal as covariates
  # so the clustering split is not confounded by raw cell count or core size.
  density_covariates <- character()
  if (adjust_density) {
    if ("tissue_area" %in% names(joined)) {
      joined$log_area <- log(pmax(joined$tissue_area, 1))
      density_covariates <- c(density_covariates, "log_area")
    }
    if ("n_focal" %in% names(joined)) {
      density_covariates <- c(density_covariates, "n_focal")
    }
  }

  # Dichotomize each axis independently.
  if (split == "median") {
    cut_stat  <- stats::median(joined$stat,  na.rm = TRUE)
    cut_abund <- stats::median(joined$abund, na.rm = TRUE)
    cgrp <- ifelse(joined$stat  >= cut_stat,  "high_cluster", "low_cluster")
    agrp <- ifelse(joined$abund >= cut_abund, "high_abund",   "low_abund")
  } else {
    qs_stat  <- stats::quantile(joined$stat,  c(1/3, 2/3), na.rm = TRUE)
    qs_abund <- stats::quantile(joined$abund, c(1/3, 2/3), na.rm = TRUE)
    cgrp <- ifelse(joined$stat  <= qs_stat[1],  "low_cluster",
                   ifelse(joined$stat  >= qs_stat[2],  "high_cluster", NA_character_))
    agrp <- ifelse(joined$abund <= qs_abund[1], "low_abund",
                   ifelse(joined$abund >= qs_abund[2], "high_abund",   NA_character_))
    keep <- !is.na(cgrp) & !is.na(agrp)
    joined <- joined[keep, , drop = FALSE]
    cgrp   <- cgrp[keep]
    agrp   <- agrp[keep]
    if (nrow(joined) < 8L) {
      stop("Need at least 8 samples in the extreme tertiles for bivariate Cox.",
           call. = FALSE)
    }
  }

  joined$joint_group <- factor(
    paste(cgrp, agrp, sep = "_"),
    levels = c(
      "low_cluster_low_abund",
      "high_cluster_low_abund",
      "low_cluster_high_abund",
      "high_cluster_high_abund"
    )
  )

  predictors <- unique(c(
    "joint_group",
    intersect(covariates, names(joined)),
    intersect(density_covariates, names(joined))
  ))
  formula <- stats::as.formula(
    paste("survival::Surv(time, status) ~", paste(predictors, collapse = " + "))
  )

  cluster_vec <- resolve_cluster_vector(joined, cluster_id)
  fit <- if (!is.null(cluster_vec)) {
    survival::coxph(formula, data = joined, cluster = cluster_vec)
  } else {
    survival::coxph(formula, data = joined)
  }
  s <- summary(fit)

  coef_tbl <- as.data.frame(s$coefficients, stringsAsFactors = FALSE)
  ci_tbl   <- as.data.frame(s$conf.int,    stringsAsFactors = FALSE)
  coef_tbl$term <- rownames(coef_tbl)
  ci_tbl$term   <- rownames(ci_tbl)
  rownames(coef_tbl) <- NULL
  rownames(ci_tbl)   <- NULL

  # Primary term = highest-HR joint_group contrast.
  jg_terms <- grep("^joint_group", coef_tbl$term, value = TRUE)
  if (length(jg_terms) == 0L) {
    primary_idx <- 1L
  } else {
    p_col <- grep("Pr\\(>\\|z\\|\\)|^p$", names(coef_tbl), value = TRUE)[1]
    primary_idx <- which(coef_tbl$term %in% jg_terms)[
      which.min(coef_tbl[[p_col]][coef_tbl$term %in% jg_terms])
    ]
  }

  primary <- list(
    term     = coef_tbl$term[primary_idx],
    coef     = coef_tbl[["coef"]][primary_idx],
    hr       = ci_tbl[["exp(coef)"]][primary_idx],
    hr_lower = ci_tbl[["lower .95"]][primary_idx],
    hr_upper = ci_tbl[["upper .95"]][primary_idx],
    se       = coef_tbl[["se(coef)"]][primary_idx],
    p_value  = coef_tbl[[grep("Pr\\(>\\|z\\|\\)|^p$",
                               names(coef_tbl), value = TRUE)[1]]][primary_idx]
  )

  # Per-quadrant sample counts.
  quad_tbl <- as.data.frame(table(joined$joint_group), stringsAsFactors = FALSE)
  names(quad_tbl) <- c("label", "n")
  ev_tbl <- tapply(joined$status, joined$joint_group, sum, na.rm = TRUE)
  quad_tbl$n_events <- as.integer(ev_tbl[quad_tbl$label])

  # 4-strata KM using the joint group.
  km_fit <- survival::survfit(survival::Surv(time, status) ~ joint_group,
                               data = joined)
  strata_names <- if (is.null(km_fit$strata)) "all" else {
    rep(names(km_fit$strata), km_fit$strata)
  }
  strata_names <- sub("^joint_group=", "", strata_names)

  km <- list(
    time    = as.numeric(km_fit$time),
    surv    = as.numeric(km_fit$surv),
    n_risk  = as.integer(km_fit$n.risk),
    n_event = as.integer(km_fit$n.event),
    upper   = as.numeric(km_fit$upper %||% rep(NA_real_, length(km_fit$time))),
    lower   = as.numeric(km_fit$lower %||% rep(NA_real_, length(km_fit$time))),
    group   = strata_names
  )

  n_clusters <- if (!is.null(cluster_vec)) length(unique(cluster_vec)) else NA_integer_

  list(
    n            = nrow(joined),
    n_events     = sum(joined$status == 1, na.rm = TRUE),
    n_clusters   = n_clusters,
    formula      = deparse(formula),
    split        = split,
    adjust_density  = adjust_density,
    density_covariates = intersect(density_covariates, names(joined)),
    clustered    = !is.null(cluster_vec),
    cluster_id   = if (!is.null(cluster_vec)) cluster_id else NULL,
    concordance  = unname(s$concordance[1]),
    logtest      = unname(s$logtest),
    quadrants    = quad_tbl,
    primary      = primary,
    coefficients          = coef_tbl,
    confidence_intervals  = ci_tbl,
    km           = km
  )
}

#' Resolve a cluster vector when multiple observations share a cluster id.
resolve_cluster_vector <- function(df, cluster_id) {
  if (is.null(cluster_id) || !nzchar(cluster_id)) return(NULL)
  if (!cluster_id %in% names(df)) return(NULL)
  vec <- df[[cluster_id]]
  if (all(is.na(vec))) return(NULL)
  if (!any(duplicated(vec[!is.na(vec)]))) return(NULL)
  vec
}

#' Reduce survival metadata to one row per analysis unit (sample or patient).
prepare_survival_for_level <- function(surv_df, level = c("sample", "patient")) {
  level <- match.arg(level)
  if (level == "sample" || nrow(surv_df) == 0L) return(surv_df)

  if ("patient_id" %in% names(surv_df) && any(!is.na(surv_df$patient_id))) {
    id_vec <- surv_df$patient_id
  } else {
    return(surv_df)
  }

  keep <- !duplicated(id_vec)
  out <- surv_df[keep, , drop = FALSE]
  out$sample_id <- as.character(id_vec[keep])
  out
}

#' Aggregate per-sample spatial summaries to patient level (mean per axis).
aggregate_cox_stats <- function(per_sample_stat, level = c("sample", "patient")) {
  level <- match.arg(level)
  if (level == "sample" || nrow(per_sample_stat) == 0L) return(per_sample_stat)

  if (!"patient_id" %in% names(per_sample_stat)) {
    per_sample_stat$patient_id <- per_sample_stat$sample_id
  }
  na_pid <- is.na(per_sample_stat$patient_id)
  if (any(na_pid)) {
    per_sample_stat$patient_id[na_pid] <- per_sample_stat$sample_id[na_pid]
  }

  numeric_cols <- intersect(c("stat", "n_focal", "tissue_area"),
                            names(per_sample_stat))
  if (length(numeric_cols) == 0L) {
    stop("per_sample_stat must include a stat column.", call. = FALSE)
  }

  agg <- stats::aggregate(
    per_sample_stat[, numeric_cols, drop = FALSE],
    by = list(patient_id = per_sample_stat$patient_id),
    FUN = function(x) if (all(is.na(x))) NA_real_ else mean(x, na.rm = TRUE)
  )
  agg$sample_id <- agg$patient_id
  agg[, c("sample_id", "patient_id", numeric_cols), drop = FALSE]
}

#' Aggregate per-sample abundance to patient level (mean).
aggregate_cox_abundance <- function(abund_per_sample, per_sample_stat,
                                    level = c("sample", "patient")) {
  level <- match.arg(level)
  if (level == "sample" || nrow(abund_per_sample) == 0L) return(abund_per_sample)

  if (!"patient_id" %in% names(per_sample_stat)) {
    per_sample_stat$patient_id <- per_sample_stat$sample_id
  }
  pid_map <- unique(per_sample_stat[, c("sample_id", "patient_id"), drop = FALSE])
  joined <- merge(abund_per_sample, pid_map, by = "sample_id", all.x = TRUE)
  na_pid <- is.na(joined$patient_id)
  if (any(na_pid)) joined$patient_id[na_pid] <- joined$sample_id[na_pid]

  agg <- stats::aggregate(
    abund ~ patient_id,
    data = joined,
    FUN = function(x) if (all(is.na(x))) NA_real_ else mean(x, na.rm = TRUE)
  )
  agg$sample_id <- agg$patient_id
  agg[, c("sample_id", "abund"), drop = FALSE]
}

#' Warn when the chosen radius is large relative to tissue core size.
radius_guidance <- function(per_sample_stat, radius, warn_fraction = 0.3) {
  radius <- as.numeric(radius)
  diameter <- NA_real_
  if ("tissue_area" %in% names(per_sample_stat)) {
    areas <- per_sample_stat$tissue_area[is.finite(per_sample_stat$tissue_area)]
    if (length(areas) > 0L) {
      diameter <- stats::median(2 * sqrt(areas / pi), na.rm = TRUE)
    }
  }
  fraction <- if (is.finite(diameter) && diameter > 0) radius / diameter else NA_real_
  warn <- isTRUE(is.finite(fraction) && fraction > warn_fraction)
  list(
    radius_px = radius,
    median_core_diameter_px = diameter,
    radius_fraction_of_diameter = fraction,
    warn = warn,
    message = if (warn) {
      sprintf(
        paste0(
          "Radius %.0f px exceeds %.0f%% of the median core diameter ",
          "(%.0f px). Edge effects may distort K/G — try a smaller radius."
        ),
        radius, warn_fraction * 100, diameter
      )
    } else {
      NULL
    }
  )
}

#' Merge spatial summaries with survival for CSV export.
build_cox_export_table <- function(per_sample_stat, surv_df,
                                   abund_per_sample = NULL,
                                   level = c("sample", "patient")) {
  level <- match.arg(level)
  stats_df <- aggregate_cox_stats(per_sample_stat, level = level)
  surv_use <- prepare_survival_for_level(surv_df, level = level)

  merged <- merge(stats_df, surv_use, by = "sample_id", all.x = FALSE)
  if (!is.null(abund_per_sample) && nrow(abund_per_sample) > 0L) {
    abund_use <- aggregate_cox_abundance(abund_per_sample, per_sample_stat,
                                         level = level)
    merged <- merge(merged, abund_use[, c("sample_id", "abund"), drop = FALSE],
                    by = "sample_id", all.x = TRUE)
  }
  merged$analysis_level <- level
  merged
}

#' Generate Kaplan-Meier step-function points for plotting on the frontend.
build_km <- function(df) {
  fit <- survival::survfit(
    survival::Surv(time, status) ~ group, data = df
  )
  strata_names <- if (is.null(fit$strata)) "all" else {
    rep(names(fit$strata), fit$strata)
  }
  # Strip the "group=" prefix that survfit attaches.
  strata_names <- sub("^group=", "", strata_names)

  list(
    time   = as.numeric(fit$time),
    surv   = as.numeric(fit$surv),
    n_risk = as.integer(fit$n.risk),
    n_event = as.integer(fit$n.event),
    upper  = as.numeric(fit$upper %||% rep(NA_real_, length(fit$time))),
    lower  = as.numeric(fit$lower %||% rep(NA_real_, length(fit$time))),
    group  = strata_names
  )
}
