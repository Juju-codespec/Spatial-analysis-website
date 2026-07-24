# Linear and logistic models linking per-sample spatial clustering to
# clinical outcomes, with optional clinical covariates (age, stage, grade).

#' Columns in survival/clinical metadata suitable as model outcomes.
eligible_outcome_columns <- function(surv_df) {
  if (is.null(surv_df) || nrow(surv_df) == 0L) return(character())
  skip <- c("sample_id", "patient_id")
  cols <- setdiff(names(surv_df), skip)
  eligible <- character()
  for (col in cols) {
    vals <- surv_df[[col]]
    vals <- vals[!is.na(vals)]
    if (length(vals) == 0L) next
    if (is.numeric(vals)) {
      if (length(unique(vals)) >= 2L) eligible <- c(eligible, col)
    } else {
      u <- unique(as.character(vals))
      if (length(u) >= 2L && length(u) <= 8L) eligible <- c(eligible, col)
    }
  }
  unique(eligible)
}

#' Columns suitable as additional covariates (excludes outcome and ids).
eligible_covariate_columns <- function(surv_df, outcome_column) {
  if (is.null(surv_df) || nrow(surv_df) == 0L) return(character())
  skip <- c("sample_id", "patient_id", outcome_column)
  cols <- setdiff(names(surv_df), skip)
  cols[vapply(cols, function(col) {
    vals <- surv_df[[col]]
    vals <- vals[!is.na(vals)]
    length(vals) > 0L
  }, logical(1))]
}

is_binary_outcome <- function(x) {
  x <- x[!is.na(x)]
  if (length(x) == 0L) return(FALSE)
  if (is.numeric(x) && all(x %in% c(0, 1))) return(TRUE)
  length(unique(as.character(x))) == 2L
}

coerce_binary_outcome <- function(x) {
  if (is.numeric(x) && all(na.omit(x) %in% c(0, 1))) return(as.integer(x))
  u <- sort(unique(as.character(x[!is.na(x)])))
  as.integer(match(as.character(x), u)) - 1L
}

prepare_predictor <- function(x) {
  if (is.numeric(x)) return(x)
  factor(x)
}

