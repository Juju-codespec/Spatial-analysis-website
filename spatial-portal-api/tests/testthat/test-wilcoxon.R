test_that("eligible_group_columns finds binary covariates", {
  surv <- data.frame(
    sample_id = c("a", "b", "c", "d"),
    time = c(10, 20, 30, 40),
    status = c(0, 1, 0, 1),
    response = c("yes", "no", "yes", "no"),
    age = c(50, 60, 70, 80),
    stringsAsFactors = FALSE
  )
  el <- eligible_group_columns(surv)
  expect_true("response" %in% el)
  expect_true("status" %in% el)
  expect_false("age" %in% el)
})

test_that("wilcox_from_stat compares two groups", {
  stats <- data.frame(
    sample_id = paste0("s", 1:8),
    stat = c(0.5, 0.6, 0.55, 0.48, 0.1, 0.15, 0.12, 0.18),
    stringsAsFactors = FALSE
  )
  surv <- data.frame(
    sample_id = paste0("s", 1:8),
    time = rep(100, 8),
    status = c(0, 0, 1, 1, 0, 0, 1, 1),
    stringsAsFactors = FALSE
  )
  res <- wilcox_from_stat(stats, surv, group_column = "status")
  expect_true(is.finite(res$p_value))
  expect_setequal(unique(res$points$group), c("0", "1"))
})
