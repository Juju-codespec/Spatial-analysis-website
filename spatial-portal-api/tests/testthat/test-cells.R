test_that("PHENOTYPE_MAP harmonization picks the highest-priority positive marker", {
  pheno_df <- data.frame(
    phenotype_cd3 = c("CD3+", "CD3-", "CD3+"),
    phenotype_cd8 = c("CD8+", "CD8-", "CD8-"),
    phenotype_cd4 = c("CD4-", "CD4-", "CD4+"),
    stringsAsFactors = FALSE
  )
  ct <- derive_cell_type(pheno_df)
  # Row 1: CD8 wins over CD3 (priority order in PHENOTYPE_MAP)
  expect_equal(ct[1], "CD8+ T Cell")
  expect_equal(ct[2], "Other")
  expect_equal(ct[3], "CD4+ T Cell")
})

test_that("parse_cells_csv reads a multi-phenotype CSV", {
  csv <- tempfile(fileext = ".csv")
  write.csv(data.frame(
    sample_id = rep("s1", 3),
    x = c(10.1, 20.2, 30.3),
    y = c(50.5, 60.6, 70.7),
    phenotype_cd3 = c("CD3+", "CD3+", "CD3-"),
    phenotype_cd8 = c("CD8+", "CD8-", "CD8-"),
    phenotype_cd4 = c("CD4-", "CD4-", "CD4-"),
    stringsAsFactors = FALSE
  ), csv, row.names = FALSE)

  cells <- parse_cells_csv(csv)
  expect_equal(nrow(cells), 3L)
  expect_true(all(c("sample_id", "x", "y", "cell_type") %in% names(cells)))
  expect_setequal(unique(cells$cell_type),
                  c("CD8+ T Cell", "T Cell", "Other"))
})

test_that("parse_cells_parquet reads a multi-phenotype Parquet file", {
  skip_if_not_installed("arrow")
  pq <- tempfile(fileext = ".parquet")
  on.exit(unlink(pq), add = TRUE)
  df <- data.frame(
    sample_id = rep("s1", 3),
    x = c(10.1, 20.2, 30.3),
    y = c(50.5, 60.6, 70.7),
    phenotype_cd3 = c("CD3+", "CD3+", "CD3-"),
    phenotype_cd8 = c("CD8+", "CD8-", "CD8-"),
    stringsAsFactors = FALSE
  )
  arrow::write_parquet(df, pq)
  cells <- parse_cells_parquet(pq)
  expect_equal(nrow(cells), 3L)
  expect_setequal(unique(cells$cell_type), c("CD8+ T Cell", "T Cell", "Other"))
})

test_that("parse_cells_csv rejects CSVs missing x/y coords", {
  csv <- tempfile(fileext = ".csv")
  write.csv(data.frame(a = 1, b = 2), csv, row.names = FALSE)
  expect_error(parse_cells_csv(csv), "x/y coordinate")
})

test_that("parse_survival_csv normalizes column names and coerces status", {
  csv <- tempfile(fileext = ".csv")
  write.csv(data.frame(
    sample_id = c("s1", "s2", "s3"),
    survival_days = c(100, 200, 365),
    death = c("Dead", "Alive", "1")
  ), csv, row.names = FALSE)

  surv <- parse_survival_csv(csv)
  expect_equal(surv$status, c(1L, 0L, 1L))
  expect_equal(surv$time, c(100, 200, 365))
})

test_that("parse_rds_upload reads a saved portal dataset list", {
  cells <- make_synthetic_cells(n_per_sample = 50, n_samples = 2)
  ds <- build_uploaded_dataset(id = "test-rds", title = "RDS test", cells = cells)
  path <- tempfile(fileext = ".rds")
  saveRDS(ds, path)
  on.exit(unlink(path), add = TRUE)

  out <- parse_rds_upload(path, id = "upload-abc", title = "New title")
  expect_equal(out$meta$id, "upload-abc")
  expect_equal(out$meta$title, "New title")
  expect_equal(out$meta$source, "upload")
  expect_equal(nrow(out$cells), nrow(cells))
})

test_that("parse_rds_upload reads a plain cell-level data.frame", {
  df <- data.frame(
    patient_id = rep(c("p1", "p2"), each = 3),
    x = c(1, 2, 3, 4, 5, 6),
    y = c(10, 20, 30, 40, 50, 60),
    cell_type = rep(c("Tumor", "Macrophage"), 3),
    futime = c(100, 100, 100, 200, 200, 200),
    fustat = c(1, 1, 1, 0, 0, 0),
    stringsAsFactors = FALSE
  )
  path <- tempfile(fileext = ".rds")
  saveRDS(df, path)
  on.exit(unlink(path), add = TRUE)

  out <- parse_rds_upload(path, id = "upload-df", title = "Cell table RDS")
  expect_equal(out$meta$id, "upload-df")
  expect_equal(nrow(out$cells), 6L)
  expect_setequal(out$cells$sample_id, c("p1", "p2"))
  expect_equal(nrow(out$survival), 2L)
  expect_true(all(c("time", "status") %in% names(out$survival)))
})

