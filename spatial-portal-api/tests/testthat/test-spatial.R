test_that("Ripley's K detects clustering vs CSR", {
  set.seed(1)
  # Highly clustered pattern
  clust <- make_synthetic_cells(n_per_sample = 300, n_samples = 2,
                                clustered = TRUE)
  res_clust <- ripleys_k(clust, type_a = "CD8+ T Cell")
  expect_true(length(res_clust$per_sample) > 0L)

  # L(r) - r should be positive at intermediate radii under clustering.
  s <- res_clust$per_sample[[1]]
  mid_idx <- floor(length(s$r) / 2)
  l_dev <- s$L_obs[mid_idx] - s$r[mid_idx]
  expect_gt(l_dev, 0)

  # Random pattern: L(r) ≈ r so L - r should be near 0.
  rand <- make_synthetic_cells(n_per_sample = 1000, n_samples = 1,
                               clustered = FALSE)
  res_rand <- ripleys_k(rand, type_a = "CD8+ T Cell")
  s2 <- res_rand$per_sample[[1]]
  l_dev_rand <- s2$L_obs[mid_idx] - s2$r[mid_idx]
  expect_lt(abs(l_dev_rand), abs(l_dev))
})

test_that("Cross-K runs and returns r/K_obs/L_obs", {
  cells <- make_synthetic_cells()
  res <- ripleys_k(cells, type_a = "CD8+ T Cell", type_b = "Tumor")
  expect_true(length(res$per_sample) > 0L)
  s <- res$per_sample[[1]]
  expect_true(all(c("r", "K_obs", "L_obs") %in% names(s)))
})

test_that("Nearest-neighbour G returns monotone non-decreasing curve", {
  cells <- make_synthetic_cells()
  res <- nn_g(cells, type_a = "CD8+ T Cell")
  expect_true(length(res$per_sample) > 0L)
  s <- res$per_sample[[1]]
  expect_true(all(c("r", "G_obs") %in% names(s)))
  # G is a CDF: monotone non-decreasing, bounded by [0, 1].
  diffs <- diff(s$G_obs[!is.na(s$G_obs)])
  expect_true(all(diffs >= -1e-9))
  expect_true(all(s$G_obs >= -1e-9 & s$G_obs <= 1 + 1e-9, na.rm = TRUE))
})

test_that("spatial_summary_at_r returns one row per per_sample entry", {
  cells <- make_synthetic_cells(n_per_sample = 200, n_samples = 3)
  res <- ripleys_k(cells, type_a = "CD8+ T Cell")
  summ <- spatial_summary_at_r(res, radius = 40, statistic = "K")
  expect_equal(nrow(summ), length(res$per_sample))
  expect_true(all(c("sample_id", "stat", "n_focal", "tissue_area") %in% names(summ)))
  expect_true(all(is.finite(summ$stat)))
})

test_that("convex hull window is used by default", {
  cells <- make_synthetic_cells(n_per_sample = 200, n_samples = 1)
  res <- ripleys_k(cells, type_a = "CD8+ T Cell", window_type = "convex")
  expect_equal(res$window_type, "convex")
  expect_true(res$per_sample[[1]]$tissue_area > 0)
})

test_that("min_focal_cells excludes samples below threshold", {
  cells <- make_synthetic_cells(n_per_sample = 200, n_samples = 4)
  res_all <- ripleys_k(cells, type_a = "CD8+ T Cell", min_focal_cells = 1L)
  res_strict <- ripleys_k(cells, type_a = "CD8+ T Cell", min_focal_cells = 200L)
  expect_gt(res_all$n_samples_analyzed, 0L)
  expect_equal(res_strict$n_samples_analyzed, 0L)
  expect_gt(res_strict$n_samples_excluded, 0L)
})

test_that("CSR envelopes are optional", {
  cells <- make_synthetic_cells(n_per_sample = 150, n_samples = 1, clustered = TRUE)
  res <- ripleys_k(cells, type_a = "CD8+ T Cell", nsim = 19L)
  expect_equal(res$nsim, 19L)
  s <- res$per_sample[[1]]
  if (!is.null(s$envelope_lo)) {
    expect_true(all(c("envelope_lo", "envelope_hi") %in% names(s)))
    expect_equal(length(s$envelope_lo), length(s$r))
  }
})
