from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictInt, model_validator

HEDONIC_ID = "hedonic-9-v1"
METHOD_SOURCE = (
    "https://www.sensorysociety.org/knowledge/sspwiki/Pages/The%209-point%20Hedonic%20Scale.aspx"
)
DEFAULT_LABELS = [
    "Dislike extremely",
    "Dislike very much",
    "Dislike moderately",
    "Dislike slightly",
    "Neither like nor dislike",
    "Like slightly",
    "Like moderately",
    "Like very much",
    "Like extremely",
]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Question(StrictModel):
    id: str = Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9_-]+$")
    prompt: str = Field(min_length=1, max_length=2000)
    required: bool = True


class HedonicConfiguration(StrictModel):
    instructions: str = Field(min_length=1, max_length=10000)
    questions: list[Question] = Field(min_length=1, max_length=100)
    scale_labels: list[str] = Field(
        default_factory=lambda: DEFAULT_LABELS.copy(), min_length=9, max_length=9
    )
    allow_skips: bool = False

    @model_validator(mode="after")
    def check_configuration(self):
        if len({question.id for question in self.questions}) != len(self.questions):
            raise ValueError("Question IDs must be unique within a test")
        if any(not label.strip() or len(label) > 200 for label in self.scale_labels):
            raise ValueError("Scale labels must contain 1 to 200 characters")
        return self


class HedonicValue(StrictModel):
    state: Literal["rated", "skipped"]
    rating: StrictInt | None = Field(default=None, ge=1, le=9)

    @model_validator(mode="after")
    def check_state(self):
        if self.state == "rated" and self.rating is None:
            raise ValueError("A rated response needs an integer rating from 1 to 9")
        if self.state == "skipped" and self.rating is not None:
            raise ValueError("A skipped response must have a null rating")
        return self


CONFIGURATIONS = {HEDONIC_ID: HedonicConfiguration}


class SampleConfiguration(StrictModel):
    instructions: str = Field(min_length=1, max_length=10000)
    sample_ids: list[UUID] = Field(default_factory=list, max_length=50)

    @model_validator(mode="after")
    def unique_samples(self):
        if len(set(self.sample_ids)) != len(self.sample_ids):
            raise ValueError("Sample IDs must be unique")
        return self


class AttributeConfiguration(SampleConfiguration):
    questions: list[Question] = Field(min_length=1, max_length=100)
    allow_skips: bool = False

    @model_validator(mode="after")
    def unique_questions(self):
        if len({q.id for q in self.questions}) != len(self.questions):
            raise ValueError("Attribute IDs must be unique")
        return self


class CATAConfiguration(AttributeConfiguration):
    kind: Literal["cata"] = "cata"

    @model_validator(mode="after")
    def all_attributes_required(self):
        if any(not q.required for q in self.questions):
            raise ValueError("Record selected or unselected for every CATA/RATA attribute")
        return self


class RATAConfiguration(CATAConfiguration):
    kind: Literal["rata"] = "rata"
    rating_target: Literal["intensity", "applicability"] = "intensity"
    scale_labels: list[str] = Field(min_length=2, max_length=11)
    rating_min: StrictInt = Field(default=1, ge=0, le=1)
    require_ratings: bool = True

    @model_validator(mode="after")
    def labels(self):
        check_labels(self.scale_labels)
        return self


JAR_LABELS = ["Much too little", "Too little", "Just about right", "Too much", "Much too much"]


def check_labels(labels):
    if any(not label.strip() or len(label) > 200 for label in labels):
        raise ValueError("Scale labels must contain 1 to 200 characters")


class JARConfiguration(AttributeConfiguration):
    kind: Literal["jar"] = "jar"
    scale_labels: list[str] = Field(default_factory=lambda: JAR_LABELS.copy())

    @model_validator(mode="after")
    def labels(self):
        if len(self.scale_labels) not in {3, 5, 7}:
            raise ValueError(
                "JAR supports 3, 5 or 7 categories with just-about-right at the centre"
            )
        check_labels(self.scale_labels)
        return self


class TriangleConfiguration(SampleConfiguration):
    kind: Literal["triangle"] = "triangle"
    sample_ids: list[UUID] = Field(min_length=2, max_length=2)
    purpose: Literal["difference", "similarity"] = "difference"


