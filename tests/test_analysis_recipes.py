"""The R recipes against values computed independently here.

Runs only where the analysis add-on is installed (CI installs it from the lock); skipped otherwise.
"""

import csv
import io
import json
import math
from statistics import mean

import pytest

from sensibilia.analysis import power, runner
from sensibilia.analysis.registry import RECIPES
from sensibilia.analysis_setup import runtime_directory, status
from sensibilia.export_service import R_COLUMNS

pytestmark = pytest.mark.skipif(
    status()["state"] != "ready", reason="analysis add-on (R) not installed"
)


def rows_csv(rows):
    out = io.StringIO(newline="")
    writer = csv.DictWriter(out, fieldnames=R_COLUMNS, lineterminator="\n")
    writer.writeheader()
    for row in rows:
        writer.writerow({k: row.get(k) for k in R_COLUMNS})
    return out.getvalue().encode()


def run(recipe, settings, context, main, liking=None):
    files = {
        "rows_main.csv": rows_csv(main),
        "params.json": json.dumps(settings).encode(),
        "context.json": json.dumps(context).encode(),
    }
    if liking is not None:
        files["rows_liking.csv"] = rows_csv(liking)
    result, figures = runner.run(RECIPES[recipe], files, runtime_directory())
    return RECIPES[recipe].result.model_validate(result).model_dump(mode="json"), figures


RATINGS = {  # assessor: {sample: rating}
    "s1": {"A": 7, "B": 5, "C": 3},
    "s2": {"A": 8, "B": 6, "C": 4},
    "s3": {"A": 6, "B": 6, "C": 2},
    "s4": {"A": 9, "B": 5, "C": 3},
    "s5": {"A": 7, "B": 4, "C": 5},
}


def hedonic_rows(question="overall"):
    return [
        {"session_id": s, "question_id": question, "sample_code": code, "state": "rated",
         "value": rating, "row_kind": "answer"}
        for s, ratings in RATINGS.items()
        for code, rating in ratings.items()
    ]  # fmt: skip


HEDONIC_CONTEXT = {
    "test": {"kind": "hedonic", "questions": [{"id": "overall", "text": "Overall liking"}],
             "samples": ["A", "B", "C"]},
    "samples": ["A", "B", "C"],
}  # fmt: skip


def two_way_anova():
    samples, sessions = ["A", "B", "C"], list(RATINGS)
    values = [RATINGS[s][c] for s in sessions for c in samples]
    grand = mean(values)
    ss_sample = len(sessions) * sum(
        (mean(RATINGS[s][c] for s in sessions) - grand) ** 2 for c in samples
    )
    ss_assessor = len(samples) * sum((mean(RATINGS[s].values()) - grand) ** 2 for s in sessions)
    ss_total = sum((v - grand) ** 2 for v in values)
    ss_error = ss_total - ss_sample - ss_assessor
    df_error = (len(samples) - 1) * (len(sessions) - 1)
    f = (ss_sample / 2) / (ss_error / df_error)
    return f, ss_error / df_error, df_error


def test_liking_anova_matches_hand_computed_anova_and_letters():
    result, figures = run("liking-anova", {"alpha": 0.05, "comparison": "tukey"}, HEDONIC_CONTEXT,
                          hedonic_rows() + [{"session_id": "s6", "question_id": "overall",
                                             "sample_code": "A", "state": "skipped"}])  # fmt: skip
    q = result["questions"][0]
    f, mse, df = two_way_anova()
    assert q["statistic"] == pytest.approx(f, rel=1e-9)
    assert q["table"][0]["term"] == "Sample" and q["table"][-1]["df"] == df
    assert {s["code"]: s["mean"] for s in q["samples"]} == {"A": 7.4, "B": 5.2, "C": 3.4}
    groups = {s["code"]: s["group"] for s in q["samples"]}
    assert groups["A"] != groups["C"]
    assert result["rows_left_out"] == {"skipped": 1} and result["rows_used"] == 15
    assert list(figures) == ["liking_01.png"]
    # Fisher LSD p-value for A vs C from the same MSE.
    lsd, _ = run(
        "liking-anova", {"alpha": 0.05, "comparison": "lsd"}, HEDONIC_CONTEXT, hedonic_rows()
    )
    pair = next(p for p in lsd["questions"][0]["pairs"] if {p["a"], p["b"]} == {"A", "C"})
    t = 4.0 / math.sqrt(mse * 2 / 5)
    assert pair["significant"] and pair["p_value"] < 0.001 and t > 5
    friedman, _ = run("liking-anova", {"alpha": 0.05, "comparison": "friedman"}, HEDONIC_CONTEXT,
                      hedonic_rows())  # fmt: skip
    assert friedman["questions"][0]["test_name"] == "Friedman"
    assert friedman["questions"][0]["p_value"] < 0.05


