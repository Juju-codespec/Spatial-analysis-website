# testthat helpers loaded before each test file.

make_synthetic_cells <- function(n_per_sample = 200, n_samples = 4,
                                 seed = 42, clustered = TRUE) {
  set.seed(seed)
  out <- list()
  for (s in seq_len(n_samples)) {
    sid <- sprintf("sample_%02d", s)
    if (clustered) {
      n_clusters <- 5L
      centers <- cbind(runif(n_clusters, 100, 900),
                       runif(n_clusters, 100, 900))
      idx <- sample(seq_len(n_clusters), n_per_sample, replace = TRUE)
      x <- centers[idx, 1] + rnorm(n_per_sample, sd = 25)
      y <- centers[idx, 2] + rnorm(n_per_sample, sd = 25)
    } else {
      x <- runif(n_per_sample, 0, 1000)
      y <- runif(n_per_sample, 0, 1000)
    }
    types <- sample(c("CD8+ T Cell", "CD4+ T Cell", "Tumor"),
                    n_per_sample, replace = TRUE,
                    prob = c(0.3, 0.2, 0.5))
    out[[s]] <- data.frame(
      sample_id  = sid,
      patient_id = sid,
      x          = x,
      y          = y,
      cell_type  = types,
      stringsAsFactors = FALSE
    )
  }
  data.table::as.data.table(do.call(rbind, out))
}

make_synthetic_survival <- function(sample_ids, seed = 7,
                                    hazard_by_sample = NULL) {
  set.seed(seed)
  n <- length(sample_ids)
  base_hazard <- if (is.null(hazard_by_sample)) {
    rep(1 / 365, n)
  } else {
    hazard_by_sample
  }
  time <- pmin(stats::rexp(n, rate = base_hazard), 365 * 5)
  status <- as.integer(time < 365 * 5)
  data.frame(
    sample_id = sample_ids,
    time      = time,
    status    = status,
    age       = rnorm(n, 65, 10),
    stringsAsFactors = FALSE
  )
}