class DuoTrioConfiguration(TriangleConfiguration):
    kind: Literal["duo_trio"] = "duo_trio"
    reference_mode: Literal["balanced", "constant"] = "balanced"
    reference_sample_id: UUID | None = None

    @model_validator(mode="after")
    def reference(self):
        if self.reference_mode == "constant" and self.reference_sample_id not in self.sample_ids:
            raise ValueError("A constant reference must identify one of the two products")
        if self.reference_mode == "balanced" and self.reference_sample_id is not None:
            raise ValueError("Balanced-reference tests must not specify a constant reference")
        return self


class TwoAFCConfiguration(SampleConfiguration):
    """Two-alternative forced choice (paired comparison, ISO 5495)."""

    kind: Literal["two_afc"] = "two_afc"
    sample_ids: list[UUID] = Field(min_length=2, max_length=2)
    task: Literal["directional", "preference"] = "directional"
    question: str = Field(min_length=1, max_length=500)
    expected_sample_id: UUID | None = None

    @model_validator(mode="after")
    def key(self):
        if self.task == "directional" and self.expected_sample_id not in self.sample_ids:
            raise ValueError("A directional test must name which product has more of the attribute")
        if self.task == "preference" and self.expected_sample_id is not None:
            raise ValueError("A preference test has no expected product")
        return self


class FlashConfiguration(SampleConfiguration):
    kind: Literal["flash_profile"] = "flash_profile"
    sample_ids: list[UUID] = Field(min_length=2, max_length=30)
    descriptor_instructions: str = Field(min_length=1, max_length=10000)
    ranking_instructions: str = Field(min_length=1, max_length=10000)
    min_attributes: StrictInt = Field(default=1, ge=1, le=50)
    max_attributes: StrictInt = Field(default=20, ge=1, le=50)
    allow_ties: bool = True
    rank_direction: Literal["increasing_intensity"] = "increasing_intensity"
    rank_encoding: Literal["dense"] = "dense"

    @model_validator(mode="after")
    def limits(self):
        if self.min_attributes > self.max_attributes:
            raise ValueError("Minimum attributes must not exceed maximum attributes")
        return self


class NappingConfiguration(SampleConfiguration):
    kind: Literal["napping"] = "napping"
    sample_ids: list[UUID] = Field(min_length=2, max_length=50)
    canvas_width: Literal[60] = 60
    canvas_height: Literal[40] = 40
    coordinate_units: Literal["cm_equivalent"] = "cm_equivalent"
    collect_descriptions: bool = False


class CATAValue(StrictModel):
    kind: Literal["cata"]
    state: Literal["selected", "unselected", "skipped"]


class RATAValue(StrictModel):
    kind: Literal["rata"]
    state: Literal["selected", "unselected", "skipped"]
    rating: StrictInt | None = None

    @model_validator(mode="after")
    def state_rating(self):
        if self.state != "selected" and self.rating is not None:
            raise ValueError("Only selected RATA attributes can have a rating")
        return self


class JARValue(StrictModel):
    kind: Literal["jar"]
    state: Literal["rated", "skipped"]
    rating: StrictInt | None = Field(default=None, ge=1, le=7)

    @model_validator(mode="after")
    def state_rating(self):
        if (self.state == "rated") != (self.rating is not None):
            raise ValueError("Rated JAR answers need a rating; skips need a null rating")
        return self


class DiscriminationValue(StrictModel):
    kind: Literal["triangle", "duo_trio", "two_afc"]
    state: Literal["chosen"]
    selected_slot_id: Literal["s1", "s2", "s3"]


class RankedAttribute(StrictModel):
    id: str = Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9_-]+$")
    term: str = Field(min_length=1, max_length=500)
    ranks: dict[str, StrictInt] = Field(min_length=2, max_length=30)


class FlashValue(StrictModel):
    kind: Literal["flash_profile"]
    state: Literal["profile"]
    attributes: list[RankedAttribute] = Field(min_length=1, max_length=50)


class MapPoint(StrictModel):
    x: Annotated[float, Field(strict=True, ge=0, le=60, allow_inf_nan=False)]
    y: Annotated[float, Field(strict=True, ge=0, le=40, allow_inf_nan=False)]
    description: str = Field(default="", max_length=2000)