def discrimination_rows(correct, total):
    return [
        {"session_id": f"s{i}", "question_id": "choice", "state": "chosen",
         "correct": "TRUE" if i < correct else "FALSE", "selected_code": "317"}
        for i in range(total)
    ]  # fmt: skip


def test_triangle_matches_exact_binomial_and_python_d_prime():
    context = {"test": {"kind": "triangle", "questions": [], "samples": ["317", "318"]},
               "samples": ["317", "318"]}  # fmt: skip
    result, _ = run("discrimination", {"alpha": 0.05, "purpose": "difference", "pd_limit": 0.3},
                    context, discrimination_rows(17, 30))  # fmt: skip
    expected_p = power.upper_tails(30, 1 / 3)[17]
    assert result["p_value"] == pytest.approx(expected_p, rel=1e-6)
    assert result["d_prime"]["estimate"] == pytest.approx(
        power.d_prime_from_pc("triangle", 17 / 30), abs=1e-3
    )
    assert result["conclusion"] == "different"
    similar, _ = run("discrimination", {"alpha": 0.05, "purpose": "similarity", "pd_limit": 0.3},
                     context, discrimination_rows(9, 60))  # fmt: skip
    assert similar["conclusion"] == "similar"


def test_cata_cochran_q_matches_hand_computation():
    checks = {  # attribute "sweet": assessor -> samples checked
        "s1": {"A"},
        "s2": {"A", "B"},
        "s3": {"A"},
        "s4": {"A", "C"},
        "s5": {"A"},
        "s6": {"B"},
    }
    rows = [
        {"session_id": s, "question_id": "sweet", "sample_code": code,
         "state": "selected" if code in chosen else "unselected"}
        for s, chosen in checks.items() for code in "ABC"
    ] + [
        {"session_id": s, "question_id": "bitter", "sample_code": code,
         "state": "selected" if (code == "C") == (i % 2 == 0) else "unselected"}
        for i, s in enumerate(checks) for code in "ABC"
    ]  # fmt: skip
    context = {"test": {"kind": "cata", "questions": [{"id": "sweet", "text": "Sweet"},
                                                      {"id": "bitter", "text": "Bitter"}],
                        "samples": ["A", "B", "C"]}, "samples": ["A", "B", "C"]}  # fmt: skip
    result, _ = run("cata", {"alpha": 0.05}, context, rows)
    sweet = result["attributes"][0]
    k, columns = 3, [sum(c in v for v in checks.values()) for c in "ABC"]
    blocks = [len(v) for v in checks.values()]
    n = sum(columns)
    q = (k - 1) * (k * sum(c * c for c in columns) - n * n) / (k * n - sum(b * b for b in blocks))
    assert sweet["statistic"] == pytest.approx(q)
    assert sweet["counts"] == {"A": 5, "B": 2, "C": 1}
    assert result["map"] is not None and len(result["map"]["samples"]) == 3


def test_jar_penalty_matches_hand_computed_drops():
    jar = {"s1": 1, "s2": 3, "s3": 3, "s4": 5, "s5": 3, "s6": 1}
    liking = {"s1": 4, "s2": 8, "s3": 7, "s4": 5, "s5": 9, "s6": 3}
    rows = [{"session_id": s, "question_id": "salt", "sample_code": "A", "state": "rated",
             "value": v} for s, v in jar.items()]  # fmt: skip
    liking_rows = [{"session_id": s, "question_id": "overall", "sample_code": "A",
                    "state": "rated", "value": v} for s, v in liking.items()]  # fmt: skip
    context = {
        "test": {"kind": "jar", "questions": [{"id": "salt", "text": "Saltiness"}],
                 "samples": ["A"], "scale_labels": ["a", "b", "c", "d", "e"]},
        "liking": {"questions": [{"id": "overall", "text": "Overall liking"}]},
        "samples": ["A"],
    }  # fmt: skip
    result, _ = run("jar-penalty", {"threshold": 0.2, "alpha": 0.05, "liking_test_id": "x"},
                    context, rows, liking_rows)  # fmt: skip
    cell = result["attributes"][0]["samples"][0]
    assert cell["too_little"] == pytest.approx(2 / 6) and cell["too_much"] == pytest.approx(1 / 6)
    assert cell["liking_just_right"] == pytest.approx(8)
    assert cell["drop_too_little"] == pytest.approx(8 - 3.5)
    assert cell["penalty_too_little"] == pytest.approx((8 - 3.5) * 2 / 6)
    assert result["liking_question"] == "Overall liking"


