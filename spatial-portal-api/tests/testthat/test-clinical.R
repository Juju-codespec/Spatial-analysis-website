test_that("aggregate_cell_features returns counts pcts and ratios", {
  cells <- make_synthetic_cells(n_per_sample = 100, n_samples = 4)
  feat <- aggregate_cell_features(cells, level = "sample")
  expect_true("sample_id" %in% names(feat))
  expect_true("n_total" %in% names(feat))
  expect_gt(ncol(feat), 5L)
  count_cols <- grep("^count_", names(feat), value = TRUE)
  pct_cols <- grep("^pct_", names(feat), value = TRUE)
  expect_gt(length(count_cols), 0L)
  expect_gt(length(pct_cols), 0L)
  expect_equal(sum(feat$n_total), nrow(cells))
})

test_that("clinical_wilcoxon compares feature between arms", {
  cells <- make_synthetic_cells(n_per_sample = 80, n_samples = 12)
  feat <- aggregate_cell_features(cells, level = "sample")
  surv <- make_synthetic_survival(feat$sample_id)
  col <- grep("^pct_", names(feat), value = TRUE)[1]
  wx <- clinical_wilcoxon(feat, surv, feature_column = col, group_column = "arm")
  expect_true(is.finite(wx$p_value))
  expect_length(wx$groups, 2L)
})

test_that("clinical_linear fits with cell features and covariates", {
  cells <- make_synthetic_cells(n_per_sample = 80, n_samples = 20)
  feat <- aggregate_cell_features(cells, level = "sample")
  surv <- make_synthetic_survival(feat$sample_id)
  pct <- grep("^pct_", names(feat), value = TRUE)[1]
  res <- clinical_linear(
    feat, surv,
    outcome_column = "status",
    feature_columns = pct,
    covariates = c("age", "stage")
  )
  expect_equal(res$family, "binomial")
  expect_true("age" %in% res$predictors)
  expect_true(is.finite(res$primary$p_value))
  expect_gt(nrow(res$estimate_table), 0L)
  expect_gt(nrow(res$model_rows), 0L)
  expect_gt(nrow(res$outcome_frequency), 0L)
})

test_that("clinical_survival returns cox km and logrank", {
  cells <- make_synthetic_cells(n_per_sample = 80, n_samples = 20)
  feat <- aggregate_cell_features(cells, level = "sample")
  surv <- make_synthetic_survival(feat$sample_id)
  pct <- grep("^pct_", names(feat), value = TRUE)[1]
  out <- clinical_survival(feat, surv, feature_column = pct,
                           dichotomize = "median")
  expect_true(!is.null(out$cox$primary$hr))
  expect_true(!is.null(out$cox$km))
  expect_true(is.finite(out$logrank$p_value))
})

test_that("clinical_summary_data merges features and clinical columns", {
  cells <- make_synthetic_cells(n_per_sample = 60, n_samples = 10)
  feat <- aggregate_cell_features(cells, level = "sample")
  surv <- make_synthetic_survival(feat$sample_id)
  surv$race <- sample(c("A", "B", "C"), nrow(surv), replace = TRUE)
  surv$sex <- sample(c("F", "M"), nrow(surv), replace = TRUE)
  ds <- list(cells = cells, survival = surv)
  out <- clinical_summary_data(ds, level = "sample")
  expect_true(out$has_clinical)
  expect_true("age" %in% out$clinical_columns)
  expect_gt(length(out$markers), 0L)
  expect_gt(nrow(out$rows), 0L)
})