class NappingValue(StrictModel):
    kind: Literal["napping"]
    state: Literal["mapped"]
    points: dict[str, MapPoint] = Field(min_length=2, max_length=50)


class TCATAConfiguration(SampleConfiguration):
    kind: Literal["tcata"] = "tcata"
    attributes: list[Question] = Field(min_length=1, max_length=30)
    start_instruction: str = Field(min_length=1, max_length=2000)
    duration_ms: StrictInt = Field(ge=1000, le=600000)
    required_tolerance_ms: StrictInt = Field(ge=1, le=1000)
    allow_skips: bool = False
    multi_active: Literal[True] = True
    capture: Literal["transitions"] = "transitions"

    @model_validator(mode="after")
    def attributes_valid(self):
        if len({a.id for a in self.attributes}) != len(self.attributes):
            raise ValueError("Attribute IDs must be unique")
        if any(not a.required for a in self.attributes):
            raise ValueError("Every attribute is tracked throughout the run")
        return self


NewConfiguration = Annotated[
    CATAConfiguration
    | RATAConfiguration
    | JARConfiguration
    | TriangleConfiguration
    | DuoTrioConfiguration
    | TwoAFCConfiguration
    | FlashConfiguration
    | NappingConfiguration
    | TCATAConfiguration,
    Field(discriminator="kind"),
]
MethodConfiguration = HedonicConfiguration | NewConfiguration
NewValue = Annotated[
    CATAValue | RATAValue | JARValue | DiscriminationValue | FlashValue | NappingValue,
    Field(discriminator="kind"),
]
MethodValue = HedonicValue | NewValue

CONFIGURATIONS.update(
    {
        "cata-v1": CATAConfiguration,
        "rata-v1": RATAConfiguration,
        "jar-v1": JARConfiguration,
        "triangle-v1": TriangleConfiguration,
        "duo-trio-v1": DuoTrioConfiguration,
        "two-afc-v1": TwoAFCConfiguration,
        "flash-profile-v1": FlashConfiguration,
        "napping-v1": NappingConfiguration,
        "tcata-v1": TCATAConfiguration,
    }
)
VALUES = {
    HEDONIC_ID: HedonicValue,
    "cata-v1": CATAValue,
    "rata-v1": RATAValue,
    "jar-v1": JARValue,
    "triangle-v1": DiscriminationValue,
    "duo-trio-v1": DiscriminationValue,
    "two-afc-v1": DiscriminationValue,
    "flash-profile-v1": FlashValue,
    "napping-v1": NappingValue,
}
METHOD_INFO = {
    "tcata-v1": (
        "tcata",
        "TCATA — Temporal check all that apply",
        "https://doi.org/10.1016/j.foodqual.2015.06.017",
        (
            "Concurrent attribute selection/deselection transitions; "
            "physical timing validation required."
        ),
    ),
    "cata-v1": (
        "cata",
        "CATA — Check all that apply",
        "https://doi.org/10.1016/j.foodqual.2019.103794",
        "Select applicable attributes; unselected is explicit.",
    ),
    "rata-v1": (
        "rata",
        "RATA — Rate all that apply",
        "https://doi.org/10.1016/j.foodqual.2014.03.006",
        "Select attributes and rate intensity or applicability.",
    ),
    "jar-v1": (
        "jar",
        "JAR — Just about right",
        "https://www.sensorysociety.org/knowledge/sspwiki/Pages/Just%20About%20Right%20Scales.aspx",
        "Assess an attribute against its ideal level on 3, 5 or 7 categories.",
    ),
    "triangle-v1": (
        "triangle",
        "Triangle test",
        "https://www.iso.org/standard/76666.html",
        "Choose the different sample from a blinded triad; balanced serving sequences.",
    ),
    "duo-trio-v1": (
        "duo_trio",
        "Duo-trio test",
        "https://www.iso.org/standard/88370.html",
        "Choose the sample matching the reference; balanced or constant reference.",
    ),
    "two-afc-v1": (
        "two_afc",
        "2-AFC — Two-alternative forced choice",
        "https://www.iso.org/standard/31621.html",
        "Choose one of two blinded samples (directional or preference); balanced AB/BA order.",
    ),
    "flash-profile-v1": (
        "flash_profile",
        "Flash profiling",
        "https://doi.org/10.1016/S0950-3293(03)00085-5",
        "Assessors generate their own descriptors and rank the complete product set.",
    ),
    "napping-v1": (
        "napping",
        "Napping — Digital projective mapping",
        "https://doi.org/10.1016/j.foodqual.2005.01.006",
        "Digital adaptation: place similar products closer on a blank 3:2 map.",
    ),
}


