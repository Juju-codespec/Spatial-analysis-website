#!/usr/bin/env Rscript
# Install CRAN dependencies required to run spatial-portal-api locally.

cran <- c(
  "plumber", "spatstat.geom", "spatstat.explore", "spatstat.random",
  "survival", "sandwich", "dplyr", "data.table", "jsonlite", "future", "promises",
  "uuid", "vroom", "logger", "arrow",   "ggplot2",
  "aod",
  "glmmTMB"
)

missing <- cran[!vapply(cran, requireNamespace, quietly = TRUE, FUN.VALUE = logical(1))]
if (length(missing) == 0L) {
  message("All CRAN dependencies already installed.")
  quit(status = 0)
}

message("Installing missing packages: ", paste(missing, collapse = ", "))
install.packages(missing, repos = "https://cloud.r-project.org")
still_missing <- missing[!vapply(missing, requireNamespace, quietly = TRUE, FUN.VALUE = logical(1))]
if (length(still_missing) > 0L) {
  stop("Failed to install: ", paste(still_missing, collapse = ", "), call. = FALSE)
}
message("CRAN dependencies ready.")