test_that("clinical_pair_test uses beta-binomial for pct and count markers", {
  cells <- make_synthetic_cells(n_per_sample = 50, n_samples = 12)
  surv <- make_synthetic_survival(unique(cells$sample_id))
  ds <- list(cells = cells, survival = surv)
  merged <- clinical_summary_data(ds)$rows
  pct <- grep("^pct_", names(merged), value = TRUE)[1]
  cnt <- grep("^count_", names(merged), value = TRUE)[1]
  t1 <- clinical_pair_test(merged, pct, "age")
  expect_equal(t1$effect_metric, "log_odds")
  t2 <- clinical_pair_test(merged, cnt, "arm")
  expect_equal(t2$effect_metric, "log_odds")
  if (requireNamespace("aod", quietly = TRUE) || requireNamespace("glmmTMB", quietly = TRUE)) {
    expect_true(grepl("^Beta-binomial", t1$method))
    expect_true(grepl("^Beta-binomial", t2$method))
    expect_false(grepl("Quasibinomial", t1$method))
    expect_false(grepl("Quasibinomial", t2$method))
  } else {
    expect_true(grepl("Quasibinomial", t1$method))
  }
})

test_that("fit_aod_betabin returns SEs via vcov dispatch", {
  skip_if_not_installed("aod")
  set.seed(42)
  n <- 24L
  df <- data.frame(
    .k = pmin(sample(20:90, n, replace = TRUE), 150L),
    .n = sample(120:220, n, replace = TRUE),
    .cl = factor(rep(c("A", "B"), each = n / 2L)),
    stringsAsFactors = FALSE
  )
  fml <- cbind(.k, .n - .k) ~ .cl
  res <- fit_aod_betabin(fml, df)
  expect_false(is.null(res))
  expect_true(grepl("^Beta-binomial \\(aod\\)", res$method))
  expect_true(all(is.finite(res$se)))
  expect_true(all(res$se > 0))
})

test_that("clinical_pair_test keeps Wilcoxon and Spearman for non-count endpoints", {
  set.seed(202)
  n <- 20L
  df <- data.frame(
    marker_cont = stats::rnorm(n),
    arm = rep(c("A", "B"), each = n / 2L),
    age = seq_len(n) + stats::rnorm(n, sd = 0.2),
    stringsAsFactors = FALSE
  )
  t_cat <- clinical_pair_test(df, "marker_cont", "arm")
  expect_equal(t_cat$method, "Wilcoxon rank sum")
  expect_equal(t_cat$effect_metric, "rank_biserial")

  t_num <- clinical_pair_test(df, "marker_cont", "age")
  expect_equal(t_num$method, "Spearman rank correlation")
  expect_equal(t_num$effect_metric, "rho")
})

test_that("attach_spatial_cluster_stat aggregates to patient level", {
  cells <- make_synthetic_cells(n_per_sample = 80, n_samples = 8)
  feat <- aggregate_cell_features(cells, level = "patient")
  spatial_cfg <- list(
    enabled = TRUE,
    statistic = "K",
    type_a = "CD8+ T Cell",
    radius = 50
  )
  out <- attach_spatial_cluster_stat(feat, cells, spatial_cfg, level = "patient")
  expect_true("spatial_cluster_stat" %in% names(out))
  expect_equal(nrow(out), nrow(feat))
  expect_true(any(is.finite(out$spatial_cluster_stat)))
})

test_that("build_clinical_features includes spatial stat when configured", {
  cells <- make_synthetic_cells(n_per_sample = 80, n_samples = 6)
  ds <- list(cells = cells, survival = NULL)
  spatial_cfg <- list(enabled = TRUE, statistic = "K", type_a = "CD8+ T Cell", radius = 50)
  feat <- build_clinical_features(ds, level = "sample", spatial_cfg = spatial_cfg)
  cols <- clinical_feature_columns(feat)
  expect_true("spatial_cluster_stat" %in% cols)
})

test_that("clinical_feature_columns includes spatial_cluster_stat", {
  df <- data.frame(
    sample_id = c("s1", "s2"),
    spatial_cluster_stat = c(0.1, 0.2),
    pct_CD8 = c(10, 20),
    stringsAsFactors = FALSE
  )
  cols <- clinical_feature_columns(df)
  expect_true("spatial_cluster_stat" %in% cols)
  expect_true("pct_CD8" %in% cols)
})