#' Fit lm or glm predicting a clinical outcome from spatial stat + covariates.
linear_from_stat <- function(stats_per_sample, surv_df,
                             outcome_column,
                             covariates = character(),
                             dichotomize = c("none", "median", "tertile", "trichotomize"),
                             adjust_density = FALSE,
                             cluster_id = NULL) {
  dichotomize <- match.arg(dichotomize)
  outcome_column <- as.character(outcome_column)
  if (!outcome_column %in% names(surv_df)) {
    stop(sprintf("Outcome column '%s' not found in clinical data.", outcome_column),
         call. = FALSE)
  }
  if (!is.data.frame(stats_per_sample) || nrow(stats_per_sample) == 0L) {
    stop("stats_per_sample must be a non-empty data.frame.", call. = FALSE)
  }
  if (!is.data.frame(surv_df) || nrow(surv_df) == 0L) {
    stop("surv_df must include at least one row of clinical data.",
         call. = FALSE)
  }

  joined <- merge_stats_survival(stats_per_sample, surv_df)
  if (nrow(joined) == 0L) {
    stop("No overlap between sample_ids in spatial stats and clinical data.",
         call. = FALSE)
  }

  if (!"patient_id" %in% names(joined) && "patient_id" %in% names(surv_df)) {
    pid_map <- unique(surv_df[, c("sample_id", "patient_id"), drop = FALSE])
    joined <- merge(joined, pid_map, by = "sample_id", all.x = TRUE,
                    suffixes = c("", ".y"))
    if ("patient_id.y" %in% names(joined)) {
      joined$patient_id <- joined$patient_id %||% joined$patient_id.y
      joined$patient_id.y <- NULL
    }
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

  joined <- joined[is.finite(joined$stat) & is.finite(joined$.outcome), ,
                   drop = FALSE]
  if (nrow(joined) < 5L) {
    stop("Need at least 5 samples with complete data to fit the model.",
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
    if (nrow(joined) < 5L) {
      stop("Need at least 5 samples after tertile split to fit the model.",
           call. = FALSE)
    }
  } else if (dichotomize == "trichotomize") {
    qs <- stats::quantile(joined$stat, c(1/3, 2/3), na.rm = TRUE)
    grp <- ifelse(joined$stat <= qs[1], "low",
                  ifelse(joined$stat >= qs[2], "high", "medium"))
    joined$group <- factor(grp, levels = c("low", "medium", "high"))
    group <- "group"
    if (nrow(joined) < 5L) {
      stop("Need at least 5 samples after trichotomization to fit the model.",
           call. = FALSE)
    }
  }

  covariates <- intersect(covariates, names(joined))
  for (col in covariates) {
    joined[[col]] <- prepare_predictor(joined[[col]])
  }
  # Drop factor covariates that have fewer than 2 levels in the filtered data;
  # glm/lm throws "contrasts can be applied only to factors with 2 or more
  # levels" otherwise (e.g. when all samples share the same race or stage).
  covariates <- covariates[vapply(covariates, function(col) {
    v <- joined[[col]]
    !is.factor(v) || nlevels(droplevels(v)) >= 2L
  }, logical(1L))]

  predictors <- c(
    if (!is.null(group)) group else "stat",
    covariates,
    intersect(density_covariates, names(joined))
  )
  predictors <- unique(predictors)
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

  primary_term <- if (!is.null(group)) "grouphigh" else "stat"
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

  n_clusters <- if (!is.null(cluster_vec)) {
    length(unique(cluster_vec))
  } else {
    NA_integer_
  }

  fit_stats <- if (binary) {
    list(
      aic = stats::AIC(fit),
      null_deviance = fit$null.deviance,
      deviance = fit$deviance
    )
  } else {
    s <- summary(fit)
    list(
      r_squared = unname(s$r.squared),
      adj_r_squared = unname(s$adj.r.squared),
      sigma = unname(s$sigma)
    )
  }

  supp <- linear_model_supplement(fit, joined, binary,
                                covariates = covariates)
  supp$estimate_table <- build_estimate_table(coef_info, ci_info, binary)

  c(list(
    n                  = nrow(joined),
    formula            = deparse(formula),
    family             = if (binary) "binomial" else "gaussian",
    outcome_column     = outcome_column,
    covariates         = covariates,
    dichotomize        = dichotomize,
    adjust_density     = adjust_density,
    clustered          = !is.null(cluster_vec),
    cluster_id         = if (!is.null(cluster_vec)) cluster_id else NULL,
    density_covariates = intersect(density_covariates, names(joined)),
    n_clusters         = n_clusters,
    primary            = primary,
    coefficients       = coef_info,
    confidence_intervals = data.frame(
      term = ci_info$term,
      lower = ci_info$lower,
      upper = ci_info$upper,
      stringsAsFactors = FALSE
    ),
    estimate_table     = supp$estimate_table,
    model_rows         = supp$model_rows,
    outcome_frequency  = supp$outcome_frequency,
    observed_predicted = supp$observed_predicted,
    covariate_frequencies = supp$covariate_frequencies
  ), fit_stats)
}

linear_coef_table <- function(fit, cluster_vec, logistic = FALSE) {
  cb <- stats::coef(fit)
  if (!is.null(cluster_vec) && requireNamespace("sandwich", quietly = TRUE)) {
    vc <- sandwich::vcovCL(fit, cluster = cluster_vec, type = "HC0")
    se <- sqrt(diag(vc))
    est <- cb
  } else {
    s <- summary(fit)
    if (logistic) {
      est <- s$coefficients[, "Estimate"]
      se <- s$coefficients[, "Std. Error"]
    } else {
      est <- s$coefficients[, "Estimate"]
      se <- s$coefficients[, "Std. Error"]
    }
  }
  z <- est / se
  p <- 2 * stats::pnorm(-abs(z))
  data.frame(
    term = names(est),
    estimate = as.numeric(est),
    se = as.numeric(se),
    z = as.numeric(z),
    p_value = as.numeric(p),
    stringsAsFactors = FALSE
  )
}

linear_confint <- function(fit, cluster_vec, logistic = FALSE, level = 0.95) {
  if (!is.null(cluster_vec) && requireNamespace("sandwich", quietly = TRUE)) {
    vc <- sandwich::vcovCL(fit, cluster = cluster_vec, type = "HC0")
    cb <- stats::coef(fit)
    se <- sqrt(diag(vc))
    z <- stats::qnorm(1 - (1 - level) / 2)
    lower <- cb - z * se
    upper <- cb + z * se
    return(data.frame(
      term = names(cb),
      lower = as.numeric(lower),
      upper = as.numeric(upper),
      stringsAsFactors = FALSE
    ))
  }
  cb <- stats::coef(fit)
  se <- sqrt(diag(stats::vcov(fit)))
  z <- stats::qnorm(1 - (1 - level) / 2)
  data.frame(
    term = names(cb),
    lower = as.numeric(cb - z * se),
    upper = as.numeric(cb + z * se),
    stringsAsFactors = FALSE
  )
}

#' Coefficient table with confidence intervals and optional odds ratios.
build_estimate_table <- function(coef_info, ci_info, logistic = FALSE) {
  data.frame(
    term = coef_info$term,
    estimate = coef_info$estimate,
    se = coef_info$se,
    ci_lower = ci_info$lower,
    ci_upper = ci_info$upper,
    p_value = coef_info$p_value,
    odds_ratio = if (logistic) exp(coef_info$estimate) else NA_real_,
    or_lower = if (logistic) exp(ci_info$lower) else NA_real_,
    or_upper = if (logistic) exp(ci_info$upper) else NA_real_,
    stringsAsFactors = FALSE
  )
}

#' Per-sample predictions, outcome frequencies, and covariate cross-tabs.
linear_model_supplement <- function(fit, joined, binary,
                                    outcome_var = ".outcome",
                                    covariates = character()) {
  fitted <- stats::fitted(fit)
  resid <- stats::residuals(fit)

  rows <- list(
    sample_id = as.character(joined$sample_id),
    observed = as.numeric(joined[[outcome_var]]),
    fitted = as.numeric(fitted),
    residual = as.numeric(resid)
  )
  if ("patient_id" %in% names(joined)) {
    rows$patient_id <- as.character(joined$patient_id)
  }
  if (binary) {
    prob <- stats::predict(fit, type = "response")
    rows$predicted_prob <- as.numeric(prob)
    rows$predicted_class <- as.integer(prob >= 0.5)
  }
  if ("stat" %in% names(joined)) {
    rows$clustering_stat <- as.numeric(joined$stat)
  }
  if ("group" %in% names(joined)) {
    rows$clustering_group <- as.character(joined$group)
  }
  if ("spatial_cluster_stat" %in% names(joined)) {
    rows$spatial_cluster_stat <- as.numeric(joined$spatial_cluster_stat)
  }
  for (col in intersect(covariates, names(joined))) {
    v <- joined[[col]]
    rows[[col]] <- if (is.numeric(v)) as.numeric(v) else as.character(v)
  }

  model_rows <- as.data.frame(rows, stringsAsFactors = FALSE)

  outcome_tb <- table(joined[[outcome_var]], useNA = "no")
  outcome_frequency <- if (length(outcome_tb) == 0L) {
    data.frame(level = character(), count = integer(), stringsAsFactors = FALSE)
  } else {
    data.frame(
      level = names(outcome_tb),
      count = as.integer(outcome_tb),
      stringsAsFactors = FALSE
    )
  }

  observed_predicted <- NULL
  if (binary) {
    op_tb <- table(
      observed = joined[[outcome_var]],
      predicted = rows$predicted_class,
      useNA = "no"
    )
    if (length(op_tb) == 0L) {
      observed_predicted <- data.frame(
        observed = character(), predicted = character(), count = integer(),
        stringsAsFactors = FALSE
      )
    } else {
      observed_predicted <- as.data.frame(as.table(op_tb), stringsAsFactors = FALSE)
      names(observed_predicted) <- c("observed", "predicted", "count")
      observed_predicted$observed <- as.character(observed_predicted$observed)
      observed_predicted$predicted <- as.character(observed_predicted$predicted)
      observed_predicted$count <- as.integer(observed_predicted$count)
    }
  }

  covariate_frequencies <- list()
  for (col in intersect(covariates, names(joined))) {
    ct_tb <- table(
      covariate_level = joined[[col]],
      outcome = joined[[outcome_var]],
      useNA = "no"
    )
    if (length(ct_tb) == 0L) next
    tab <- as.data.frame(as.table(ct_tb), stringsAsFactors = FALSE)
    names(tab) <- c("covariate_level", "outcome", "count")
    tab$covariate <- col
    tab$covariate_level <- as.character(tab$covariate_level)
    tab$outcome <- as.character(tab$outcome)
    tab$count <- as.integer(tab$count)
    covariate_frequencies[[col]] <- tab
  }

  list(
    model_rows = model_rows,
    estimate_table = NULL,
    outcome_frequency = outcome_frequency,
    observed_predicted = observed_predicted,
    covariate_frequencies = covariate_frequencies
  )
}
