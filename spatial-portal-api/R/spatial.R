# Spatial point-pattern statistics for Vectra-style tumor imaging data.
#
# Provides two entry points:
#   ripleys_k() — Ripley's K (and Besag's L) for one cell type or between
#                 two cell types (cross-K).
#   nn_g()     — Nearest-neighbour distance distribution G (or cross-G).
#
# Each function operates on the harmonized `cells` data.table produced by
# cells.R. A point pattern is built per-sample inside a tissue window
# (convex hull of all cells by default, or a bounding box); optional CSR
# simulation envelopes add inferential context. Results are aggregated into
# a tidy list ready for JSON serialization or downstream survival modelling.

# ---- Ripley's K ------------------------------------------------------------

#' Compute Ripley's K for one or two cell types across selected samples.
#'
#' @param cells data.table with columns sample_id, x, y, cell_type.
#' @param sample_ids Optional character vector of samples to include; defaults
#'   to all samples in `cells`.
#' @param type_a Cell type whose pattern is the focal type.
#' @param type_b Optional second cell type. When supplied, the cross K is
#'   computed; otherwise the univariate K is returned.
#' @param r Optional numeric vector of radii at which to evaluate K. Default:
#'   spatstat picks based on window size.
#' @param correction Edge-correction method passed to Kest/Kcross.
#'   Recommended: "iso" (Ripley's isotropic).
#' @param max_cells Per-sample downsample cap. NULL means no cap.
#' @param window_type Observation window: "convex" (tissue convex hull,
#'   default) or "bbox" (axis-aligned rectangle).
#' @param nsim Number of CSR simulations for envelope bands; 0 skips envelopes.
#' @return A list with `per_sample` (list of tibbles) and `summary`
#'   (aggregated mean K across samples).
ripleys_k <- function(cells, sample_ids = NULL, type_a, type_b = NULL,
                      r = NULL, correction = "iso", max_cells = NULL,
                      window_type = c("convex", "bbox"), nsim = 0L) {
  window_type <- match.arg(window_type)
  require_spatstat()
  stopifnot(data.table::is.data.table(cells))
  if (is.null(sample_ids)) sample_ids <- unique(cells$sample_id)
  per_sample <- list()

  for (sid in sample_ids) {
    sub <- cells[sample_id == sid]
    if (nrow(sub) < 10L) next

    if (!is.null(max_cells) && nrow(sub) > max_cells) {
      sub <- sub[sample(.N, max_cells)]
    }

    built <- build_ppp(sub, type_a = type_a, type_b = type_b,
                       window_type = window_type)
    if (is.null(built)) next
    ppp <- built$ppp

    res <- tryCatch({
      if (is.null(type_b)) {
        fv <- spatstat.explore::Kest(ppp, r = r, correction = correction)
      } else {
        fv <- spatstat.explore::Kcross(ppp, i = type_a, j = type_b,
                                       r = r, correction = correction)
      }
      out <- fv_to_list(fv, kind = "K")
      if (nsim > 0L) {
        env <- compute_envelope(ppp, kind = "K", type_a = type_a, type_b = type_b,
                                correction = correction, nsim = nsim, r = r)
        if (!is.null(env)) out <- c(out, env)
      }
      out
    }, error = function(e) {
      list(error = e$message)
    })

    if (!is.null(res$error)) next
    per_sample[[sid]] <- c(
      list(sample_id = sid),
      built$meta,
      res
    )
  }

  list(
    type_a       = type_a,
    type_b       = type_b,
    correction   = correction,
    window_type  = window_type,
    nsim         = as.integer(nsim),
    per_sample   = unname(per_sample),
    summary      = aggregate_curves(
      per_sample,
      value_cols = c("K_obs", "K_theo", "L_obs", "L_theo",
                     "envelope_lo", "envelope_hi")
    )
  )
}

# ---- Nearest neighbour G ---------------------------------------------------

