# liking-anova v1: compare liking between samples, per hedonic question.
# Two-way ANOVA (sample + assessor) with Tukey HSD or Fisher LSD, or Friedman's rank test with
# Conover's pairwise comparison of rank sums (as agricolae::friedman).
source(file.path(commandArgs(TRUE)[1], "common.R"))

ci <- function(x, level = 0.95) {
  n <- length(x)
  if (n < 2) return(c(NA, NA))
  half <- stats::qt(1 - (1 - level) / 2, n - 1) * stats::sd(x) / sqrt(n)
  c(mean(x) - half, mean(x) + half)
}

pairs_from <- function(levels, pmatrix, diffs, alpha) {
  out <- list()
  if (length(levels) < 2) return(out)
  for (i in 1:(length(levels) - 1)) for (j in (i + 1):length(levels)) {
    p <- pmatrix[i, j]
    out[[length(out) + 1]] <- list(
      a = levels[i], b = levels[j], difference = val(diffs[i, j]), p_value = val(p),
      significant = isTRUE(!is.na(p) && p < alpha)
    )
  }
  out
}

anova_rows <- function(fit) {
  table <- summary(fit)[[1]]
  terms <- trimws(rownames(table))
  lapply(seq_along(terms), function(i) list(
    term = c(sample = "Sample", assessor = "Assessor", Residuals = "Residual")[[terms[i]]],
    df = table[i, "Df"], sum_sq = val(table[i, "Sum Sq"]), mean_sq = val(table[i, "Mean Sq"]),
    statistic = val(table[i, "F value"]), p_value = val(table[i, "Pr(>F)"])
  ))
}

analyse <- function(d, alpha, comparison) {
  levels <- sort(unique(d$sample))
  k <- length(levels)
  d$sample <- factor(d$sample, levels = levels)
  d$assessor <- factor(d$assessor)
  means <- tapply(d$value, d$sample, mean)
  pmatrix <- matrix(NA_real_, k, k, dimnames = list(levels, levels))
  diffs <- outer(means, means, "-")
  statistic <- NA
  p_value <- NA
  table <- list()
  lsd <- NA
  test_name <- "ANOVA"
  if (k >= 2 && stats::var(d$value) > 0) {
    if (comparison == "friedman") {
      test_name <- "Friedman"
      wide <- tapply(d$value, list(d$assessor, d$sample), mean)
      wide <- wide[stats::complete.cases(wide), , drop = FALSE]
      b <- nrow(wide)
      if (b >= 2) {
        ranks <- t(apply(wide, 1, rank))
        sums <- colSums(ranks)
        test <- stats::friedman.test(wide)
        statistic <- unname(test$statistic)
        p_value <- test$p.value
        table <- list(list(term = "Sample (ranks)", df = unname(test$parameter),
                           sum_sq = NA, mean_sq = NA, statistic = statistic, p_value = p_value))
        A <- sum(ranks^2)
        B <- sum(sums^2) / b
        denominator <- 2 * b * (A - B) / ((b - 1) * (k - 1))
        df <- (b - 1) * (k - 1)
        rank_diffs <- outer(sums, sums, "-")
        if (denominator > 0) {
          pmatrix[] <- 2 * stats::pt(-abs(rank_diffs) / sqrt(denominator), df)
        }
      }
    } else {
      blocked <- nlevels(d$assessor) >= 2
      fit <- if (blocked) stats::aov(value ~ sample + assessor, data = d) else
        stats::aov(value ~ sample, data = d)
      table <- anova_rows(fit)
      statistic <- table[[1]]$statistic
      p_value <- table[[1]]$p_value
      residual <- summary(fit)[[1]]
      mse <- residual["Residuals", "Mean Sq"]
      dfe <- residual["Residuals", "Df"]
      counts <- tapply(d$value, d$sample, length)
      if (comparison == "tukey") {
        test_name <- "ANOVA with Tukey HSD"
        tukey <- stats::TukeyHSD(fit, "sample")$sample
        index <- utils::combn(k, 2)
        for (column in seq_len(ncol(index))) {
          i <- index[1, column]; j <- index[2, column]
          pmatrix[i, j] <- pmatrix[j, i] <- tukey[column, "p adj"]
        }
      } else {
        test_name <- "ANOVA with Fisher LSD"
        for (i in 1:k) for (j in 1:k) if (i != j) {
          se <- sqrt(mse * (1 / counts[i] + 1 / counts[j]))
          pmatrix[i, j] <- 2 * stats::pt(-abs(means[i] - means[j]) / se, dfe)
        }
        if (length(unique(counts)) == 1) {
          lsd <- stats::qt(1 - alpha / 2, dfe) * sqrt(2 * mse / counts[1])
        }
      }
    }
  } else if (k >= 2) {
    warn("zero_variance")
  }
  groups <- if (all(is.na(pmatrix[upper.tri(pmatrix)]))) rep(NA, k) else
    letters_from(pmatrix, alpha)
  samples <- lapply(seq_len(k), function(i) {
    x <- d$value[d$sample == levels[i]]
    bounds <- ci(x)
    list(code = levels[i], n = length(x), mean = mean(x),
         sd = if (length(x) > 1) stats::sd(x) else NA,
         ci_low = val(bounds[1]), ci_high = val(bounds[2]), group = val(groups[[i]]))
  })
  list(test_name = test_name, statistic = val(statistic), p_value = val(p_value),
       samples = samples, pairs = pairs_from(levels, pmatrix, diffs, alpha), table = table,
       lsd = val(lsd))
}

