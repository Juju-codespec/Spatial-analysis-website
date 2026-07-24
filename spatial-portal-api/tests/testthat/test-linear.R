test_that("eligible_outcome_columns lists numeric and binary columns", {
  surv <- data.frame(
    sample_id = c("a", "b", "c", "d"),
    time = c(10, 20, 30, 40),
    status = c(0, 1, 0, 1),
    age = c(50, 60, 70, 80),
    stage = c("I", "II", "III", "IV"),
    stringsAsFactors = FALSE
  )
  el <- eligible_outcome_columns(surv)
  expect_true("status" %in% el)
  expect_true("age" %in% el)
  expect_true("stage" %in% el)
  expect_false("sample_id" %in% el)
})

test_that("eligible_covariate_columns excludes outcome", {
  surv <- data.frame(
    sample_id = paste0("s", 1:6),
    status = c(0, 1, 0, 1, 0, 1),
    age = 50:55,
    grade = c(1, 2, 3, 1, 2, 3),
    stringsAsFactors = FALSE
  )
  covs <- eligible_covariate_columns(surv, "status")
  expect_true("age" %in% covs)
  expect_true("grade" %in% covs)
  expect_false("status" %in% covs)
})

test_that("linear_from_stat fits logistic model for binary status", {
  set.seed(21)
  n <- 30L
  sample_ids <- sprintf("s%02d", seq_len(n))
  stat <- rnorm(n)
  surv <- data.frame(
    sample_id = sample_ids,
    status = stats::rbinom(n, 1, plogis(-0.5 + 0.3 * stat)),
    age = rnorm(n, 65, 8),
    stage = sample(c("I", "II", "III"), n, replace = TRUE),
    stringsAsFactors = FALSE
  )
  stats_df <- data.frame(sample_id = sample_ids, stat = stat,
                         stringsAsFactors = FALSE)

  res <- linear_from_stat(stats_df, surv, outcome_column = "status",
                          covariates = c("age", "stage"))
  expect_equal(res$family, "binomial")
  expect_equal(res$outcome_column, "status")
  expect_true(is.finite(res$primary$p_value))
  expect_true(is.finite(res$primary$odds_ratio))
  expect_gt(nrow(res$coefficients), 1L)
})

test_that("linear_from_stat fits lm for continuous age", {
  set.seed(22)
  n <- 30L
  sample_ids <- sprintf("s%02d", seq_len(n))
  stat <- rnorm(n)
  surv <- data.frame(
    sample_id = sample_ids,
    age = 50 + 5 * stat + rnorm(n, sd = 2),
    stringsAsFactors = FALSE
  )
  stats_df <- data.frame(sample_id = sample_ids, stat = stat)

  res <- linear_from_stat(stats_df, surv, outcome_column = "age")
  expect_equal(res$family, "gaussian")
  expect_true(is.finite(res$r_squared))
  expect_true(is.finite(res$primary$estimate))
})

test_that("linear_from_stat fits with median dichotomized clustering", {
  set.seed(23)
  n <- 30L
  sample_ids <- sprintf("s%02d", seq_len(n))
  stat <- rnorm(n)
  surv <- data.frame(
    sample_id = sample_ids,
    status = stats::rbinom(n, 1, plogis(-0.5 + 0.3 * stat)),
    age = rnorm(n, 65, 8),
    stringsAsFactors = FALSE
  )
  stats_df <- data.frame(sample_id = sample_ids, stat = stat)

  res <- linear_from_stat(stats_df, surv, outcome_column = "status",
                          covariates = "age", dichotomize = "median")
  expect_equal(res$family, "binomial")
  expect_equal(res$dichotomize, "median")
  expect_equal(res$primary$term, "grouphigh")
  expect_true(is.finite(res$primary$p_value))
})

test_that("linear_from_stat errors if no overlap", {
  expect_error(
    linear_from_stat(
      data.frame(sample_id = "a", stat = 1),
      data.frame(sample_id = "b", status = 1, age = 50),
      outcome_column = "status"
    ),
    "No overlap"
  )
})