#' Compute the nearest-neighbour distance distribution G.
#' @inheritParams ripleys_k
#' @param correction Default "km" (Kaplan-Meier), the spatstat recommendation
#'   for G under edge effects.
nn_g <- function(cells, sample_ids = NULL, type_a, type_b = NULL,
                 r = NULL, correction = "km", max_cells = NULL,
                 window_type = c("convex", "bbox"), nsim = 0L) {
  window_type <- match.arg(window_type)
  require_spatstat()
  stopifnot(data.table::is.data.table(cells))
  if (is.null(sample_ids)) sample_ids <- unique(cells$sample_id)
  per_sample <- list()

  for (sid in sample_ids) {
    sub <- cells[sample_id == sid]
    if (nrow(sub) < 10L) next
    if (!is.null(max_cells) && nrow(sub) > max_cells) {
      sub <- sub[sample(.N, max_cells)]
    }

    built <- build_ppp(sub, type_a = type_a, type_b = type_b,
                       window_type = window_type)
    if (is.null(built)) next
    ppp <- built$ppp

    res <- tryCatch({
      if (is.null(type_b)) {
        fv <- spatstat.explore::Gest(ppp, r = r, correction = correction)
      } else {
        fv <- spatstat.explore::Gcross(ppp, i = type_a, j = type_b,
                                       r = r, correction = correction)
      }
      out <- fv_to_list(fv, kind = "G")
      if (nsim > 0L) {
        env <- compute_envelope(ppp, kind = "G", type_a = type_a, type_b = type_b,
                                correction = correction, nsim = nsim, r = r)
        if (!is.null(env)) out <- c(out, env)
      }
      out
    }, error = function(e) list(error = e$message))

    if (!is.null(res$error)) next
    per_sample[[sid]] <- c(
      list(sample_id = sid),
      built$meta,
      res
    )
  }

  list(
    type_a       = type_a,
    type_b       = type_b,
    correction   = correction,
    window_type  = window_type,
    nsim         = as.integer(nsim),
    per_sample   = unname(per_sample),
    summary      = aggregate_curves(
      per_sample,
      value_cols = c("G_obs", "G_theo", "envelope_lo", "envelope_hi")
    )
  )
}

# ---- Helpers ---------------------------------------------------------------

require_spatstat <- function() {
  if (!requireNamespace("spatstat.geom", quietly = TRUE) ||
      !requireNamespace("spatstat.explore", quietly = TRUE)) {
    stop("spatstat.geom and spatstat.explore are required.", call. = FALSE)
  }
}

#' Build a tissue-bounded ppp for one sample. If type_b is supplied, returns a
#' multitype ppp; otherwise the focal type's univariate pattern.
#'
#' Returns a list with `ppp` and `meta` (n_focal, n_total, tissue_area).
build_ppp <- function(sub, type_a, type_b = NULL,
                      window_type = c("convex", "bbox")) {
  window_type <- match.arg(window_type)
  if (nrow(sub) == 0L) return(NULL)
  win <- build_tissue_window(sub$x, sub$y, window_type = window_type)
  if (is.null(win)) return(NULL)

  if (is.null(type_b)) {
    pts <- sub[cell_type == type_a]
    if (nrow(pts) < 4L) return(NULL)
    ppp <- spatstat.geom::ppp(pts$x, pts$y, window = win, check = FALSE)
    list(
      ppp = ppp,
      meta = list(
        n_focal = nrow(pts),
        n_total = nrow(sub),
        tissue_area = unname(spatstat.geom::area(win))
      )
    )
  } else {
    pts <- sub[cell_type %in% c(type_a, type_b)]
    if (nrow(pts) < 4L) return(NULL)
    if (sum(pts$cell_type == type_a) < 2L) return(NULL)
    if (sum(pts$cell_type == type_b) < 2L) return(NULL)

    marks <- factor(pts$cell_type, levels = c(type_a, type_b))
    ppp <- spatstat.geom::ppp(pts$x, pts$y, window = win, marks = marks,
                              check = FALSE)
    list(
      ppp = ppp,
      meta = list(
        n_focal = sum(pts$cell_type == type_a),
        n_total = nrow(sub),
        tissue_area = unname(spatstat.geom::area(win))
      )
    )
  }
}

