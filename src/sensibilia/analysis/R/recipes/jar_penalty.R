# jar-penalty v1: penalty analysis of JAR answers against liking of the same sample.
# Categories below the centre are "too little", above it "too much". Mean drop = liking of
# just-about-right minus liking of the group; penalty = drop x share; Welch t-test of the drop.
source(file.path(commandArgs(TRUE)[1], "common.R"))

t_p <- function(a, b) {
  if (length(a) < 2 || length(b) < 2 || (stats::var(a) == 0 && stats::var(b) == 0)) return(NA)
  stats::t.test(a, b)$p.value
}

run_recipe(function() {
  rows <- read_rows("rows_main.csv")
  liking_rows <- read_rows("rows_liking.csv")
  if (is.null(liking_rows)) problem("Penalty analysis needs a liking test in the same version.")
  threshold <- PARAMS$threshold
  alpha <- PARAMS$alpha
  liking_q <- PARAMS$liking_question_id
  if (is.null(liking_q) || is.na(liking_q)) liking_q <- CONTEXT$liking$questions[[1]]$id
  k <- length(CONTEXT$test$scale_labels)
  centre <- (k + 1) / 2
  rating <- num(rows$value)
  used <- !is.na(rating) & rows$state %in% "rated" & !is.na(rows$sample_code)
  liking_value <- num(liking_rows$value)
  liking_ok <- !is.na(liking_value) & liking_rows$state %in% "rated" &
    liking_rows$question_id == liking_q & !is.na(liking_rows$sample_code)
  key <- function(session, sample) paste(session, sample, sep = "\r")
  liking <- stats::setNames(
    liking_value[liking_ok],
    key(liking_rows$session_id[liking_ok], liking_rows$sample_code[liking_ok])
  )
  matched <- used & key(rows$session_id, rows$sample_code) %in% names(liking)
  if (any(used) && !any(matched)) warn("no_liking_match")
  if (!any(used)) warn("no_rows")
  attributes <- list()
  for (q in CONTEXT$test$questions) {
    cells <- list()
    keep <- matched & rows$question_id == q$id
    for (code in sort(unique(rows$sample_code[keep]))) {
      here <- keep & rows$sample_code == code
      r <- rating[here]
      l <- unname(liking[key(rows$session_id[here], rows$sample_code[here])])
      n <- length(r)
      little <- l[r < centre]; right <- l[r == centre]; much <- l[r > centre]
      jar_mean <- if (length(right)) mean(right) else NA
      drop <- function(group) if (length(group) && !is.na(jar_mean)) jar_mean - mean(group) else NA
      d_little <- drop(little); d_much <- drop(much)
      cells[[length(cells) + 1]] <- list(
        code = code, n = n,
        too_little = length(little) / n, just_right = length(right) / n,
        too_much = length(much) / n, liking_just_right = val(jar_mean),
        drop_too_little = val(d_little), drop_too_much = val(d_much),
        penalty_too_little = val(d_little * length(little) / n),
        penalty_too_much = val(d_much * length(much) / n),
        p_too_little = val(t_p(right, little)), p_too_much = val(t_p(right, much))
      )
    }
    if (length(cells)) {
      n_assessors <- length(unique(rows$session_id[keep]))
      if (n_assessors < 12) warn("few_assessors", n = n_assessors)
      attributes[[length(attributes) + 1]] <- list(question_id = q$id, question = q$text,
                                                   samples = cells)
    }
  }
  if (length(attributes)) {
    figure("penalty.png", function() {
      share <- c(); drops <- c(); labels <- c()
      for (a in attributes) for (cell in a$samples) {
        for (side in c("too_little", "too_much")) {
          d <- cell[[paste0("drop_", side)]]
          if (!is.na(d)) {
            share <- c(share, cell[[side]]); drops <- c(drops, d)
            labels <- c(labels, sprintf("%s %s (%s)", a$question,
                                        if (side == "too_little") "-" else "+", cell$code))
          }
        }
      }
      graphics::par(mar = c(4, 4, 2, 1))
      graphics::plot(share * 100, drops, pch = 19, xlim = c(0, 100),
                     xlab = "Assessors (%)", ylab = "Mean drop in liking",
                     main = "Penalty analysis")
      graphics::abline(v = threshold * 100, lty = 2)
      if (length(share)) graphics::text(share * 100, drops, labels, pos = 3, cex = 0.6)
    })
  }
  write_result(list(
    recipe = "jar-penalty", version = 1L, rows_used = sum(matched),
    rows_left_out = left_out(rows, matched), threshold = threshold, alpha = alpha,
    liking_question = val(question_text(CONTEXT$liking, liking_q)), attributes = attributes
  ))
})
