# Run with: Rscript tests/testthat.R
library(testthat)

# Locate the project root regardless of invocation directory.
guess_root <- function() {
  args <- commandArgs(trailingOnly = FALSE)
  file_arg <- grep("^--file=", args, value = TRUE)
  if (length(file_arg) == 1L) {
    script <- normalizePath(sub("^--file=", "", file_arg))
    return(normalizePath(file.path(dirname(script), "..")))
  }
  if (dir.exists("R") && file.exists("R/main.R")) return(normalizePath("."))
  if (basename(getwd()) == "tests") return(normalizePath(".."))
  getwd()
}
project_root <- guess_root()
Sys.setenv(PROJECT_ROOT = project_root)

# Use an isolated cache dir per test run.
Sys.setenv(DATA_CACHE = file.path(tempdir(), "spatial-portal-api-cache"))
Sys.setenv(ENABLE_VPD = "false")

src_dir <- file.path(project_root, "R")
for (f in c("config.R", "cors.R", "storage.R", "cells.R",
            "spatial.R", "survival.R", "jobs.R")) {
  source(file.path(src_dir, f))
}

test_dir(file.path(project_root, "tests", "testthat"), reporter = "summary")

`%||%` <- function(a, b) if (is.null(a)) b else a