#' Observation window from all cell coordinates in a sample.
build_tissue_window <- function(x, y, window_type = c("convex", "bbox")) {
  window_type <- match.arg(window_type)
  x <- x[is.finite(x)]
  y <- y[is.finite(y)]
  if (length(x) < 3L) {
    return(spatstat.geom::owin(
      xrange = range(x, finite = TRUE),
      yrange = range(y, finite = TRUE)
    ))
  }
  if (window_type == "bbox") {
    return(spatstat.geom::owin(
      xrange = range(x, finite = TRUE),
      yrange = range(y, finite = TRUE)
    ))
  }
  hull <- tryCatch(
    spatstat.geom::convexhull.xy(x, y),
    error = function(e) NULL
  )
  if (is.null(hull)) {
    return(spatstat.geom::owin(
      xrange = range(x, finite = TRUE),
      yrange = range(y, finite = TRUE)
    ))
  }
  spatstat.geom::as.owin(hull)
}

#' CSR simulation envelopes for K or G using spatstat::envelope().
compute_envelope <- function(ppp, kind = c("K", "G"), type_a = NULL,
                             type_b = NULL, correction = NULL,
                             nsim = 49L, r = NULL) {
  kind <- match.arg(kind)
  if (nsim <= 0L) return(NULL)

  env <- tryCatch({
    if (kind == "K") {
      if (is.null(type_b)) {
        spatstat.explore::envelope(
          ppp,
          fun = spatstat.explore::Kest,
          correction = correction,
          nsim = nsim,
          fix.n = TRUE,
          savefuns = FALSE,
          r = r
        )
      } else {
        spatstat.explore::envelope(
          ppp,
          fun = spatstat.explore::Kcross,
          i = type_a,
          j = type_b,
          correction = correction,
          nsim = nsim,
          fix.n = TRUE,
          savefuns = FALSE,
          r = r
        )
      }
    } else if (is.null(type_b)) {
      spatstat.explore::envelope(
        ppp,
        fun = spatstat.explore::Gest,
        correction = correction,
        nsim = nsim,
        fix.n = TRUE,
        savefuns = FALSE,
        r = r
      )
    } else {
      spatstat.explore::envelope(
        ppp,
        fun = spatstat.explore::Gcross,
        i = type_a,
        j = type_b,
        correction = correction,
        nsim = nsim,
        fix.n = TRUE,
        savefuns = FALSE,
        r = r
      )
    }
  }, error = function(e) NULL)

  if (is.null(env)) return(NULL)
  envelope_to_list(env, kind = kind)
}

envelope_to_list <- function(env, kind = c("K", "G")) {
  kind <- match.arg(kind)
  df <- as.data.frame(env)
  obs_col <- pick_fv_column(names(df))
  lo_col <- if ("lo" %in% names(df)) "lo" else if (".lo" %in% names(df)) ".lo" else NULL
  hi_col <- if ("hi" %in% names(df)) "hi" else if (".hi" %in% names(df)) ".hi" else NULL
  if (is.null(lo_col) || is.null(hi_col)) return(NULL)

  out <- list(
    r = df$r,
    envelope_lo = df[[lo_col]],
    envelope_hi = df[[hi_col]],
    envelope_p = unname(attr(env, "p"))
  )
  prefix <- if (kind == "K") "K" else "G"
  out[[paste0(prefix, "_obs")]] <- df[[obs_col]]
  out
}

