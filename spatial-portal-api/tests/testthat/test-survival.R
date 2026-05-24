test_that("cox_from_stat fits a model and returns HR/CI/p", {
  set.seed(99)
  n <- 30L
  sample_ids <- sprintf("s%02d", seq_len(n))
  stat <- rnorm(n)
  surv <- data.frame(
    sample_id = sample_ids,
    time      = pmin(stats::rexp(n, rate = 1 / 200 + 0.0005 * (stat - mean(stat))), 1000),
    status    = stats::rbinom(n, 1, 0.7),
    age       = rnorm(n, 65, 8),
    stringsAsFactors = FALSE
  )
  stats_df <- data.frame(sample_id = sample_ids, stat = stat,
                         stringsAsFactors = FALSE)

  res <- cox_from_stat(stats_df, surv, covariates = "age",
                       dichotomize = "none")
  expect_true(all(c("primary", "coefficients", "confidence_intervals", "n")
                  %in% names(res)))
  expect_equal(res$n, n)
  expect_true(is.finite(res$primary$hr))
  expect_true(is.finite(res$primary$p_value))
  expect_true(is.finite(res$primary$hr_lower))
  expect_true(is.finite(res$primary$hr_upper))
  expect_true(res$primary$hr_lower <= res$primary$hr)
  expect_true(res$primary$hr_upper >= res$primary$hr)
})

test_that("cox_from_stat with median dichotomization returns KM points", {
  set.seed(7)
  n <- 40L
  sample_ids <- sprintf("s%02d", seq_len(n))
  stat <- rnorm(n)
  surv <- data.frame(
    sample_id = sample_ids,
    time      = stats::rexp(n, rate = 1 / 200),
    status    = stats::rbinom(n, 1, 0.7)
  )
  stats_df <- data.frame(sample_id = sample_ids, stat = stat)

  res <- cox_from_stat(stats_df, surv, dichotomize = "median")
  expect_equal(res$dichotomize, "median")
  expect_false(is.null(res$km))
  expect_setequal(unique(res$km$group), c("high", "low"))
  expect_true(all(res$km$time >= 0))
  expect_true(all(res$km$surv >= 0 & res$km$surv <= 1))
})

test_that("cox_from_stat errors if no overlap between stats and survival", {
  expect_error(
    cox_from_stat(
      data.frame(sample_id = "a", stat = 1),
      data.frame(sample_id = "b", time = 10, status = 1)
    ),
    "No overlap"
  )
})

test_that("cox_from_stat supports density adjustment", {
  set.seed(11)
  n <- 30L
  sample_ids <- sprintf("s%02d", seq_len(n))
  stat <- rnorm(n)
  stats_df <- data.frame(
    sample_id = sample_ids,
    stat = stat,
    n_focal = sample(100:500, n, replace = TRUE),
    tissue_area = runif(n, 1e5, 5e5),
    stringsAsFactors = FALSE
  )
  surv <- data.frame(
    sample_id = sample_ids,
    time = stats::rexp(n, rate = 1 / 200),
    status = stats::rbinom(n, 1, 0.7)
  )

  res <- cox_from_stat(stats_df, surv, dichotomize = "none",
                       adjust_density = TRUE)
  expect_true(res$adjust_density)
  expect_true(all(c("log_area", "n_focal") %in% res$density_covariates))
  expect_gt(nrow(res$coefficients), 1L)
})

test_that("cox_from_stat uses cluster-robust SE when patient_id repeats", {
  set.seed(13)
  n <- 24L
  sample_ids <- sprintf("s%02d", seq_len(n))
  patient_ids <- rep(sprintf("p%02d", rep(seq_len(6), each = 4)), length.out = n)
  stat <- rnorm(n)
  stats_df <- data.frame(
    sample_id = sample_ids,
    stat = stat,
    patient_id = patient_ids,
    stringsAsFactors = FALSE
  )
  surv <- data.frame(
    sample_id = sample_ids,
    patient_id = patient_ids,
    time = stats::rexp(n, rate = 1 / 200),
    status = stats::rbinom(n, 1, 0.7)
  )

  res <- cox_from_stat(stats_df, surv, dichotomize = "none",
                       cluster_id = "patient_id")
  expect_true(res$clustered)
  expect_equal(res$n_clusters, 6L)
})
