# cata v1: Cochran's Q per attribute, pairwise exact McNemar tests (Holm), correspondence
# analysis of the citation table (FactoMineR::CA), and, with a liking test, the mean impact of
# each attribute on liking. "unselected" is "not checked", as CATA defines it; skipped is left out.
source(file.path(commandArgs(TRUE)[1], "common.R"))

cochran <- function(m) {
  # m: assessors x samples, 0/1, complete rows only.
  k <- ncol(m); N <- sum(m)
  cols <- colSums(m); blocks <- rowSums(m)
  denominator <- k * N - sum(blocks^2)
  if (k < 2 || nrow(m) < 2 || denominator == 0) return(list(statistic = NA, p = NA))
  q <- (k - 1) * (k * sum(cols^2) - N^2) / denominator
  list(statistic = q, p = stats::pchisq(q, k - 1, lower.tail = FALSE))
}

mcnemar_matrix <- function(m) {
  codes <- colnames(m); k <- length(codes)
  p <- matrix(NA_real_, k, k, dimnames = list(codes, codes))
  if (k < 2) return(p)
  index <- utils::combn(k, 2)
  raw <- apply(index, 2, function(ij) {
    b <- sum(m[, ij[1]] == 1 & m[, ij[2]] == 0)
    c <- sum(m[, ij[1]] == 0 & m[, ij[2]] == 1)
    if (b + c == 0) 1 else stats::binom.test(b, b + c, 0.5)$p.value
  })
  adjusted <- stats::p.adjust(raw, "holm")
  for (column in seq_len(ncol(index))) {
    i <- index[1, column]; j <- index[2, column]
    p[i, j] <- p[j, i] <- adjusted[column]
  }
  p
}

run_recipe(function() {
  rows <- read_rows("rows_main.csv")
  alpha <- PARAMS$alpha
  used <- rows$state %in% c("selected", "unselected") & !is.na(rows$sample_code)
  if (!any(used)) warn("no_rows")
  checked <- as.integer(rows$state == "selected")
  samples <- sort(unique(rows$sample_code[used]))
  n_assessors <- length(unique(rows$session_id[used]))
  if (n_assessors < 12 && any(used)) warn("few_assessors", n = n_assessors)

  liking <- NULL
  liking_q <- PARAMS$liking_question_id
  liking_rows <- read_rows("rows_liking.csv")
  if (!is.null(liking_rows)) {
    if (is.null(liking_q) || is.na(liking_q)) liking_q <- CONTEXT$liking$questions[[1]]$id
    value <- num(liking_rows$value)
    ok <- !is.na(value) & liking_rows$state %in% "rated" & liking_rows$question_id == liking_q &
      !is.na(liking_rows$sample_code)
    liking <- stats::setNames(value[ok], paste(liking_rows$session_id[ok],
                                                liking_rows$sample_code[ok], sep = "\r"))
  }

  attributes <- list()
  citation <- matrix(0L, length(samples), 0, dimnames = list(samples, NULL))
  low_counts <- FALSE
  for (q in CONTEXT$test$questions) {
    keep <- used & rows$question_id == q$id
    if (!any(keep)) next
    wide <- tapply(checked[keep], list(rows$session_id[keep], rows$sample_code[keep]), max)
    wide <- wide[, samples[samples %in% colnames(wide)], drop = FALSE]
    complete <- wide[stats::complete.cases(wide), , drop = FALSE]
    test <- cochran(complete)
    pmatrix <- mcnemar_matrix(complete)
    groups <- if (ncol(complete) >= 2) letters_from(pmatrix, alpha) else
      stats::setNames(rep("a", ncol(complete)), colnames(complete))
    counts <- vapply(samples, function(s) sum(checked[keep & rows$sample_code == s]), 0L)
    answered <- vapply(samples, function(s) sum(keep & rows$sample_code == s), 0L)
    if (sum(counts) < 5) low_counts <- TRUE
    entry <- list(
      question_id = q$id, question = q$text,
      counts = named(as.integer(counts), samples),
      proportions = named(ifelse(answered > 0, counts / answered, 0), samples),
      statistic = val(test$statistic), p_value = val(test$p),
      groups = named(unname(groups[samples[samples %in% names(groups)]]),
                     samples[samples %in% names(groups)]),
      liking_checked = NA, liking_unchecked = NA, impact = NA, impact_p = NA
    )
    if (!is.null(liking)) {
      keys <- paste(rows$session_id[keep], rows$sample_code[keep], sep = "\r")
      l <- unname(liking[keys])
      x <- checked[keep]
      yes <- l[x == 1 & !is.na(l)]; no <- l[x == 0 & !is.na(l)]
      if (length(yes) && length(no)) {
        entry$liking_checked <- mean(yes); entry$liking_unchecked <- mean(no)
        entry$impact <- mean(yes) - mean(no)
        if (length(yes) > 1 && length(no) > 1 && (stats::var(yes) > 0 || stats::var(no) > 0)) {
          entry$impact_p <- stats::t.test(yes, no)$p.value
        }
      }
    }
    attributes[[length(attributes) + 1]] <- entry
    column <- matrix(as.integer(counts), ncol = 1, dimnames = list(samples, q$text))
    citation <- cbind(citation, column)
  }
  if (low_counts) warn("low_counts")
  if (!is.null(liking) && length(liking) == 0) warn("no_liking_match")

  map <- NA
  usable <- citation[, colSums(citation) > 0, drop = FALSE]
  usable <- usable[rowSums(usable) > 0, , drop = FALSE]
  if (nrow(usable) >= 3 && ncol(usable) >= 2) {
    ca <- FactoMineR::CA(as.data.frame(usable), graph = FALSE, ncp = 2)
    # With one dimension FactoMineR returns the coordinates as a vector, not a matrix.
    rc <- as.matrix(ca$row$coord); cc <- as.matrix(ca$col$coord)
    dims <- min(2, ncol(rc), ncol(cc))
    point <- function(coords, i) list(label = rownames(coords)[i], x = coords[i, 1],
                                      y = if (dims > 1) coords[i, 2] else 0)
    map <- list(
      inertia = I(as.numeric(ca$eig[seq_len(dims), 2])),
      samples = lapply(seq_len(nrow(rc)), function(i) point(rc, i)),
      attributes = lapply(seq_len(nrow(cc)), function(i) point(cc, i))
    )
    figure("cata_map.png", function() {
      y_r <- if (dims > 1) rc[, 2] else rep(0, nrow(rc))
      y_c <- if (dims > 1) cc[, 2] else rep(0, nrow(cc))
      graphics::par(mar = c(4, 4, 2, 1))
      graphics::plot(c(rc[, 1], cc[, 1]), c(y_r, y_c), type = "n",
                     xlab = sprintf("Dimension 1 (%.0f %%)", map$inertia[1]),
                     ylab = if (dims > 1) sprintf("Dimension 2 (%.0f %%)", map$inertia[2]) else "",
                     main = "Samples and attributes")
      graphics::abline(h = 0, v = 0, col = "grey85")
      graphics::text(cc[, 1], y_c, rownames(cc), col = "grey35", cex = 0.7)
      graphics::text(rc[, 1], y_r, rownames(rc), font = 2)
    }, width = 1600, height = 1400)
  } else if (any(used)) {
    warn("map_skipped")
  }
  write_result(list(
    recipe = "cata", version = 1L, rows_used = sum(used), rows_left_out = left_out(rows, used),
    alpha = alpha, n_assessors = n_assessors, samples = I(samples), attributes = attributes,
    map = map,
    liking_question = if (is.null(liking)) NA else val(question_text(CONTEXT$liking, liking_q))
  ))
})
