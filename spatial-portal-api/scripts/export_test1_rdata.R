#!/usr/bin/env Rscript
# Export portal-ready CSVs from the Test 1 Ripley K NN G.RData workspace.
#
# Produces:
#   cells.csv          — cell-level coordinates + phenotype_* columns (upload wizard)
#   survival.csv       — per-sample time/status for Cox PH
#   spatial_scalars.csv — per-sample Ripley's K (L−r) and NN G at chosen radii
#   spatial_curves/    — one CSV per sample with full K(r) and G(r) curves
#
# Usage:
#   Rscript scripts/export_test1_rdata.R [path/to/workspace.RData] [out_dir]

args <- commandArgs(trailingOnly = TRUE)
rdata_path <- if (length(args) >= 1L) args[[1L]] else {
  path.expand("~/Documents/coding life/Test 1 Ripley K NN G.RData")
}
out_dir <- if (length(args) >= 2L) args[[2L]] else {
  file.path(getwd(), "test-data", "test1-ovarian-tma")
}

if (!file.exists(rdata_path)) {
  stop("RData file not found: ", rdata_path, call. = FALSE)
}
dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)
dir.create(file.path(out_dir, "spatial_curves"), recursive = TRUE, showWarnings = FALSE)

message("Loading ", rdata_path)
e <- new.env()
load(rdata_path, envir = e)
if (!exists("df_clean", envir = e)) {
  stop("Expected object 'df_clean' in workspace.", call. = FALSE)
}
df <- get("df_clean", envir = e)

# ---- helpers (mirror spatial-portal-api/R/cells.R) -------------------------

PHENOTYPE_MAP <- data.frame(
  marker = c("cd8", "cd4", "cd3", "cd68", "cd163", "cd19", "cd20",
             "cd56", "ck", "panck", "epcam", "fap", "asma", "sma"),
  cell_type = c("CD8+ T Cell", "CD4+ T Cell", "T Cell", "Macrophage", "Macrophage",
                "B Cell", "B Cell", "NK Cell", "Tumor", "Tumor",
                "Tumor", "CAF", "CAF", "CAF"),
  stringsAsFactors = FALSE
)

derive_cell_type <- function(pheno_df) {
  n <- nrow(pheno_df)
  out <- rep("Other", n)
  lower_names <- tolower(names(pheno_df))
  for (i in seq_len(nrow(PHENOTYPE_MAP))) {
    marker <- PHENOTYPE_MAP$marker[i]
    target <- PHENOTYPE_MAP$cell_type[i]
    col_idx <- which(lower_names == paste0("phenotype_", marker))
    if (length(col_idx) == 0L) next
    raw <- as.character(pheno_df[[col_idx[1]]])
    positive <- grepl("\\+$", raw) | raw %in% c("1", "TRUE", "true")
    mask <- positive & out == "Other"
    if (any(mask)) out[mask] <- target
  }
  out
}

# ---- cells.csv -------------------------------------------------------------

phen_cols <- grep("^phenotype_", names(df), value = TRUE)
cells_out <- df[, c("sample_id", phen_cols, "cell_x_position", "cell_y_position"),
                drop = FALSE]
cells_out$cell_type <- derive_cell_type(df[, phen_cols, drop = FALSE])

cells_path <- file.path(out_dir, "cells.csv")
write.csv(cells_out, cells_path, row.names = FALSE)
message("Wrote ", cells_path, " (", nrow(cells_out), " rows, ",
        length(unique(cells_out$sample_id)), " samples)")

# ---- survival.csv ----------------------------------------------------------

surv <- unique(df[, c("sample_id", "survival_time", "death"), drop = FALSE])
names(surv) <- c("sample_id", "time", "status")

surv_path <- file.path(out_dir, "survival.csv")
write.csv(surv, surv_path, row.names = FALSE)
message("Wrote ", surv_path, " (", nrow(surv), " samples, ",
        sum(surv$status == 1L), " events)")

if (sum(surv$status == 0L) == 0L) {
  message("NOTE: all samples are events (status=1); KM curves will be degenerate.")
}
if (nrow(surv) < 5L) {
  message("NOTE: fewer than 5 samples — portal Cox endpoint requires n >= 5.")
}

# ---- spatial metrics (CD8+ T cells, matching portal defaults) -------------

radius_k <- 50L
radius_g <- 20L
type_a <- "CD8+ T Cell"

if (!requireNamespace("spatstat.geom", quietly = TRUE) ||
    !requireNamespace("spatstat.explore", quietly = TRUE)) {
  stop("Install spatstat.geom and spatstat.explore to compute spatial metrics.",
       call. = FALSE)
}

