# Asynchronous job registry built on the `future` package.
#
# Heavy work (multi-sample Ripley K, cohort-wide Cox with bootstrap, etc.)
# is launched with `future::future()` and tracked in an in-memory registry
# keyed by UUID. Endpoints can return `{jobId}` immediately and let the
# frontend poll `GET /jobs/:id` for status/result.

.jobs <- new.env(parent = emptyenv())

#' Initialize the future plan once at startup. Multisession works on every
#' OS and avoids forking issues; override with FUTURE_PLAN env if desired.
init_jobs <- function() {
  plan_name <- Sys.getenv("FUTURE_PLAN", "multisession")
  workers <- as.integer(Sys.getenv("FUTURE_WORKERS",
                                   as.character(max(1L, parallel::detectCores() - 1L))))
  if (plan_name == "sequential") {
    future::plan(future::sequential)
  } else {
    future::plan(future::multisession, workers = workers)
  }
  invisible(NULL)
}

#' Submit a function for asynchronous execution.
#' @param fn A zero-arg function that performs the work.
#' @return The job id (UUID string).
submit_job <- function(fn) {
  id <- uuid::UUIDgenerate()
  .jobs[[id]] <- list(
    id        = id,
    status    = "queued",
    submitted = Sys.time(),
    future    = future::future(fn(), seed = TRUE),
    result    = NULL,
    error     = NULL
  )
  id
}

#' Retrieve current state of a job. Calling this also promotes "queued"
#' jobs to "running" / "completed" / "failed" as their futures resolve.
get_job <- function(id) {
  job <- .jobs[[id]]
  if (is.null(job)) return(NULL)

  if (job$status %in% c("completed", "failed")) return(job_to_public(job))

  if (future::resolved(job$future)) {
    res <- tryCatch(future::value(job$future), error = function(e) {
      job$status <- "failed"
      job$error <- conditionMessage(e)
      job
    })
    if (job$status != "failed") {
      job$status <- "completed"
      job$result <- res
      job$completed <- Sys.time()
    }
    .jobs[[id]] <- job
  } else {
    job$status <- "running"
    .jobs[[id]] <- job
  }

  job_to_public(job)
}

job_to_public <- function(job) {
  list(
    id        = job$id,
    status    = job$status,
    submitted = format(job$submitted, "%Y-%m-%dT%H:%M:%SZ", tz = "UTC"),
    completed = if (!is.null(job$completed))
      format(job$completed, "%Y-%m-%dT%H:%M:%SZ", tz = "UTC") else NULL,
    result    = job$result,
    error     = job$error
  )
}

list_jobs <- function() {
  ids <- ls(.jobs)
  lapply(ids, get_job)
}