test_that("clinical_association_matrix returns FDR-adjusted tests", {
  cells <- make_synthetic_cells(n_per_sample = 80, n_samples = 12)
  surv <- make_synthetic_survival(unique(cells$sample_id))
  surv$race <- sample(c("A", "B", "C"), nrow(surv), replace = TRUE)
  ds <- list(cells = cells, survival = surv)
  out <- clinical_association_matrix(ds, level = "sample", max_pairs = 12L)
  expect_gt(out$n_tests, 0L)
  expect_true(any(is.finite(vapply(out$tests, function(t) t$fdr %||% NA_real_, numeric(1)))))
  expect_false(out$include_counts)
  expect_false(any(grepl("^count_", out$marker_columns)))
  expect_true("n_pairs_possible" %in% names(out))
  expect_true("effect_summary" %in% names(out$tests[[1]]))
  expect_true("effect_size" %in% names(out$tests[[1]]))
  expect_true("direction" %in% names(out$tests[[1]]))
})

test_that("clinical_association_matrix supports mixed methods with stable FDR", {
  cells <- make_synthetic_cells(n_per_sample = 80, n_samples = 12)
  surv <- make_synthetic_survival(unique(cells$sample_id))
  ds <- list(cells = cells, survival = surv)
  out <- clinical_association_matrix(ds, level = "sample", max_pairs = 36L,
                                     include_counts = FALSE, include_survival = FALSE)
  methods <- unique(vapply(out$tests, function(t) t$method %||% "", character(1)))
  expect_true(any(grepl("Beta-binomial|Quasibinomial", methods)))
  expect_true(any(grepl("^Wilcoxon|^Kruskal|^Spearman", methods)))
  p_with_fdr <- vapply(out$tests, function(t) {
    !is.null(t$p_value) && is.finite(t$p_value) && !is.null(t$fdr) && is.finite(t$fdr)
  }, logical(1))
  expect_true(any(p_with_fdr))
})

test_that("clinical_association_matrix includes survival and auto spatial", {
  cells <- make_synthetic_cells(n_per_sample = 80, n_samples = 16)
  surv <- make_synthetic_survival(unique(cells$sample_id))
  ds <- list(cells = cells, survival = surv)
  out <- clinical_association_matrix(ds, level = "sample", max_pairs = 48L,
                                     include_survival = TRUE, auto_spatial = TRUE)
  expect_true(out$include_survival)
  expect_true(out$auto_spatial)
  expect_true("spatial_cluster_stat" %in% out$marker_columns)
  expect_true("__survival__" %in% out$outcome_columns)
  surv_tests <- Filter(function(t) identical(t$association_type, "survival"), out$tests)
  expect_gt(length(surv_tests), 0L)
  expect_true(all(vapply(surv_tests, function(t) !is.null(t$hr), logical(1))))
  expect_true(all(vapply(surv_tests, function(t) t$direction %in% c("positive", "negative", "neutral"),
                         logical(1))))
})

test_that("clinical_pair_test returns rank biserial for binary clinical", {
  cells <- make_synthetic_cells(n_per_sample = 50, n_samples = 12)
  surv <- make_synthetic_survival(unique(cells$sample_id))
  merged <- clinical_summary_data(list(cells = cells, survival = surv))$rows
  pct <- grep("^pct_", names(merged), value = TRUE)[1]
  t2 <- clinical_pair_test(merged, pct, "arm")
  expect_equal(t2$effect_metric, "log_odds")
  expect_true(is.finite(t2$effect_size))
  expect_true(t2$direction %in% c("positive", "negative"))
})

test_that("clinical_pair_test routes ratio markers to beta-binomial", {
  cells <- make_synthetic_cells(n_per_sample = 50, n_samples = 12)
  surv <- make_synthetic_survival(unique(cells$sample_id))
  merged <- clinical_summary_data(list(cells = cells, survival = surv))$rows
  ratio <- grep("^ratio_", names(merged), value = TRUE)[1]
  skip_if(is.na(ratio) || !nzchar(ratio), "No ratio marker found")

  tr <- clinical_pair_test(merged, ratio, "arm")
  expect_true(grepl("Beta-binomial|Quasibinomial", tr$method))
  expect_equal(tr$effect_metric, "log_odds")
  expect_true(is.finite(tr$p_value))
})

