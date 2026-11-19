"""Plain-language reading of a stored result: the answer first, then warnings and how to read it.

The screen, the Excel workbook and the Word report all use these sentences, so they never
disagree. Numbers are rounded for reading; the tables and Details keep full precision.
"""

from __future__ import annotations

METHOD_NAMES = {"triangle": "triangle test", "duo_trio": "duo-trio test", "two_afc": "2-AFC test"}
STATE_WORDS = {
    "skipped": "skipped",
    "missing": "never answered",
    "expected_missing": "never answered",
    "unselected": "not checked",
    "selected": "checked without a rating",
    "rated": "without a matching liking answer",
    "chosen": "without a usable choice",
}


def p_text(p: float | None) -> str:
    if p is None:
        return "p not available"
    return "p < 0.001" if p < 0.001 else f"p = {p:.3f}"


def number(value: float | None, digits: int = 2) -> str:
    return "–" if value is None else f"{value:.{digits}f}"


def percent(value: float | None) -> str:
    return "–" if value is None else f"{value * 100:.0f} %"


def join(words: list[str]) -> str:
    if len(words) <= 1:
        return "".join(words)
    return ", ".join(words[:-1]) + " and " + words[-1]


# --- Answers ----------------------------------------------------------------------------------


def liking(result: dict) -> list[str]:
    sentences = []
    alpha = result["alpha"]
    for q in result["questions"]:
        name = f"“{q['question']}”: " if len(result["questions"]) > 1 and q["question"] else ""
        ranked = sorted(q["samples"], key=lambda s: -s["mean"])
        if q["p_value"] is None:
            sentences.append(name + "The samples could not be compared (too few ratings).")
            continue
        if q["p_value"] >= alpha:
            sentences.append(
                f"{name}Liking did not differ clearly between the samples ({p_text(q['p_value'])}, "
                f"{q['n_assessors']} assessors). Means ranged from {number(ranked[-1]['mean'], 1)} "
                f"to {number(ranked[0]['mean'], 1)}."
            )
            continue
        best = ranked[0]
        beaten = [p for p in q["pairs"] if p["significant"]]
        clear = sorted(
            {
                p["b"] if p["a"] == best["code"] else p["a"]
                for p in beaten
                if best["code"] in (p["a"], p["b"])
            }
        )
        line = (
            f"{name}Liking differed between the samples ({p_text(q['p_value'])}, "
            f"{q['n_assessors']} assessors). {best['code']} was liked most "
            f"(mean {number(best['mean'], 1)})"
        )
        line += f", clearly more than {join(clear)}." if clear else "."
        sentences.append(line)
        sentences.append("Samples that share a letter did not differ clearly.")
    return sentences


def discrimination(result: dict) -> list[str]:
    method = METHOD_NAMES[result["method"]]
    n, k = result["n"], result["correct"]
    p = p_text(result["p_value"])
    conclusion = result["conclusion"]
    if result["task"] == "preference":
        counts = result["counts"] or {}
        ranked = sorted(counts.items(), key=lambda kv: -kv[1])
        split = ", ".join(f"{code}: {count}" for code, count in ranked)
        if conclusion == "preferred":
            return [f"{ranked[0][0]} was preferred ({split} of {n}; {p})."]
        return [f"Neither sample was clearly preferred ({split} of {n}; {p})."]
    d = result["d_prime"] or {}
    effect = f", d′ = {number(d.get('estimate'))}" if d.get("estimate") is not None else ""
    if conclusion == "different":
        return [
            f"Assessors told the samples apart: {k} of {n} correct in the {method} ({p}{effect}).",
            f"About {percent((result['pd'] or {}).get('estimate'))} of assessors could "
            "discriminate.",
        ]
    if conclusion == "not_shown_different":
        return [
            f"This panel did not show that the samples differ: {k} of {n} correct in the {method} "
            f"({p}).",
            "That is not proof that they are the same; use a similarity test for that.",
        ]
    limit = percent(result["pd_limit"])
    if conclusion == "similar":
        return [
            f"The samples are similar enough: {k} of {n} correct, so fewer than {limit} of "
            f"assessors could discriminate ({p})."
        ]
    return [
        f"Similarity was not shown: {k} of {n} correct; more than {limit} of assessors might "
        f"discriminate ({p}). More assessors may be needed."
    ]


