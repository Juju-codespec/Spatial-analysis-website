# Entry point for the spatial-portal-api service.
#
# Usage:
#   Rscript R/main.R                       # picks PORT from env (default 8000)
#   PORT=9000 CORS_ORIGIN=http://localhost:5173 Rscript R/main.R
#
# When the working directory is the project root, all R/ files are sourced
# in the right order and a plumber router is mounted from R/plumber.R.

start_server <- function(host = NULL, port = NULL) {
  source_all()
  init_jobs()

  conf <- cfg()
  pr <- plumber::plumb(file = file.path(here_root(), "R", "plumber.R"))
  # plumber's default JSON serializer does not auto-unbox length-1 vectors,
  # so scalar fields like `id` come out as ["abc"] and break TS clients that
  # type them as plain strings. Use the unboxed serializer globally; only
  # works because no endpoint sets `#* @serializer` explicitly.
  pr$setSerializer(plumber::serializer_unboxed_json())
  message(sprintf("[spatial-portal-api] starting on %s:%d (cors=%s)",
                  host %||% conf$host, port %||% conf$port, conf$cors_origin))
  pr$run(host = host %||% conf$host,
         port = port %||% conf$port,
         swagger = TRUE)
}

source_all <- function() {
  root <- here_root_guess()
  Sys.setenv(PROJECT_ROOT = root)
  files <- c("config.R", "cors.R", "storage.R", "cells.R",
             "spatial.R", "survival.R", "jobs.R")
  for (f in files) source(file.path(root, "R", f), local = FALSE)
}

# When started via `Rscript R/main.R` the wd is typically the project root,
# but we also handle being invoked from inside R/ or via callr/tests.
here_root_guess <- function() {
  env_root <- Sys.getenv("PROJECT_ROOT", "")
  if (nzchar(env_root) && dir.exists(file.path(env_root, "R"))) {
    return(normalizePath(env_root))
  }
  if (dir.exists("R") && file.exists("R/main.R")) return(normalizePath("."))
  if (basename(getwd()) == "R" && file.exists("main.R")) {
    return(normalizePath(".."))
  }
  args <- commandArgs(trailingOnly = FALSE)
  file_arg <- grep("^--file=", args, value = TRUE)
  if (length(file_arg) == 1L) {
    script <- sub("^--file=", "", file_arg)
    return(normalizePath(dirname(dirname(script))))
  }
  getwd()
}

`%||%` <- function(a, b) if (is.null(a) || identical(a, "")) b else a

if (sys.nframe() == 0L) {
  start_server()
}