def anova_f(scores):
    """Two-way ANOVA F for samples, blocked by assessor: {assessor: {sample: score}}."""
    sessions, samples = list(scores), sorted(next(iter(scores.values())))
    values = [scores[s][c] for s in sessions for c in samples]
    grand = mean(values)
    ss_sample = len(sessions) * sum(
        (mean(scores[s][c] for s in sessions) - grand) ** 2 for c in samples
    )
    ss_assessor = len(samples) * sum((mean(scores[s].values()) - grand) ** 2 for s in sessions)
    ss_error = sum((v - grand) ** 2 for v in values) - ss_sample - ss_assessor
    df_error = (len(samples) - 1) * (len(sessions) - 1)
    return (ss_sample / (len(samples) - 1)) / (ss_error / df_error)


def test_rata_scores_unchecked_as_zero_and_matches_hand_computed_anova():
    sweet = {  # assessor: {sample: rating, None = not checked}
        "s1": {"A": 4, "B": 2, "C": None},
        "s2": {"A": 5, "B": None, "C": 1},
        "s3": {"A": 3, "B": 2, "C": None},
        "s4": {"A": 5, "B": 3, "C": 2},
        "s5": {"A": 4, "B": None, "C": None},
    }
    rows = [
        {"session_id": s, "question_id": "sweet", "sample_code": code,
         "state": "unselected" if rating is None else "selected", "value": rating}
        for s, ratings in sweet.items() for code, rating in ratings.items()
    ] + [
        {"session_id": s, "question_id": "bitter", "sample_code": code,
         "state": "selected", "value": 1 + (i + j) % 3}
        for i, s in enumerate(sweet) for j, code in enumerate("ABC")
    ] + [  # checked without a rating: left out, never scored
        {"session_id": "s6", "question_id": "bitter", "sample_code": "A", "state": "selected"},
        {"session_id": "s6", "question_id": "sweet", "sample_code": "A", "state": "skipped"},
    ]  # fmt: skip
    context = {"test": {"kind": "rata", "questions": [{"id": "sweet", "text": "Sweet"},
                                                      {"id": "bitter", "text": "Bitter"}],
                        "samples": ["A", "B", "C"], "rating_min": 1,
                        "rating_target": "intensity"},
               "samples": ["A", "B", "C"]}  # fmt: skip
    result, figures = run("rata", {"alpha": 0.05, "comparison": "tukey"}, context, rows)
    scores = {s: {c: r or 0 for c, r in v.items()} for s, v in sweet.items()}
    attribute = result["attributes"][0]
    assert attribute["statistic"] == pytest.approx(anova_f(scores), rel=1e-9)
    by_code = {s["code"]: s for s in attribute["samples"]}
    assert by_code["A"]["mean"] == pytest.approx(4.2) and by_code["C"]["mean"] == pytest.approx(0.6)
    assert by_code["B"]["checked"] == pytest.approx(3 / 5)
    assert by_code["A"]["group"] != by_code["C"]["group"]
    assert result["rows_left_out"] == {"selected": 1, "skipped": 1}
    assert [w["code"] for w in result["warnings"]][:1] == ["unrated"]
    assert result["n_assessors"] == 5 and result["rows_used"] == 30
    assert result["map"] is not None and len(result["map"]["samples"]) == 3
    assert list(figures) == ["rata_map.png"]
    lsd, _ = run("rata", {"alpha": 0.05, "comparison": "lsd"}, context, rows)
    assert lsd["attributes"][0]["statistic"] == pytest.approx(attribute["statistic"])
    zero = context | {"test": context["test"] | {"rating_min": 0}}
    origin, _ = run("rata", {"alpha": 0.05, "comparison": "tukey"}, zero, rows)
    assert "zero_origin" in [w["code"] for w in origin["warnings"]]