def sample_ids(configuration):
    return [str(sample) for sample in getattr(configuration, "sample_ids", [])]


def required_observations(configuration):
    if isinstance(configuration, TCATAConfiguration):
        return {(sample, "temporal") for sample in sample_ids(configuration) or [None]}
    if hasattr(configuration, "questions"):
        return {
            (sample, q.id)
            for sample in sample_ids(configuration) or [None]
            for q in configuration.questions
            if q.required
        }
    question = (
        "profile"
        if isinstance(configuration, FlashConfiguration)
        else "map"
        if isinstance(configuration, NappingConfiguration)
        else "choice"
    )
    return {(None, question)}


def validate_observation(method_id, configuration, question_id, sample_id, value, assignment=None):
    """Validate against the frozen method, product set, and session's private assignment."""
    if method_id == "tcata-v1":
        raise ValueError("TCATA requires the temporal-runs endpoint")
    config = CONFIGURATIONS[method_id].model_validate(configuration)
    parsed = VALUES[method_id].model_validate(value)
    if method_id != HEDONIC_ID and parsed.kind != config.kind:
        raise ValueError("Response kind does not match the assigned method")
    if hasattr(config, "questions"):
        if question_id not in {q.id for q in config.questions}:
            raise ValueError("Question does not exist in the configured test")
        if sample_id not in (sample_ids(config) or [None]):
            raise ValueError("Sample does not belong to this configured test")
        if parsed.state == "skipped" and not config.allow_skips:
            raise ValueError("This configured test does not allow skipping")
        if isinstance(config, RATAConfiguration) and parsed.state == "selected":
            if parsed.rating is None and config.require_ratings:
                raise ValueError("Selected RATA attributes require a rating")
            if (
                parsed.rating is not None
                and not config.rating_min
                <= parsed.rating
                < config.rating_min + len(config.scale_labels)
            ):
                raise ValueError("RATA rating is outside the configured scale")
        if (
            isinstance(config, JARConfiguration)
            and parsed.rating is not None
            and parsed.rating > len(config.scale_labels)
        ):
            raise ValueError("JAR rating is outside the configured scale")
    else:
        if (sample_id, question_id) not in required_observations(config):
            raise ValueError(
                "Set-level methods require their configured response key and null sample_id"
            )
        expected = set(sample_ids(config))
        if isinstance(config, FlashConfiguration):
            attrs = parsed.attributes
            if not config.min_attributes <= len(attrs) <= config.max_attributes:
                raise ValueError("Descriptor count is outside the configured limits")
            if len({a.id for a in attrs}) != len(attrs) or len(
                {a.term.casefold() for a in attrs}
            ) != len(attrs):
                raise ValueError("Descriptor identifiers and terms must be unique")
            for attr in attrs:
                if set(attr.ranks) != expected:
                    raise ValueError("Rank every configured sample for each descriptor")
                ranks = list(attr.ranks.values())
                distinct = set(ranks)
                if distinct != set(range(1, len(distinct) + 1)):
                    raise ValueError("Use consecutive ranks from 1; ties share a rank")
                if not config.allow_ties and len(distinct) != len(ranks):
                    raise ValueError("This Flash profile does not permit tied ranks")
        elif isinstance(config, NappingConfiguration):
            if set(parsed.points) != expected:
                raise ValueError("Place every configured sample on the map")
            if not config.collect_descriptions and any(
                p.description for p in parsed.points.values()
            ):
                raise ValueError("Sample descriptions are not enabled for this map")
        elif not assignment or parsed.selected_slot_id not in {
            s["slot_id"] for s in assignment["samples"]
        }:
            raise ValueError("Choose one of the assigned sample slots")
    return parsed.model_dump(mode="json")