test_that("parse_rds_upload rejects survival-only data.frames", {
  df <- data.frame(
    patient_id = c("p1", "p2"),
    futime = c(100, 200),
    fustat = c(1, 0),
    stringsAsFactors = FALSE
  )
  path <- tempfile(fileext = ".rds")
  saveRDS(df, path)
  on.exit(unlink(path), add = TRUE)

  expect_error(
    parse_rds_upload(path, id = "upload-bad"),
    "x/y coordinate"
  )
})

test_that("VPD hub loaders match current VectraPolarisData exports", {
  skip_if_not_installed("VectraPolarisData")
  exports <- getNamespaceExports("VectraPolarisData")
  expect_true("HumanLungCancerV3" %in% exports)
  expect_true("HumanOvarianCancerVP" %in% exports)
  expect_false("VectraPolarisData" %in% exports)
})

test_that("merge_survival_clinical adds race without replacing time/status", {
  existing <- data.frame(
    sample_id = c("s1", "s2"),
    time = c(10, 20),
    status = c(0L, 1L),
    stage = c("3", "4"),
    stringsAsFactors = FALSE
  )
  incoming <- data.frame(
    sample_id = c("s1", "s2"),
    race = c("White", "Black"),
    stringsAsFactors = FALSE
  )
  merged <- merge_survival_clinical(existing, incoming)
  expect_equal(merged$time, existing$time)
  expect_equal(merged$race, incoming$race)
})

test_that("vpd-ovarian survival omits synthetic sex column", {
  skip_if_not_installed("VectraPolarisData")
  skip_if_not_installed("SpatialExperiment")
  cache <- tempfile("vpd-ovarian-clinical-")
  dir.create(cache)
  old_cache <- Sys.getenv("DATA_CACHE", unset = NA)
  old_vpd <- Sys.getenv("ENABLE_VPD", unset = NA)
  Sys.setenv(DATA_CACHE = cache, ENABLE_VPD = "true")
  cfg_reset()
  on.exit({
    if (is.na(old_cache)) Sys.unsetenv("DATA_CACHE") else Sys.setenv(DATA_CACHE = old_cache)
    if (is.na(old_vpd)) Sys.unsetenv("ENABLE_VPD") else Sys.setenv(ENABLE_VPD = old_vpd)
    cfg_reset()
  }, add = TRUE)
  ds <- load_vpd_dataset("vpd-ovarian")
  expect_false("sex" %in% names(ds$survival))
})

test_that("vpd-ovarian merges race from supplement CSV", {
  skip_if_not_installed("VectraPolarisData")
  skip_if_not_installed("SpatialExperiment")
  cache <- tempfile("vpd-ovarian-race-")
  dir.create(cache)
  extdir <- file.path(tempdir(), "vpd-race-ext")
  dir.create(extdir, showWarnings = FALSE)
  race_csv <- file.path(extdir, "vpd_ovarian_race.csv")
  old_cache <- Sys.getenv("DATA_CACHE", unset = NA)
  old_vpd <- Sys.getenv("ENABLE_VPD", unset = NA)
  old_race <- Sys.getenv("VPD_OVARIAN_RACE_CSV", unset = NA)
  Sys.setenv(DATA_CACHE = cache, ENABLE_VPD = "true",
             VPD_OVARIAN_RACE_CSV = race_csv)
  cfg_reset()
  on.exit({
    if (is.na(old_cache)) Sys.unsetenv("DATA_CACHE") else Sys.setenv(DATA_CACHE = old_cache)
    if (is.na(old_vpd)) Sys.unsetenv("ENABLE_VPD") else Sys.setenv(ENABLE_VPD = old_vpd)
    if (is.na(old_race)) Sys.unsetenv("VPD_OVARIAN_RACE_CSV") else Sys.setenv(VPD_OVARIAN_RACE_CSV = old_race)
    cfg_reset()
  }, add = TRUE)
  ds0 <- load_vpd_dataset("vpd-ovarian")
  write.csv(
    data.frame(sample_id = ds0$survival$sample_id[1:3],
               race = c("White", "Black", "Asian"),
               stringsAsFactors = FALSE),
    race_csv,
    row.names = FALSE
  )
  ds <- load_vpd_dataset("vpd-ovarian")
  expect_true("race" %in% names(ds$survival))
  expect_equal(ds$survival$race[1:3], c("White", "Black", "Asian"))
})

test_that("parse_cells_table uses patient_id as sample_id when sample_id missing", {
  df <- data.frame(
    patient_id = c("a", "b"),
    x = c(1, 2),
    y = c(3, 4),
    cell_type = c("Tumor", "Tumor"),
    stringsAsFactors = FALSE
  )
  cells <- parse_cells_table(df)
  expect_equal(cells$sample_id, c("a", "b"))
})
