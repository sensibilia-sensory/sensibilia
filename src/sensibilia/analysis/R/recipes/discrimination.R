# discrimination v1: triangle, duo-trio and 2-AFC tests (sensR::discrim, exact binomial).
# A 2-AFC preference task has no correct answer: a two-sided binomial test of the choices.
source(file.path(commandArgs(TRUE)[1], "common.R"))

interval <- function(coefficients, row) {
  if (is.null(coefficients) || !(row %in% rownames(coefficients))) return(NA)
  list(estimate = val(coefficients[row, "Estimate"]), low = val(coefficients[row, "Lower"]),
       high = val(coefficients[row, "Upper"]))
}

run_recipe(function() {
  rows <- read_rows("rows_main.csv")
  test <- CONTEXT$test
  alpha <- PARAMS$alpha
  kind <- test$kind
  guessing <- if (kind == "triangle") 1 / 3 else 1 / 2
  method <- c(triangle = "triangle", duo_trio = "duotrio", two_afc = "twoAFC")[[kind]]
  preference <- identical(kind, "two_afc") && identical(test$task, "preference")
  result <- list(recipe = "discrimination", version = 1L, method = kind, alpha = alpha,
                 guessing = guessing, pc = NA, pd = NA, d_prime = NA, pd_limit = NA,
                 counts = NA, correct = NA, p_value = NA)
  if (preference) {
    used <- !is.na(rows$selected_code) & rows$state %in% "chosen"
    choices <- rows$selected_code[used]
    codes <- unlist(test$samples)
    counts <- vapply(codes, function(code) sum(choices == code), 0L)
    n <- sum(counts)
    result$task <- "preference"
    result$counts <- named(as.integer(counts), codes)
    result$n <- n
    if (n > 0) result$p_value <- stats::binom.test(max(counts), n, 0.5)$p.value
    result$conclusion <- if (isTRUE(result$p_value < alpha)) "preferred" else "no_preference"
  } else {
    used <- !is.na(rows$correct) & rows$state %in% "chosen"
    n <- sum(used)
    correct <- sum(rows$correct[used] == "TRUE")
    purpose <- PARAMS$purpose
    result$task <- purpose
    result$n <- n
    result$correct <- correct
    if (n > 0) {
      fit <- if (purpose == "similarity") {
        result$pd_limit <- PARAMS$pd_limit
        sensR::discrim(correct, n, method = method, test = "similarity", pd0 = PARAMS$pd_limit,
                       conf.level = 1 - alpha, statistic = "exact")
      } else {
        sensR::discrim(correct, n, method = method, test = "difference",
                       conf.level = 1 - alpha, statistic = "exact")
      }
      coefficients <- fit$coefficients
      result$p_value <- val(fit$p.value)
      result$pc <- interval(coefficients, "pc")
      result$pd <- interval(coefficients, "pd")
      result$d_prime <- interval(coefficients, "d-prime")
    }
    significant <- isTRUE(result$p_value < alpha)
    result$conclusion <- if (purpose == "similarity") {
      if (significant) "similar" else "not_shown_similar"
    } else {
      if (significant) "different" else "not_shown_different"
    }
    figure("discrimination.png", function() {
      graphics::par(mar = c(4, 4, 2, 1))
      heights <- c(Correct = correct, `Expected by guessing` = n * guessing)
      graphics::barplot(heights, col = c("grey40", "grey80"), border = NA,
                        ylim = c(0, max(n, 1)), ylab = "Assessors",
                        main = sprintf("%d of %d correct", correct, n))
    })
  }
  if (n == 0) warn("no_rows") else if (n < 18) warn("few_answers", n = n)
  result$rows_used <- sum(used)
  result$rows_left_out <- left_out(rows, used)
  write_result(result)
})
