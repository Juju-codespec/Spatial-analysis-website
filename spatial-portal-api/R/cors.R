# CORS support for the plumber API.
#
# Adds Access-Control-* headers to every response and short-circuits the
# OPTIONS preflight so browsers can call the API from the Vite dev server
# (or any allow-listed origin) without tripping the same-origin policy.

#' @noRd
cors_filter <- function(req, res) {
  origin_allowed <- cfg()$cors_origin
  origin_header <- req$HTTP_ORIGIN %||% ""

  allow_origin <- if (identical(origin_allowed, "*") || origin_header == "") {
    if (identical(origin_allowed, "*")) "*" else origin_allowed
  } else {
    allowed <- strsplit(origin_allowed, ",", fixed = TRUE)[[1]]
    allowed <- trimws(allowed)
    if (origin_header %in% allowed) origin_header else allowed[[1]]
  }

  res$setHeader("Access-Control-Allow-Origin", allow_origin)
  res$setHeader("Vary", "Origin")
  res$setHeader("Access-Control-Allow-Methods",
                "GET, POST, PUT, DELETE, OPTIONS")
  res$setHeader("Access-Control-Allow-Headers",
                "Content-Type, Authorization, X-API-Key")
  res$setHeader("Access-Control-Max-Age", "86400")

  if (identical(req$REQUEST_METHOD, "OPTIONS")) {
    res$status <- 204L
    return(list())
  }

  plumber::forward()
}

#' Optional API key check. When `API_KEY` is unset, the filter is a no-op.
#' @noRd
api_key_filter <- function(req, res) {
  expected <- cfg()$api_key
  if (!nzchar(expected)) return(plumber::forward())

  path <- req$PATH_INFO %||% ""
  if (identical(path, "/health")) return(plumber::forward())

  supplied <- req$HTTP_X_API_KEY %||% ""
  if (!identical(supplied, expected)) {
    res$status <- 401L
    return(list(error = "Unauthorized", message = "Invalid or missing API key"))
  }
  plumber::forward()
}

`%||%` <- function(a, b) if (is.null(a) || identical(a, "")) b else a