run_recipe(function() {
  rows <- read_rows("rows_main.csv")
  alpha <- PARAMS$alpha
  comparison <- PARAMS$comparison
  value <- num(rows$value)
  used <- !is.na(value) & !is.na(rows$sample_code) & rows$state %in% c("rated", "answered")
  if (!any(used)) warn("no_rows")
  questions <- list()
  for (q in CONTEXT$test$questions) {
    keep <- used & rows$question_id == q$id
    if (!any(keep)) next
    d <- data.frame(value = value[keep], sample = rows$sample_code[keep],
                    assessor = rows$session_id[keep], stringsAsFactors = FALSE)
    n_assessors <- length(unique(d$assessor))
    if (n_assessors < 12) warn("few_assessors", n = n_assessors, question = q$text)
    cells <- table(d$assessor, d$sample)
    if (any(cells != 1)) warn("unbalanced", question = q$text)
    if (length(unique(d$sample)) < 2) warn("single_sample", question = q$text)
    out <- analyse(d, alpha, comparison)
    questions[[length(questions) + 1]] <- c(
      list(question_id = q$id, question = q$text, n_assessors = n_assessors,
           n_ratings = nrow(d)),
      out
    )
    index <- length(questions)
    figure(sprintf("liking_%02d.png", index), function() {
      s <- out$samples
      m <- vapply(s, function(x) x$mean, 0)
      lo <- vapply(s, function(x) if (is.na(x$ci_low)) x$mean else x$ci_low, 0)
      hi <- vapply(s, function(x) if (is.na(x$ci_high)) x$mean else x$ci_high, 0)
      names <- vapply(s, function(x) x$code, "")
      labels <- vapply(s, function(x) if (is.na(x$group)) "" else x$group, "")
      graphics::par(mar = c(4, 4, 3, 1))
      centres <- graphics::barplot(m, names.arg = names, ylim = c(1, 9.5), xpd = FALSE,
                                   col = "grey80", border = NA, ylab = "Mean liking (1–9)",
                                   main = q$text)
      graphics::arrows(centres, lo, centres, hi, angle = 90, code = 3, length = 0.05)
      graphics::text(centres, pmin(hi + 0.35, 9.4), labels, font = 2)
    })
  }
  write_result(list(
    recipe = "liking-anova", version = 1L, rows_used = sum(used),
    rows_left_out = left_out(rows, used), alpha = alpha, comparison = comparison,
    questions = questions
  ))
})