def jar(result: dict) -> list[str]:
    threshold = result["threshold"]
    findings = []
    for attribute in result["attributes"]:
        for cell in attribute["samples"]:
            for side, words in (("too_little", "too little"), ("too_much", "too much")):
                share, drop = cell[side], cell["drop_" + side]
                if share >= threshold and drop is not None and drop > 0:
                    findings.append(
                        (
                            cell["penalty_" + side] or 0,
                            attribute["question"],
                            cell,
                            words,
                            share,
                            drop,
                        )
                    )
    if not findings:
        return [
            f"No attribute was off for at least {percent(threshold)} of assessors with a drop in "
            "liking. The samples are close to just about right."
        ]
    findings.sort(key=lambda f: -f[0])
    sentences = []
    for _, question, cell, words, share, drop in findings[:3]:
        sentences.append(
            f"{cell['code']}: “{question}” was {words} for {percent(share)} of assessors, and "
            f"they liked it {number(drop, 1)} points less."
        )
    if len(findings) > 3:
        sentences.append(f"{len(findings) - 3} more penalties are in the table.")
    return sentences


def cata(result: dict) -> list[str]:
    alpha = result["alpha"]
    differing = [
        a for a in result["attributes"] if a["p_value"] is not None and a["p_value"] < alpha
    ]
    total = len(result["attributes"])
    sentences = [
        f"{len(differing)} of {total} attributes were checked differently between the samples "
        f"({result['n_assessors']} assessors)."
    ]
    for attribute in sorted(differing, key=lambda a: a["p_value"])[:3]:
        top = max(attribute["proportions"].items(), key=lambda kv: kv[1])
        sentences.append(
            f"“{attribute['question']}” was checked most for {top[0]} ({percent(top[1])}; "
            f"{p_text(attribute['p_value'])})."
        )
    impacts = [
        a for a in result["attributes"] if a.get("impact_p") is not None and a["impact_p"] < alpha
    ]
    if impacts:
        best = max(impacts, key=lambda a: a["impact"])
        worst = min(impacts, key=lambda a: a["impact"])
        if best["impact"] > 0:
            sentences.append(
                f"Liking was {number(best['impact'], 1)} points higher when “{best['question']}” "
                "was checked."
            )
        if worst["impact"] < 0:
            sentences.append(
                f"Liking was {number(-worst['impact'], 1)} points lower when "
                f"“{worst['question']}” was checked."
            )
    return sentences


def rata(result: dict) -> list[str]:
    alpha = result["alpha"]
    differing = [
        a for a in result["attributes"] if a["p_value"] is not None and a["p_value"] < alpha
    ]
    sentences = [
        f"{len(differing)} of {len(result['attributes'])} attributes were rated differently "
        f"between the samples ({result['n_assessors']} assessors)."
    ]
    for attribute in sorted(differing, key=lambda a: a["p_value"])[:3]:
        rated = [s for s in attribute["samples"] if s["mean"] is not None]
        top = max(rated, key=lambda s: s["mean"])
        low = min(rated, key=lambda s: s["mean"])
        sentences.append(
            f"“{attribute['question']}” was strongest in {top['code']} (mean "
            f"{number(top['mean'], 1)}) and weakest in {low['code']} ({number(low['mean'], 1)}; "
            f"{p_text(attribute['p_value'])})."
        )
    if len(differing) > 3:
        sentences.append(f"{len(differing) - 3} more differing attributes are in the table.")
    if differing:
        sentences.append("Within an attribute, samples that share a letter did not differ clearly.")
    return sentences


ANSWERS = {
    "liking-anova": liking,
    "discrimination": discrimination,
    "jar-penalty": jar,
    "cata": cata,
    "rata": rata,
}


# --- Warnings and explanations ------------------------------------------------------------------

