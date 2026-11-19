# rata v1: per attribute, a two-way ANOVA (sample + assessor) on the rating with an unchecked
# attribute scored 0, as recommended by Meyners, Jaeger and Ares (2016), Tukey HSD or Fisher LSD
# letters, the share of assessors who checked it, and a PCA map of the sample-by-attribute means.
# A checked attribute without a rating (allowed when ratings are optional) and skips are left out.
source(file.path(commandArgs(TRUE)[1], "common.R"))

compare <- function(d, alpha, comparison) {
  levels <- sort(unique(d$sample))
  k <- length(levels)
  d$sample <- factor(d$sample, levels = levels)
  d$assessor <- factor(d$assessor)
  pmatrix <- matrix(NA_real_, k, k, dimnames = list(levels, levels))
  statistic <- NA
  p_value <- NA
  if (k >= 2 && stats::var(d$value) > 0) {
    fit <- if (nlevels(d$assessor) >= 2) stats::aov(value ~ sample + assessor, data = d) else
      stats::aov(value ~ sample, data = d)
    table <- summary(fit)[[1]]
    statistic <- table[1, "F value"]
    p_value <- table[1, "Pr(>F)"]
    if (comparison == "tukey") {
      tukey <- stats::TukeyHSD(fit, "sample")$sample
      index <- utils::combn(k, 2)
      for (column in seq_len(ncol(index))) {
        i <- index[1, column]; j <- index[2, column]
        pmatrix[i, j] <- pmatrix[j, i] <- tukey[column, "p adj"]
      }
    } else {
      means <- tapply(d$value, d$sample, mean)
      counts <- tapply(d$value, d$sample, length)
      mse <- table["Residuals", "Mean Sq"]
      dfe <- table["Residuals", "Df"]
      for (i in 1:k) for (j in 1:k) if (i != j) {
        se <- sqrt(mse * (1 / counts[i] + 1 / counts[j]))
        pmatrix[i, j] <- 2 * stats::pt(-abs(means[i] - means[j]) / se, dfe)
      }
    }
  } else if (k >= 2) {
    warn("zero_variance")
  }
  groups <- if (all(is.na(pmatrix[upper.tri(pmatrix)]))) stats::setNames(rep(NA, k), levels) else
    letters_from(pmatrix, alpha)
  list(statistic = val(statistic), p_value = val(p_value), groups = groups)
}

run_recipe(function() {
  rows <- read_rows("rows_main.csv")
  alpha <- PARAMS$alpha
  comparison <- PARAMS$comparison
  value <- num(rows$value)
  unchecked <- rows$state %in% "unselected"
  rated <- rows$state %in% "selected" & !is.na(value)
  used <- (rated | unchecked) & !is.na(rows$sample_code)
  if (!any(used)) warn("no_rows")
  unrated <- sum(rows$state %in% "selected" & is.na(value))
  if (unrated > 0) warn("unrated", n = unrated)
  if (identical(as.integer(CONTEXT$test$rating_min), 0L)) warn("zero_origin")
  score <- ifelse(unchecked, 0, value)
  samples <- sort(unique(rows$sample_code[used]))
  n_assessors <- length(unique(rows$session_id[used]))
  if (n_assessors < 12 && any(used)) warn("few_assessors", n = n_assessors)

  attributes <- list()
  means <- matrix(NA_real_, length(samples), 0, dimnames = list(samples, NULL))
  unbalanced <- FALSE
  for (q in CONTEXT$test$questions) {
    keep <- used & rows$question_id == q$id
    if (!any(keep)) next
    d <- data.frame(value = score[keep], sample = rows$sample_code[keep],
                    assessor = rows$session_id[keep], checked = !unchecked[keep],
                    stringsAsFactors = FALSE)
    if (any(table(d$assessor, d$sample) != 1)) unbalanced <- TRUE
    out <- compare(d, alpha, comparison)
    per_sample <- lapply(samples, function(s) {
      x <- d$value[d$sample == s]
      list(code = s, n = length(x), mean = if (length(x)) mean(x) else NA,
           sd = if (length(x) > 1) stats::sd(x) else NA,
           checked = if (length(x)) mean(d$checked[d$sample == s]) else NA,
           group = if (s %in% names(out$groups)) val(out$groups[[s]]) else NA)
    })
    attributes[[length(attributes) + 1]] <- list(
      question_id = q$id, question = q$text, n_assessors = length(unique(d$assessor)),
      statistic = out$statistic, p_value = out$p_value, samples = per_sample
    )
    column <- vapply(per_sample, function(s) if (is.na(s$mean)) NA_real_ else s$mean, 0)
    means <- cbind(means, matrix(column, ncol = 1, dimnames = list(samples, q$text)))
  }
  if (unbalanced) warn("unbalanced")

  map <- NA
  usable <- means[, colSums(is.na(means)) == 0, drop = FALSE]
  usable <- usable[, apply(usable, 2, stats::var) > 0, drop = FALSE]
  if (nrow(usable) >= 3 && ncol(usable) >= 2) {
    # Unscaled: every attribute is on the same rating scale, so larger differences weigh more.
    pca <- FactoMineR::PCA(as.data.frame(usable), scale.unit = FALSE, graph = FALSE, ncp = 2)
    # With one dimension FactoMineR returns the coordinates as a vector, not a matrix.
    rc <- as.matrix(pca$ind$coord); cc <- as.matrix(pca$var$coord)
    dims <- min(2, ncol(rc), ncol(cc))
    point <- function(coords, i) list(label = rownames(coords)[i], x = coords[i, 1],
                                      y = if (dims > 1) coords[i, 2] else 0)
    map <- list(
      inertia = I(as.numeric(pca$eig[seq_len(dims), 2])),
      samples = lapply(seq_len(nrow(rc)), function(i) point(rc, i)),
      attributes = lapply(seq_len(nrow(cc)), function(i) point(cc, i))
    )
    figure("rata_map.png", function() {
      y_r <- if (dims > 1) rc[, 2] else rep(0, nrow(rc))
      y_c <- if (dims > 1) cc[, 2] else rep(0, nrow(cc))
      graphics::par(mar = c(4, 4, 2, 1))
      graphics::plot(c(rc[, 1], cc[, 1]), c(y_r, y_c), type = "n",
                     xlab = sprintf("Dimension 1 (%.0f %%)", map$inertia[1]),
                     ylab = if (dims > 1) sprintf("Dimension 2 (%.0f %%)", map$inertia[2]) else "",
                     main = "Samples and attributes (PCA of mean ratings)")
      graphics::abline(h = 0, v = 0, col = "grey85")
      graphics::arrows(0, 0, cc[, 1], y_c, length = 0.05, col = "grey60")
      graphics::text(cc[, 1], y_c, rownames(cc), col = "grey35", cex = 0.7, pos = 3)
      graphics::text(rc[, 1], y_r, rownames(rc), font = 2)
    }, width = 1600, height = 1400)
  } else if (any(used)) {
    warn("map_skipped")
  }
  write_result(list(
    recipe = "rata", version = 1L, rows_used = sum(used), rows_left_out = left_out(rows, used),
    alpha = alpha, comparison = comparison, rating_target = val(CONTEXT$test$rating_target),
    rating_min = val(CONTEXT$test$rating_min), n_assessors = n_assessors, samples = I(samples),
    attributes = attributes, map = map
  ))
})
