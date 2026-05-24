test_that("save_dataset and load_dataset round-trip via the cache dir", {
  cfg_reset()
  cache_dir <- tempfile("cache-")
  dir.create(cache_dir)
  Sys.setenv(DATA_CACHE = cache_dir)
  cfg_reset()

  cells <- make_synthetic_cells(n_per_sample = 50, n_samples = 2)
  surv <- make_synthetic_survival(unique(cells$sample_id))
  ds <- build_uploaded_dataset(id = "test-1", title = "Test",
                               cells = cells, survival = surv)
  save_dataset(ds)

  ds_back <- load_dataset("test-1")
  expect_equal(ds_back$meta$id, "test-1")
  expect_equal(nrow(ds_back$cells), nrow(cells))
  expect_equal(nrow(ds_back$survival), nrow(surv))

  ids <- vapply(list_datasets(), function(d) d$id, character(1))
  expect_true("test-1" %in% ids)
})

test_that("dataset_exists is true for cached + reserved demo ids only", {
  cfg_reset()
  cache_dir <- tempfile("cache-")
  dir.create(cache_dir)
  Sys.setenv(DATA_CACHE = cache_dir)
  Sys.setenv(ENABLE_VPD = "false")
  cfg_reset()

  expect_false(dataset_exists("nope"))
  # Demo ids resolve to TRUE (they lazy-load on access).
  expect_true(dataset_exists("vpd-lung"))
})
