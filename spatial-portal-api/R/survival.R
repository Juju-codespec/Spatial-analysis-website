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
#'   (split at median into high/low), or "tertile" (drop middle third).
#' @param adjust_density If TRUE, adjust for focal cell count and log tissue
#'   area to reduce confounding between clustering and cell density.
#' @param cluster_id Optional column name in the merged data for cluster-robust
#'   standard errors (e.g. "patient_id" when multiple cores share a patient).
#' @return A list ready for JSON: coefficient table, hazard ratio, 95% CI,
#'   p-value, and KM curve points (for dichotomized fits) or stratified
#'   placeholders.
cox_from_stat <- function(stats_per_sample, surv_df,
                          covariates = character(),
                          dichotomize = c("none", "median", "tertile"),
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

#' Resolve a cluster vector when multiple observations share a cluster id.
resolve_cluster_vector <- function(df, cluster_id) {
  if (is.null(cluster_id) || !nzchar(cluster_id)) return(NULL)
  if (!cluster_id %in% names(df)) return(NULL)
  vec <- df[[cluster_id]]
  if (all(is.na(vec))) return(NULL)
  if (!any(duplicated(vec[!is.na(vec)]))) return(NULL)
  vec
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