test_that("clinical_pair_test errors on invalid ratio count mapping", {
  df <- data.frame(
    ratio_fake_over_Tumor = runif(10),
    count_Tumor = sample(10:50, 10, replace = TRUE),
    arm = rep(c("A", "B"), 5),
    stringsAsFactors = FALSE
  )
  expect_error(
    clinical_pair_test(df, "ratio_fake_over_Tumor", "arm"),
    "Missing numerator count column"
  )
})

test_that("screening_marker_columns can include counts", {
  cols <- c("pct_a", "ratio_a_b", "count_a", "spatial_cluster_stat")
  slim <- screening_marker_columns(cols, include_counts = FALSE)
  expect_false(any(grepl("^count_", slim)))
  full <- screening_marker_columns(cols, include_counts = TRUE)
  expect_true("count_a" %in% full)
})

test_that("merge_features_survival avoids patient_id.x columns", {
  feat <- data.frame(
    sample_id = c("s1", "s2"),
    patient_id = c("p1", "p2"),
    pct_a = c(10, 20),
    stringsAsFactors = FALSE
  )
  surv <- data.frame(
    sample_id = c("s1", "s2"),
    patient_id = c("p1", "p2"),
    stage = c("I", "II"),
    stringsAsFactors = FALSE
  )
  joined <- merge_features_survival(feat, surv)
  expect_false(any(grepl("\\.(x|y)$", names(joined))))
  expect_true("patient_id" %in% names(joined))
  expect_true("stage" %in% names(joined))
})

test_that("screening_clinical_columns drops single-level factors", {
  cells <- make_synthetic_cells(n_per_sample = 80, n_samples = 12)
  surv <- make_synthetic_survival(unique(cells$sample_id))
  surv$sex <- "F"
  ds <- list(cells = cells, survival = surv)
  merged <- clinical_summary_data(ds, level = "sample")$rows
  cols <- screening_clinical_columns(merged)
  expect_false("sex" %in% cols)
  expect_true("stage" %in% cols)
})

test_that("clinical_logrank runs on dichotomized groups", {
  surv <- data.frame(
    time = c(10, 20, 30, 40, 50, 60),
    status = c(1, 0, 1, 0, 1, 0),
    group = factor(c("low", "low", "low", "high", "high", "high")),
    stringsAsFactors = FALSE
  )
  lr <- clinical_logrank(surv, "group")
  expect_true(is.finite(lr$p_value))
  expect_equal(lr$df, 1L)
})

test_that("beta_binomial_count_columns returns count_* when n_total present", {
  cells <- make_synthetic_cells(n_per_sample = 80, n_samples = 10)
  feat  <- aggregate_cell_features(cells, level = "sample")
  avail <- beta_binomial_count_columns(feat)
  expect_true(length(avail) > 0L)
  expect_true(all(grepl("^count_", avail)))
})

test_that("beta_binomial_count_columns returns empty without n_total", {
  df_no_total <- data.frame(count_A = 1:5)
  expect_equal(beta_binomial_count_columns(df_no_total), character())
})

test_that("clinical_beta_binomial fits with categorical predictor", {
  set.seed(99)
  cells <- make_synthetic_cells(n_per_sample = 120, n_samples = 24)
  feat  <- aggregate_cell_features(cells, level = "sample")
  surv  <- make_synthetic_survival(feat$sample_id)
  cnt_col <- grep("^count_", names(feat), value = TRUE)[1]

  res <- clinical_beta_binomial(feat, surv,
                                count_column   = cnt_col,
                                outcome_column = "arm",
                                total_column   = "n_total")
  expect_true(res$family %in% c("beta_binomial_glmmTMB", "beta_binomial_aod", "quasibinomial"))
  expect_equal(res$count_column, cnt_col)
  expect_equal(res$total_column, "n_total")
  expect_equal(res$outcome_column, "arm")
  expect_true(is.finite(res$primary$p_value))
  expect_true(is.numeric(res$dispersion))
  expect_gt(nrow(res$model_rows), 0L)
  expect_gt(nrow(res$estimate_table), 0L)
  expect_true(is.finite(res$mean_proportion))
})

