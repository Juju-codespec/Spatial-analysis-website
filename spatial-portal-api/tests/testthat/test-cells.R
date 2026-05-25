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
