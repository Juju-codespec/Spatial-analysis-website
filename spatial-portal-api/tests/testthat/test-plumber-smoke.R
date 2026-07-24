skip_if_not_installed("plumber")
skip_if_not_installed("callr")
skip_if_not_installed("httr")

start_test_server <- function(port) {
  callr::r_bg(
    function(port, project_root, cache_dir) {
      Sys.setenv(PROJECT_ROOT = project_root,
                 DATA_CACHE   = cache_dir,
                 ENABLE_VPD   = "false",
                 PORT         = as.character(port),
                 HOST         = "127.0.0.1")
      source(file.path(project_root, "R", "main.R"))
      start_server()
    },
    args = list(
      port = port,
      project_root = Sys.getenv("PROJECT_ROOT"),
      cache_dir = file.path(tempdir(), "plumber-smoke-cache")
    ),
    supervise = TRUE
  )
}

wait_for <- function(url, tries = 40, sleep_s = 0.25) {
  for (i in seq_len(tries)) {
    ok <- tryCatch({
      r <- httr::GET(url, httr::timeout(1))
      identical(httr::status_code(r), 200L)
    }, error = function(e) FALSE)
    if (ok) return(TRUE)
    Sys.sleep(sleep_s)
  }
  FALSE
}

test_that("plumber service serves /health, /datasets, and analysis endpoints", {
  port <- as.integer(8000L + sample.int(900L, 1L))
  base <- sprintf("http://127.0.0.1:%d", port)

  bg <- start_test_server(port)
  on.exit({
    try(bg$kill(), silent = TRUE)
  }, add = TRUE)

  ready <- wait_for(paste0(base, "/health"))
  if (!ready) {
    cat(bg$read_all_output(), bg$read_all_error(), sep = "\n")
  }
  skip_if_not(ready, "plumber server did not start in time")

  parse_body <- function(r) {
    jsonlite::fromJSON(
      httr::content(r, as = "text", encoding = "UTF-8"),
      simplifyVector = TRUE,
      simplifyDataFrame = FALSE,
      simplifyMatrix = FALSE
    )
  }

  health <- parse_body(httr::GET(paste0(base, "/health")))
  expect_equal(health$status, "ok")

  # Upload a synthetic dataset (12 samples so bivariate Cox has enough data)
  cells <- make_synthetic_cells(n_per_sample = 80, n_samples = 12)
  surv <- make_synthetic_survival(unique(cells$sample_id))
  cells_path <- tempfile(fileext = ".csv")
  surv_path  <- tempfile(fileext = ".csv")
  # Add a phenotype column so parse_cells_csv has multi-phenotype data.
  cells_out <- as.data.frame(cells)
  cells_out$phenotype_cd8 <- ifelse(cells_out$cell_type == "CD8+ T Cell",
                                    "CD8+", "CD8-")
  cells_out$phenotype_cd4 <- ifelse(cells_out$cell_type == "CD4+ T Cell",
                                    "CD4+", "CD4-")
  cells_out$phenotype_ck  <- ifelse(cells_out$cell_type == "Tumor",
                                    "CK+", "CK-")
  cells_out$cell_type <- NULL
  write.csv(cells_out, cells_path, row.names = FALSE)
  write.csv(surv, surv_path, row.names = FALSE)

  up <- httr::POST(
    paste0(base, "/datasets"),
    body = list(
      cells    = httr::upload_file(cells_path, "text/csv"),
      survival = httr::upload_file(surv_path,  "text/csv")
    ),
    encode = "multipart"
  )
  expect_equal(httr::status_code(up), 200L)
  ds_id <- parse_body(up)$id
  expect_true(nzchar(ds_id))

  # Datasets list includes the upload
  list_resp <- httr::GET(paste0(base, "/datasets"))
  expect_equal(httr::status_code(list_resp), 200L)
  ds_list <- parse_body(list_resp)
  ids <- vapply(ds_list, function(d) as.character(d$id), character(1))
  expect_true(ds_id %in% ids)

  # Ripley K
  k_resp <- httr::POST(paste0(base, "/analyze/ripleys-k"),
                       body = list(datasetId = ds_id,
                                   typeA = "CD8+ T Cell",
                                   rMax = 80,
                                   nsim = 0L,
                                   async = FALSE),
                       encode = "json")
  expect_equal(httr::status_code(k_resp), 200L)
  k_body <- parse_body(k_resp)
  expect_true(length(k_body$per_sample) > 0L)

  # Cox
  cox_resp <- httr::POST(paste0(base, "/analyze/cox"),
                         body = list(datasetId = ds_id,
                                     statistic = "K",
                                     radius = 30,
                                     typeA = "CD8+ T Cell",
                                     dichotomize = "median"),
                         encode = "json")
  expect_equal(httr::status_code(cox_resp), 200L)
  cox_body <- parse_body(cox_resp)
  expect_true(!is.null(cox_body$cox$primary$hr))

  # Bivariate Cox
  biv_resp <- httr::POST(paste0(base, "/analyze/cox-bivariate"),
                         body = list(datasetId = ds_id,
                                     statistic = "K",
                                     radius = 30,
                                     typeA = "CD8+ T Cell",
                                     abundanceType = "pct",
                                     split = "median",
                                     minFocalCells = 1L),
                         encode = "json")
  expect_equal(httr::status_code(biv_resp), 200L)
  biv_body <- parse_body(biv_resp)
  expect_true(!is.null(biv_body$cox$primary$hr))
  expect_equal(length(biv_body$cox$quadrants), 4L)
  expect_true(is.finite(biv_body$cox$concordance))

  # Upload a second dataset WITHOUT survival, then attach it via the
  # dedicated endpoint so Cox PH becomes available after the fact.
  cells2_path <- tempfile(fileext = ".csv")
  write.csv(cells_out, cells2_path, row.names = FALSE)
  up2 <- httr::POST(
    paste0(base, "/datasets"),
    body = list(cells = httr::upload_file(cells2_path, "text/csv")),
    encode = "multipart"
  )
  expect_equal(httr::status_code(up2), 200L)
  ds2_id <- parse_body(up2)$id

  detail_before <- parse_body(httr::GET(
    paste0(base, "/datasets/", ds2_id)
  ))
  expect_false(isTRUE(detail_before$has_survival))

  attach_resp <- httr::POST(
    paste0(base, "/datasets/", ds2_id, "/survival"),
    body = list(survival = httr::upload_file(surv_path, "text/csv")),
    encode = "multipart"
  )
  expect_equal(httr::status_code(attach_resp), 200L)
  attach_body <- parse_body(attach_resp)
  expect_true(isTRUE(attach_body$has_survival))
  expect_true(attach_body$survival_rows >= 1L)

  detail_after <- parse_body(httr::GET(
    paste0(base, "/datasets/", ds2_id)
  ))
  expect_true(isTRUE(detail_after$has_survival))

  cox2_resp <- httr::POST(paste0(base, "/analyze/cox"),
                          body = list(datasetId = ds2_id,
                                      statistic = "K",
                                      radius = 30,
                                      typeA = "CD8+ T Cell",
                                      dichotomize = "median"),
                          encode = "json")
  expect_equal(httr::status_code(cox2_resp), 200L)

  wx_resp <- httr::POST(paste0(base, "/analyze/wilcoxon"),
                        body = list(datasetId = ds_id,
                                    statistic = "K",
                                    radius = 30,
                                    typeA = "CD8+ T Cell",
                                    groupColumn = "arm"),
                        encode = "json")
  expect_equal(httr::status_code(wx_resp), 200L)
  wx_body <- parse_body(wx_resp)
  expect_true(is.finite(wx_body$wilcoxon$p_value))

  lin_resp <- httr::POST(paste0(base, "/analyze/linear"),
                         body = list(datasetId = ds_id,
                                     statistic = "K",
                                     radius = 30,
                                     typeA = "CD8+ T Cell",
                                     outcomeColumn = "status",
                                     covariates = list("age", "stage")),
                         encode = "json")
  expect_equal(httr::status_code(lin_resp), 200L)
  lin_body <- parse_body(lin_resp)
  expect_equal(lin_body$linear$family, "binomial")
  expect_true(is.finite(lin_body$linear$primary$p_value))

  # Posting to /survival on an unknown dataset returns 404
  missing_resp <- httr::POST(
    paste0(base, "/datasets/does-not-exist/survival"),
    body = list(survival = httr::upload_file(surv_path, "text/csv")),
    encode = "multipart"
  )
  expect_equal(httr::status_code(missing_resp), 404L)

  sum_resp <- httr::GET(paste0(base, "/datasets/", ds_id, "/clinical-summary?level=sample"))
  expect_equal(httr::status_code(sum_resp), 200L)
  sum_body <- parse_body(sum_resp)
  expect_true(length(sum_body$clinical_columns) > 0L)

  feat_resp <- httr::GET(paste0(base, "/datasets/", ds_id, "/clinical-features"))
  expect_equal(httr::status_code(feat_resp), 200L)
  feat_body <- parse_body(feat_resp)
  expect_true(length(feat_body$feature_columns) > 0L)

  pct_col <- feat_body$feature_columns[grepl("^pct_", feat_body$feature_columns)][1]

  clin_wx <- httr::POST(
    paste0(base, "/analyze/clinical/wilcoxon"),
    body = list(datasetId = ds_id, featureColumn = pct_col,
                groupColumn = "arm", level = "sample"),
    encode = "json"
  )
  expect_equal(httr::status_code(clin_wx), 200L)

  clin_lin <- httr::POST(
    paste0(base, "/analyze/clinical/linear"),
    body = list(datasetId = ds_id, outcomeColumn = "status",
                featureColumns = list(pct_col),
                covariates = list("age", "stage"), level = "sample"),
    encode = "json"
  )
  expect_equal(httr::status_code(clin_lin), 200L)

  clin_surv <- httr::POST(
    paste0(base, "/analyze/clinical/survival"),
    body = list(datasetId = ds_id, featureColumn = pct_col,
                dichotomize = "median", level = "sample"),
    encode = "json"
  )
  expect_equal(httr::status_code(clin_surv), 200L)
  surv_body <- parse_body(clin_surv)
  expect_true(is.finite(surv_body$survival$cox$primary$hr))

  # Posting without a survival part returns 400
  empty_resp <- httr::POST(
    paste0(base, "/datasets/", ds2_id, "/survival"),
    body = list(other = "x"),
    encode = "multipart"
  )
  expect_equal(httr::status_code(empty_resp), 400L)
})
