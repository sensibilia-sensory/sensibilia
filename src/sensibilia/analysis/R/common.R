# Shared helpers for Sensibilia analysis recipes.
# A recipe is run as: Rscript --vanilla recipe.R <input folder> <output folder>
# Input: rows_*.csv (R-ready rows), params.json, context.json.
# Output: result.json, optional PNG figures, or problem.txt with a sentence for people.

ARGS <- commandArgs(TRUE)
INPUT <- ARGS[1]
OUTPUT <- ARGS[2]
WARNINGS <- list()

suppressPackageStartupMessages(library(jsonlite))

problem <- function(message) {
  writeLines(enc2utf8(message), file.path(OUTPUT, "problem.txt"), useBytes = TRUE)
  quit(save = "no", status = 2)
}

read_rows <- function(name) {
  path <- file.path(INPUT, name)
  if (!file.exists(path)) return(NULL)
  rows <- utils::read.csv(path, colClasses = "character", na.strings = "",
                          encoding = "UTF-8", check.names = FALSE)
  rows
}

PARAMS <- fromJSON(file.path(INPUT, "params.json"), simplifyVector = TRUE)
CONTEXT <- fromJSON(file.path(INPUT, "context.json"), simplifyVector = FALSE)

num <- function(x) suppressWarnings(as.numeric(x))

# NULL, NaN and infinite values become JSON null.
val <- function(x) {
  if (is.null(x) || length(x) == 0) return(NA)
  x <- x[[1]]
  if (is.numeric(x) && !is.finite(x)) return(NA)
  x
}

warn <- function(code, ...) {
  detail <- list(...)
  if (length(detail) == 0) detail <- structure(list(), names = character(0))
  WARNINGS[[length(WARNINGS) + 1]] <<- list(code = code, detail = detail)
}

# Counts by state of rows a recipe did not use, so missing, skipped and unselected stay apart.
left_out <- function(rows, used) {
  if (is.null(rows) || nrow(rows) == 0 || all(used)) {
    return(structure(list(), names = character(0)))
  }
  states <- rows$state[!used]
  states[is.na(states)] <- "null"
  counts <- table(states)
  as.list(stats::setNames(as.integer(counts), names(counts)))
}

empty_object <- function() structure(list(), names = character(0))

named <- function(values, names) {
  if (length(values) == 0) return(empty_object())
  stats::setNames(as.list(values), names)
}

question_text <- function(test, id) {
  for (q in test$questions) if (identical(q$id, id)) return(q$text)
  NA
}

# Compact letter display from a symmetric matrix of p-values (multcompView, via FactoMineR).
letters_from <- function(pmatrix, alpha) {
  levels <- rownames(pmatrix)
  if (length(levels) < 2) return(stats::setNames(rep("a", length(levels)), levels))
  pmatrix[is.na(pmatrix)] <- 1
  diag(pmatrix) <- 1
  out <- multcompView::multcompLetters(pmatrix, compare = "<", threshold = alpha)$Letters
  out[levels]
}

write_result <- function(result) {
  result$warnings <- WARNINGS
  text <- toJSON(result, auto_unbox = TRUE, null = "null", na = "null", digits = NA)
  writeLines(enc2utf8(as.character(text)), file.path(OUTPUT, "result.json"), useBytes = TRUE)
}

figure <- function(name, draw, width = 1600, height = 1000) {
  grDevices::png(file.path(OUTPUT, name), width = width, height = height, res = 200,
                 type = if (.Platform$OS.type == "windows") "windows" else "cairo")
  tryCatch(draw(), finally = grDevices::dev.off())
}

run_recipe <- function(main) {
  tryCatch(main(), error = function(e) {
    problem(paste("The analysis could not be completed:", conditionMessage(e)))
  })
}
