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
