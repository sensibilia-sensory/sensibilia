"""The recipes the add-on can run: what they apply to, their settings and their result contract.

A recipe is fixed code reviewed with the release. Settings are typed and bounded; nothing a
researcher enters becomes code. A result that does not validate against its model fails the job.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

R_DIRECTORY = Path(__file__).with_name("R")

HEDONIC = "hedonic-9-v1"
DISCRIMINATION = ("triangle-v1", "duo-trio-v1", "two-afc-v1")
JAR = "jar-v1"
CATA = "cata-v1"
RATA = "rata-v1"

Alpha = Literal[0.01, 0.05, 0.1]


class Strict(BaseModel):
    """Unknown fields are refused, in settings and in results, so R and Python cannot drift."""

    model_config = ConfigDict(extra="forbid")


Loose = Strict  # result parts


# --- Settings ---------------------------------------------------------------------------------


class LikingSettings(Strict):
    alpha: Alpha = 0.05
    comparison: Literal["tukey", "lsd", "friedman"] = "tukey"


class DiscriminationSettings(Strict):
    alpha: Alpha = 0.05
    purpose: Literal["difference", "similarity"] = "difference"
    # Largest proportion of discriminators still called "similar" (similarity tests only).
    pd_limit: float = Field(default=0.3, gt=0, lt=1)


class JARSettings(Strict):
    threshold: float = Field(default=0.2, ge=0.05, le=0.5)
    liking_test_id: str
    liking_question_id: str | None = None
    alpha: Alpha = 0.05


class CATASettings(Strict):
    alpha: Alpha = 0.05
    liking_test_id: str | None = None
    liking_question_id: str | None = None


class RATASettings(Strict):
    alpha: Alpha = 0.05
    comparison: Literal["tukey", "lsd"] = "tukey"


# --- Results ----------------------------------------------------------------------------------


class Warning(Loose):
    code: str
    detail: dict[str, str | int | float | None] = Field(default_factory=dict)


class Common(Loose):
    recipe: str
    version: int
    rows_used: int
    rows_left_out: dict[str, int]
    warnings: list[Warning] = Field(default_factory=list)


class SampleMean(Loose):
    code: str
    n: int
    mean: float
    sd: float | None
    ci_low: float | None
    ci_high: float | None
    group: str | None


class Pair(Loose):
    a: str
    b: str
    difference: float
    p_value: float | None
    significant: bool


class AnovaRow(Loose):
    term: str
    df: float
    sum_sq: float | None
    mean_sq: float | None
    statistic: float | None
    p_value: float | None


class LikingQuestion(Loose):
    question_id: str
    question: str | None
    n_assessors: int
    n_ratings: int
    test_name: str
    statistic: float | None
    p_value: float | None
    samples: list[SampleMean]
    pairs: list[Pair]
    table: list[AnovaRow]
    lsd: float | None = None


class LikingResult(Common):
    recipe: Literal["liking-anova"]
    alpha: float
    comparison: str
    questions: list[LikingQuestion]


class Interval(Loose):
    estimate: float | None
    low: float | None
    high: float | None


class DiscriminationResult(Common):
    recipe: Literal["discrimination"]
    method: Literal["triangle", "duo_trio", "two_afc"]
    task: Literal["difference", "similarity", "preference"]
    alpha: float
    n: int
    correct: int | None
    guessing: float
    p_value: float | None
    pc: Interval | None
    pd: Interval | None
    d_prime: Interval | None
    pd_limit: float | None
    counts: dict[str, int] | None = None
    conclusion: Literal[
        "different",
        "not_shown_different",
        "similar",
        "not_shown_similar",
        "preferred",
        "no_preference",
    ]


class JARCell(Loose):
    code: str
    n: int
    too_little: float
    just_right: float
    too_much: float
    liking_just_right: float | None
    drop_too_little: float | None
    drop_too_much: float | None
    penalty_too_little: float | None
    penalty_too_much: float | None
    p_too_little: float | None
    p_too_much: float | None


class JARAttribute(Loose):
    question_id: str
    question: str | None
    samples: list[JARCell]


class JARResult(Common):
    recipe: Literal["jar-penalty"]
    threshold: float
    alpha: float
    liking_question: str | None
    attributes: list[JARAttribute]


class CATAAttribute(Loose):
    question_id: str
    question: str | None
    counts: dict[str, int]
    proportions: dict[str, float]
    statistic: float | None
    p_value: float | None
    groups: dict[str, str]
    liking_checked: float | None = None
    liking_unchecked: float | None = None
    impact: float | None = None
    impact_p: float | None = None


class Point(Loose):
    label: str
    x: float
    y: float


class CATAMap(Loose):
    inertia: list[float]
    samples: list[Point]
    attributes: list[Point]


class CATAResult(Common):
    recipe: Literal["cata"]
    alpha: float
    n_assessors: int
    samples: list[str]
    attributes: list[CATAAttribute]
    map: CATAMap | None
    liking_question: str | None


class RATASample(Loose):
    code: str
    n: int
    mean: float | None
    sd: float | None
    checked: float | None
    group: str | None


class RATAAttribute(Loose):
    question_id: str
    question: str | None
    n_assessors: int
    statistic: float | None
    p_value: float | None
    samples: list[RATASample]


class RATAResult(Common):
    recipe: Literal["rata"]
    alpha: float
    comparison: str
    rating_target: str | None
    rating_min: int | None
    n_assessors: int
    samples: list[str]
    attributes: list[RATAAttribute]
    map: CATAMap | None


AnyResult = Annotated[
    LikingResult | DiscriminationResult | JARResult | CATAResult | RATAResult,
    Field(discriminator="recipe"),
]


class Presentation(Strict):
    answer: list[str]
    warnings: list[str]
    how_to_read: list[str]


# --- Registry ---------------------------------------------------------------------------------


@dataclass(frozen=True)
class Recipe:
    id: str
    version: int
    title: str
    methods: tuple[str, ...]
    settings: type[BaseModel]
    result: type[BaseModel]
    script: str

    @property
    def path(self) -> Path:
        return R_DIRECTORY / "recipes" / self.script

    def sha256(self) -> str:
        """Recipe source plus the shared helpers it sources: what the receipt identifies."""
        digest = hashlib.sha256()
        for path in (R_DIRECTORY / "common.R", self.path):
            digest.update(path.read_bytes())
        return digest.hexdigest()


RECIPES = {
    r.id: r
    for r in (
        Recipe(
            "liking-anova", 1, "Compare liking between samples", (HEDONIC,),
            LikingSettings, LikingResult, "liking_anova.R",
        ),
        Recipe(
            "discrimination", 1, "Can assessors tell the samples apart?", DISCRIMINATION,
            DiscriminationSettings, DiscriminationResult, "discrimination.R",
        ),
        Recipe(
            "jar-penalty", 1, "Which attributes cost liking? (penalty analysis)", (JAR,),
            JARSettings, JARResult, "jar_penalty.R",
        ),
        Recipe(
            "cata", 1, "Which attributes describe each sample?", (CATA,),
            CATASettings, CATAResult, "cata.R",
        ),
        Recipe(
            "rata", 1, "How strongly does each sample show each attribute?", (RATA,),
            RATASettings, RATAResult, "rata.R",
        ),
    )
}  # fmt: skip


def for_method(test_type_id: str) -> list[Recipe]:
    return [r for r in RECIPES.values() if test_type_id in r.methods]