compute_sample_metrics <- function(sub, type_a, radius_k, radius_g) {
  pts <- sub[sub$cell_type == type_a, c("cell_x_position", "cell_y_position")]
  names(pts) <- c("x", "y")
  pts <- pts[complete.cases(pts), , drop = FALSE]
  n_cells <- nrow(pts)
  if (n_cells < 10L) {
    return(list(
      n_cd8 = n_cells,
      ripley_k_L_minus_r = NA_real_,
      nn_g = NA_real_,
      K_curve = NULL,
      G_curve = NULL
    ))
  }
  pp <- spatstat.geom::ppp(
    x = pts$x, y = pts$y,
    window = spatstat.geom::owin(
      xrange = range(pts$x), yrange = range(pts$y)
    )
  )
  K <- spatstat.explore::Kest(pp, correction = "iso")
  G <- spatstat.explore::Gest(pp, correction = "km")
  L_obs <- sqrt(pmax(K$iso, 0) / pi)
  L_theo <- if ("theo" %in% names(K)) sqrt(pmax(K$theo, 0) / pi) else K$r

  k_idx <- which.min(abs(K$r - radius_k))
  g_idx <- which.min(abs(G$r - radius_g))

  list(
    n_cd8 = n_cells,
    ripley_k_L_minus_r = unname(L_obs[k_idx] - L_theo[k_idx]),
    nn_g = unname(G$km[g_idx] - G$theo[g_idx]),
    K_curve = data.frame(
      r = K$r, K_obs = K$iso, K_theo = K$theo,
      L_obs = L_obs, L_theo = L_theo,
      stringsAsFactors = FALSE
    ),
    G_curve = data.frame(
      r = G$r, G_obs = G$km, G_theo = G$theo,
      stringsAsFactors = FALSE
    )
  )
}

df$cell_type <- cells_out$cell_type
samples <- unique(df$sample_id)
scalar_rows <- vector("list", length(samples))
names(scalar_rows) <- samples

for (sid in samples) {
  sub <- df[df$sample_id == sid, , drop = FALSE]
  m <- compute_sample_metrics(sub, type_a, radius_k, radius_g)
  scalar_rows[[sid]] <- data.frame(
    sample_id = sid,
    cell_type = type_a,
    n_cd8 = m$n_cd8,
    ripley_k_L_minus_r_at_r50 = m$ripley_k_L_minus_r,
    nn_g_deviation_at_r20 = m$nn_g,
    stringsAsFactors = FALSE
  )
  if (!is.null(m$K_curve)) {
    safe_id <- gsub("[^A-Za-z0-9._-]+", "_", sid)
    write.csv(m$K_curve,
              file.path(out_dir, "spatial_curves", paste0(safe_id, "_K.csv")),
              row.names = FALSE)
    write.csv(m$G_curve,
              file.path(out_dir, "spatial_curves", paste0(safe_id, "_G.csv")),
              row.names = FALSE)
  }
}

scalars <- do.call(rbind, scalar_rows)
scalars_path <- file.path(out_dir, "spatial_scalars.csv")
write.csv(scalars, scalars_path, row.names = FALSE)
message("Wrote ", scalars_path)
message("Wrote ", length(list.files(file.path(out_dir, "spatial_curves"))),
        " curve files under spatial_curves/")

# ---- local Cox PH (sanity check) -------------------------------------------

if (requireNamespace("survival", quietly = TRUE)) {
  joined <- merge(
    scalars[, c("sample_id", "ripley_k_L_minus_r_at_r50", "nn_g_deviation_at_r20")],
    surv,
    by = "sample_id"
  )
  joined <- joined[complete.cases(joined), , drop = FALSE]
  if (nrow(joined) >= 3L) {
    fit_k <- tryCatch(
      survival::coxph(
        survival::Surv(time, status) ~ ripley_k_L_minus_r_at_r50,
        data = joined
      ),
      error = function(e) e
    )
    fit_g <- tryCatch(
      survival::coxph(
        survival::Surv(time, status) ~ nn_g_deviation_at_r20,
        data = joined
      ),
      error = function(e) e
    )
    cox_path <- file.path(out_dir, "cox_summary.txt")
    sink(cox_path)
    cat("Local Cox PH models (n =", nrow(joined), "samples)\n")
    cat("Ripley's K (L-r at r=50) ~ survival:\n")
    if (inherits(fit_k, "error")) cat("  ERROR:", conditionMessage(fit_k), "\n")
    else print(summary(fit_k))
    cat("\nNN G deviation (at r=20) ~ survival:\n")
    if (inherits(fit_g, "error")) cat("  ERROR:", conditionMessage(fit_g), "\n")
    else print(summary(fit_g))
    sink()
    message("Wrote ", cox_path)
  }
}

message("\nDone. Upload cells.csv via Contribute, then attach survival.csv on the dataset page.")