WARNINGS = {
    "few_assessors": "Only {n} assessors: results are uncertain; 12 or more is usual.",
    "unbalanced": (
        "Not every assessor rated every sample; the comparison uses the ratings there are."
    ),
    "single_sample": "Only one sample has ratings, so there is nothing to compare.",
    "no_rows": "There are no answers for this test in the frozen data.",
    "few_answers": "Only {n} answers: the test has little power.",
    "low_counts": "Some attributes were checked fewer than 5 times; their tests are unreliable.",
    "map_skipped": "The map needs at least 3 samples and 2 checked attributes.",
    "no_liking_match": (
        "Liking could not be matched to these answers (no shared assessors and samples)."
    ),
    "zero_variance": "Every rating was the same, so there is no variation to test.",
    "unrated": "{n} checked attributes had no rating and were left out.",
    "zero_origin": (
        "The rating scale starts at 0, so an unchecked attribute and the lowest rating both "
        "count as 0."
    ),
}


def warnings(result: dict) -> list[str]:
    lines = []
    for warning in result.get("warnings", []):
        template = WARNINGS.get(warning["code"], warning["code"])
        try:
            lines.append(template.format(**warning.get("detail", {})))
        except (KeyError, IndexError):
            lines.append(template)
    left = {k: v for k, v in result.get("rows_left_out", {}).items() if v}
    if left:
        parts = [
            f"{count} {STATE_WORDS.get(state, state)}" for state, count in sorted(left.items())
        ]
        lines.append("Left out: " + ", ".join(parts) + ".")
    return lines


EXPLANATIONS = {
    "liking-anova": [
        "The analysis asks whether average liking differs between samples more than chance would "
        "explain, after allowing for assessors who use the scale differently (two-way ANOVA: "
        "sample and assessor).",
        "p is the chance of seeing differences this large if the samples were really liked "
        "equally. Below the chosen level (usually 0.05) the difference is called significant.",
        "Letters: samples that share a letter did not differ significantly in the pairwise "
        "comparison (Tukey HSD, Fisher LSD, or Friedman's rank test).",
        "The bars show 95 % confidence intervals of each mean.",
    ],
    "discrimination": [
        "The test counts how many assessors picked the right answer, compared with what guessing "
        "alone would give (1 in 3 for a triangle, 1 in 2 for duo-trio and 2-AFC).",
        "Proportion of discriminators (pd): the share of assessors who really perceive the "
        "difference, after allowing for lucky guesses.",
        "d′ (d-prime) is the size of the sensory difference on a scale that does not depend on the "
        "test method; about 1 is small, 2 or more is large.",
        "A difference test can show that samples differ, never that they are the same. A "
        "similarity test shows that at most a chosen share of assessors could tell them apart.",
    ],
    "jar-penalty": [
        "For each attribute the share of assessors who found a sample too little, just about "
        "right, or too much is counted.",
        "Mean drop: how much less those assessors liked the sample than assessors who found it "
        "just about right. Penalty = mean drop × share.",
        "Attributes that are off for at least the chosen share of assessors (usually 20 %) and "
        "carry a large drop are the ones worth changing first.",
    ],
    "cata": [
        "Cochran's Q tests, for each attribute, whether it was checked more often for some samples "
        "than others. Samples sharing a letter did not differ (pairwise McNemar tests, "
        "Holm-adjusted).",
        "The map (correspondence analysis) places samples near the attributes checked most for "
        "them; samples close together were described alike.",
        "With a liking test, impact is how much higher (or lower) liking was when the attribute "
        "was checked than when it was not.",
    ],
    "rata": [
        "An attribute an assessor did not check counts as 0, below the lowest rating, so each "
        "mean combines how often the attribute applied and how strongly (Meyners, Jaeger and "
        "Ares, 2016).",
        "For each attribute, a two-way ANOVA (sample and assessor) asks whether the samples "
        "differ more than chance would explain. Samples sharing a letter did not differ in the "
        "pairwise comparison (Tukey HSD or Fisher LSD).",
        "Checked is the share of assessors who found the attribute applied to the sample.",
        "The map (principal component analysis of the mean ratings) places samples near the "
        "attributes rated highest for them; samples close together were described alike.",
    ],
}


def present(recipe: str, result: dict) -> dict:
    return {
        "answer": ANSWERS[recipe](result),
        "warnings": warnings(result),
        "how_to_read": EXPLANATIONS[recipe],
    }
