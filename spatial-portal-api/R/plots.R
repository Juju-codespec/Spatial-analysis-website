# Server-side ggplot2 rendering of cell-type spatial maps.
#
# Exposes two public functions:
#   plot_sample_cells()    — build a ggplot2 object for one tissue core.
#   render_cell_plot_png() — render that plot to raw PNG bytes.
#
# Key design choice: coord_equal() locks the x and y scales to the same
# physical unit, so TMA cores that are circular in pixel-space appear as
# perfect circles in the output image rather than ovals. Without this, the
# aspect ratio of the plot panel vs the data range produces oval distortion.

CELL_PLOT_COLORS <- c(
  "Tumor"       = "#ef4444",
  "CD8+ T Cell" = "#3b82f6",
  "CD4+ T Cell" = "#8b5cf6",
  "T Cell"      = "#a78bfa",
  "Macrophage"  = "#f59e0b",
  "NK Cell"     = "#10b981",
  "B Cell"      = "#06b6d4",
  "Stromal"     = "#6b7280",
  "CAF"         = "#f97316",
  "Fibroblast"  = "#84cc16",
  "Other"       = "#94a3b8"
)

#' Build a ggplot2 scatter map for cells in one tissue core.
#'
#' coord_equal() ensures the x and y pixel scales are identical, so TMA
#' cores that are circular in image-space render as circles rather than ovals.
#' scale_y_reverse() matches the image-space convention (y = 0 at top).
#'
#' @param cells      data.table or data.frame with x, y, cell_type columns.
#' @param title      Plot title (typically the sample_id).
#' @param point_size Dot size in ggplot2 units. Smaller values reduce overlap
#'                   in dense cores.
#' @param alpha      Point opacity (0–1).
#' @return A ggplot object ready to print or ggsave.
plot_sample_cells <- function(cells, title = NULL, point_size = 0.6,
                              alpha = 0.75) {
  if (!requireNamespace("ggplot2", quietly = TRUE)) {
    stop(
      "ggplot2 is required for cell-map rendering. ",
      "Install with: install.packages('ggplot2')",
      call. = FALSE
    )
  }

  df <- as.data.frame(cells[, c("x", "y", "cell_type")])
  df$cell_type <- as.character(df$cell_type)

  # Assign colours: known types use CELL_PLOT_COLORS, extras get slate-grey.
  types   <- unique(df$cell_type)
  known   <- intersect(types, names(CELL_PLOT_COLORS))
  extra   <- setdiff(types, names(CELL_PLOT_COLORS))
  palette <- c(
    CELL_PLOT_COLORS[known],
    stats::setNames(rep("#94a3b8", length(extra)), extra)
  )

  p <- ggplot2::ggplot(df, ggplot2::aes(x = x, y = y, color = cell_type)) +
    ggplot2::geom_point(size = point_size, alpha = alpha, stroke = 0,
                        shape = 16) +
    ggplot2::scale_color_manual(values = palette, name = "Cell type") +
    # coord_equal() is the key call: it forces a 1:1 aspect ratio between the
    # x and y axes so that distances in both directions map to the same number
    # of screen pixels. Without it, ggplot will stretch the panel to fill the
    # device dimensions, turning circular cores into ovals.
    ggplot2::coord_equal() +
    # Image-space convention: pixel row 0 is at the top of the frame.
    ggplot2::scale_y_reverse() +
    ggplot2::theme_void(base_size = 9) +
    ggplot2::theme(
      plot.background  = ggplot2::element_rect(fill = "#0d1117", color = NA),
      panel.background = ggplot2::element_rect(fill = "#0d1117", color = NA),
      legend.text      = ggplot2::element_text(color = "#94a3b8", size = 7),
      legend.title     = ggplot2::element_text(color = "#cbd5e1", size = 8,
                                               face = "bold"),
      legend.key       = ggplot2::element_rect(fill = "#0d1117", color = NA),
      legend.background = ggplot2::element_rect(fill = "#0d1117", color = NA),
      plot.title       = ggplot2::element_text(
        color = "#e2e8f0", size = 10, hjust = 0.5,
        margin = ggplot2::margin(b = 6)
      ),
      plot.margin = ggplot2::margin(10, 10, 10, 10)
    )

  if (!is.null(title)) {
    p <- p + ggplot2::ggtitle(title)
  }
  p
}

#' Render plot_sample_cells() to raw PNG bytes.
#'
#' @param cells      data.table or data.frame (x, y, cell_type).
#' @param title      Passed to plot_sample_cells().
#' @param width      PNG width in pixels.
#' @param height     PNG height in pixels.
#' @param res        PNG resolution in dpi (affects text size relative to canvas).
#' @param point_size Passed to plot_sample_cells().
#' @return A raw vector of PNG bytes suitable for returning from a plumber
#'         endpoint or base64-encoding for a JSON response.
render_cell_plot_png <- function(cells, title = NULL, width = 800L,
                                 height = 700L, res = 120L,
                                 point_size = 0.6) {
  p <- plot_sample_cells(cells, title = title, point_size = point_size)
  tmp <- tempfile(fileext = ".png")
  on.exit(unlink(tmp), add = TRUE)
  grDevices::png(
    filename = tmp,
    width    = as.integer(width),
    height   = as.integer(height),
    res      = as.integer(res),
    bg       = "#0d1117"
  )
  tryCatch(print(p), finally = grDevices::dev.off())
  readBin(tmp, what = "raw", n = file.info(tmp)$size)
}