#' Convert a spatstat fv (function value) object into a JSON-friendly list,
#' including r, observed values, theoretical values, and Besag's L for K.
fv_to_list <- function(fv, kind = c("K", "G")) {
  kind <- match.arg(kind)
  df <- as.data.frame(fv)
  obs_col <- pick_fv_column(names(df))
  theo_col <- if ("theo" %in% names(df)) "theo" else NULL

  out <- list(r = df$r)
  out[[paste0(kind, "_obs")]] <- df[[obs_col]]
  if (!is.null(theo_col)) out[[paste0(kind, "_theo")]] <- df[[theo_col]]

  if (kind == "K") {
    # Besag's L(r) = sqrt(K(r)/pi); deviation L(r) - r centers at 0 under CSR.
    out$L_obs <- suppressWarnings(sqrt(pmax(df[[obs_col]], 0) / pi))
    if (!is.null(theo_col)) {
      out$L_theo <- suppressWarnings(sqrt(pmax(df[[theo_col]], 0) / pi))
    }
  }
  out
}

# Pick the best observed-estimate column from a spatstat fv data frame.
# Priority follows spatstat documentation recommendations:
#   K: iso (Ripley), trans, border, han
#   G: km (Kaplan-Meier), rs (reduced sample), han, raw
pick_fv_column <- function(cols) {
  preferred <- c("iso", "km", "trans", "border", "han", "rs", "raw")
  hits <- cols[match(preferred, cols, nomatch = 0L)]
  if (length(hits) > 0L) return(hits[1])
  # Last resort: first non-r/theo column.
  rest <- setdiff(cols, c("r", "theo"))
  if (length(rest) == 0L) stop("No observed estimate column in fv object",
                               call. = FALSE)
  rest[1]
}

#' Aggregate per-sample curves onto a common r grid by mean (+/- SE).
aggregate_curves <- function(per_sample, value_cols) {
  if (length(per_sample) == 0L) return(list())
  # Use the first sample's r grid as canonical; others are interpolated to it.
  ref <- per_sample[[1]]
  r_grid <- ref$r
  out <- list(r = r_grid)
  for (col in value_cols) {
    mat <- vapply(per_sample, function(s) {
      if (is.null(s[[col]])) return(rep(NA_real_, length(r_grid)))
      if (length(s$r) == length(r_grid) &&
          isTRUE(all.equal(s$r, r_grid))) {
        return(s[[col]])
      }
      stats::approx(x = s$r, y = s[[col]], xout = r_grid, rule = 2)$y
    }, numeric(length(r_grid)))
    out[[paste0(col, "_mean")]] <- rowMeans(mat, na.rm = TRUE)
    n <- rowSums(!is.na(mat))
    sd <- apply(mat, 1, stats::sd, na.rm = TRUE)
    out[[paste0(col, "_se")]] <- sd / sqrt(pmax(n, 1L))
  }
  out
}

#' Reduce per-sample K/G output to a scalar summary at a chosen radius.
#'
#' For K: `L(r0) - r0` (positive = clustering, 0 = CSR, negative = regular).
#' For G: `G(r0) - G_theo(r0)` (positive = clustering near nearest neighbour).
#'
#' Returns a data.frame with columns `sample_id` and `stat`.
spatial_summary_at_r <- function(result, radius, statistic = c("K", "G")) {
  statistic <- match.arg(statistic)
  if (length(result$per_sample) == 0L) {
    return(data.frame(sample_id = character(), stat = numeric()))
  }

  rows <- lapply(result$per_sample, function(s) {
    if (statistic == "K") {
      obs <- s$L_obs
      theo <- s$L_theo %||% s$r
      val <- stats::approx(s$r, obs, xout = radius, rule = 2)$y -
             stats::approx(s$r, theo, xout = radius, rule = 2)$y
    } else {
      obs <- s$G_obs
      theo <- s$G_theo %||% rep(NA_real_, length(s$r))
      val <- stats::approx(s$r, obs, xout = radius, rule = 2)$y -
             stats::approx(s$r, theo, xout = radius, rule = 2)$y
    }
    data.frame(
      sample_id = s$sample_id,
      stat = unname(val),
      n_focal = s$n_focal %||% NA_real_,
      tissue_area = s$tissue_area %||% NA_real_,
      stringsAsFactors = FALSE
    )
  })
  do.call(rbind, rows)
}
