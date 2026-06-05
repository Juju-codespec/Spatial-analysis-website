# Wilcoxon rank-sum (Mann–Whitney) comparison of per-sample spatial summaries
# between two groups defined by a survival-metadata column.

#' Columns in survival data suitable as a two-level grouping variable.
eligible_group_columns <- function(surv_df) {
  if (is.null(surv_df) || nrow(surv_df) == 0L) return(character())
  skip <- c("sample_id", "time", "status", "patient_id")
  cols <- setdiff(names(surv_df), skip)
  eligible <- character()
  for (col in cols) {
    vals <- surv_df[[col]]
    vals <- vals[!is.na(vals)]
    if (length(vals) == 0L) next
    u <- unique(as.character(vals))
    if (length(u) == 2L) eligible <- c(eligible, col)
  }
  if ("status" %in% names(surv_df)) {
    u <- unique(as.character(surv_df$status[!is.na(surv_df$status)]))
    if (length(u) == 2L) eligible <- c(eligible, "status")
  }
  unique(eligible)
}

#' Merge per-sample spatial stats with survival metadata (sample_id first).
merge_stats_survival <- function(stats_per_sample, surv_df) {
  joined <- merge(stats_per_sample, surv_df, by = "sample_id")
  if (nrow(joined) == 0L && "patient_id" %in% names(surv_df)) {
    joined <- merge(stats_per_sample, surv_df,
                    by.x = "sample_id", by.y = "patient_id")
  }
  joined
}

#' Wilcoxon rank-sum test on spatial stat between two groups.
wilcox_from_stat <- function(stats_per_sample, surv_df, group_column,
                             group_a = NULL, group_b = NULL) {
  group_column <- as.character(group_column)
  if (!group_column %in% names(surv_df)) {
    stop(sprintf("Group column '%s' not found in survival data.", group_column),
         call. = FALSE)
  }

  joined <- merge_stats_survival(stats_per_sample, surv_df)
  if (nrow(joined) == 0L) {
    stop("No overlap between sample_ids in spatial stats and survival data.",
         call. = FALSE)
  }

  joined <- joined[is.finite(joined$stat) & !is.na(joined[[group_column]]), ,
                   drop = FALSE]
  joined$group <- as.character(joined[[group_column]])

  levels <- sort(unique(joined$group))
  if (length(levels) < 2L) {
    stop(sprintf(
      "Group column '%s' must have two levels with complete spatial stats (found %d).",
      group_column, length(levels)
    ), call. = FALSE)
  }
  if (length(levels) > 2L) {
    if (is.null(group_a) || is.null(group_b)) {
      stop(sprintf(
        "Group column '%s' has %d levels; specify groupA and groupB.",
        group_column, length(levels)
      ), call. = FALSE)
    }
    levels <- c(as.character(group_a), as.character(group_b))
  } else {
    group_a <- levels[1]
    group_b <- levels[2]
  }

  sub <- joined[joined$group %in% levels, , drop = FALSE]
  n_a <- sum(sub$group == group_a)
  n_b <- sum(sub$group == group_b)
  if (n_a < 3L || n_b < 3L) {
    stop(sprintf(
      "Need at least 3 samples per group (have %s=%d, %s=%d).",
      group_a, n_a, group_b, n_b
    ), call. = FALSE)
  }

  sub$group <- factor(sub$group, levels = levels)
  wt <- stats::wilcox.test(stat ~ group, data = sub, exact = FALSE,
                           alternative = "two.sided")

  group_summary <- function(lab) {
    vals <- sub$stat[sub$group == lab]
    qs <- stats::quantile(vals, c(0.25, 0.5, 0.75), na.rm = TRUE)
    list(
      label  = lab,
      n      = length(vals),
      mean   = mean(vals),
      median = unname(qs[2]),
      q1     = unname(qs[1]),
      q3     = unname(qs[3])
    )
  }

  w <- unname(wt$statistic)
  rank_biserial <- (2 * w / (n_a * n_b)) - 1

  list(
    method        = "Wilcoxon rank sum test with continuity correction",
    alternative   = "two.sided",
    w             = w,
    p_value       = unname(wt$p.value),
    group_column  = group_column,
    group_a       = group_a,
    group_b       = group_b,
    rank_biserial = rank_biserial,
    groups        = list(group_summary(group_a), group_summary(group_b)),
    points        = sub[, c("sample_id", "group", "stat"), drop = FALSE]
  )
}