test_that("clinical_beta_binomial fits with numeric predictor and covariates", {
  set.seed(100)
  cells <- make_synthetic_cells(n_per_sample = 100, n_samples = 20)
  feat  <- aggregate_cell_features(cells, level = "sample")
  surv  <- make_synthetic_survival(feat$sample_id)
  cnt_col <- grep("^count_", names(feat), value = TRUE)[1]

  res <- clinical_beta_binomial(feat, surv,
                                count_column   = cnt_col,
                                outcome_column = "age",
                                total_column   = "n_total",
                                covariates     = "stage")
  expect_true(res$family %in% c("beta_binomial_glmmTMB", "beta_binomial_aod", "quasibinomial"))
  expect_true("age" %in% res$predictors)
  expect_true("stage" %in% res$predictors)
  expect_true(is.finite(res$primary$p_value))
  expect_true(is.finite(res$primary$odds_ratio))
})

test_that("clinical_beta_binomial uses compartment denominator", {
  set.seed(101)
  cells <- make_synthetic_cells(n_per_sample = 100, n_samples = 20)
  feat  <- aggregate_cell_features(cells, level = "sample")
  surv  <- make_synthetic_survival(feat$sample_id)
  count_cols <- grep("^count_", names(feat), value = TRUE)
  skip_if(length(count_cols) < 2, "Need at least two count columns")

  cnt_col <- count_cols[1]
  tot_col <- count_cols[2]
  feat[[tot_col]] <- pmax(feat[[cnt_col]], feat[[tot_col]])

  res <- clinical_beta_binomial(feat, surv,
                                count_column   = cnt_col,
                                outcome_column = "arm",
                                total_column   = tot_col)
  expect_equal(res$total_column, tot_col)
  expect_true(is.finite(res$primary$p_value))
})

test_that("fit_proportion_model_cascade returns usable coefficients", {
  set.seed(42)
  n <- 24L
  arm <- rep(c("A", "B"), each = n / 2L)
  k <- pmax(1L, as.integer(round(stats::rbinom(
    n, size = 100, prob = ifelse(arm == "B", 0.35, 0.2)
  ))))
  tmp <- data.frame(.k = k, .n = rep(100L, n), .cl = factor(arm), stringsAsFactors = FALSE)
  fit <- fit_proportion_model_cascade(cbind(.k, .n - .k) ~ .cl, tmp)
  expect_true(!is.null(fit))
  expect_true(grepl("Beta-binomial|Quasibinomial", fit$method))
  expect_true(length(fit$est) >= 2L)
  expect_true(all(is.finite(fit$se)))
})

test_that("clinical_beta_binomial errors on missing overlap", {
  feat <- data.frame(sample_id = "a", count_A = 5L, n_total = 100L)
  surv <- data.frame(sample_id = "b", arm = "A", stringsAsFactors = FALSE)
  expect_error(
    clinical_beta_binomial(feat, surv, count_column = "count_A",
                           outcome_column = "arm"),
    "No overlap"
  )
})

test_that("clinical_summary_tests returns non-fatal errors for invalid count data", {
  df <- data.frame(
    pct_CD8plus_T_Cell = c(rep(10, 4), rep(NA_real_, 4), rep(20, 2)),
    count_CD8plus_T_Cell = c(rep(5, 4), rep(-2, 3), 1, 2, 3),
    n_total = c(rep(0, 4), rep(10, 6)),
    arm = rep(c("A", "B"), 5),
    stringsAsFactors = FALSE
  )
  tests <- clinical_summary_tests(df, list(list(
    markerColumn = "pct_CD8plus_T_Cell",
    clinicalColumn = "arm"
  )))
  expect_equal(length(tests), 1L)
  expect_true(!is.null(tests[[1]]$error))
  expect_match(tests[[1]]$error, "Need at least 5 valid paired observations")
})
