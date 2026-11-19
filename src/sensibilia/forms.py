"""Bounded study forms: forward routes, survey fields, and implemented sensory tests.

This is a questionnaire contract, not an experimental scripting language. Pure
functions here can also be implemented by an offline renderer without API calls.
"""

from typing import Annotated, Literal

from pydantic import Field, StrictBool, StrictInt, model_validator

from sensibilia.methods import Question, StrictModel

Code = Annotated[str, Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9_-]+$")]
Target = Annotated[str, Field(min_length=1, max_length=100)]
TERMINALS = {"complete", "screen_out"}
RESERVED = TERMINALS | {"next"}


class Option(StrictModel):
    id: Code
    label: str = Field(min_length=1, max_length=500)
    score: StrictInt | None = None


class ChoiceOption(StrictModel):
    id: Code
    label: str = Field(min_length=1, max_length=500)
    exclusive: bool = False


class Condition(StrictModel):
    source_step_id: Code
    option_ids: list[Code] = Field(min_length=1, max_length=100)
    match: Literal["any", "all"] = "any"

    @model_validator(mode="after")
    def unique_options(self):
        if len(set(self.option_ids)) != len(self.option_ids):
            raise ValueError("Condition option identifiers must be unique")
        return self


class Route(StrictModel):
    condition: Condition | None = None
    then: Target = "next"
    otherwise: Target = "next"

    @model_validator(mode="after")
    def unambiguous(self):
        if self.condition is None and self.then != "next":
            raise ValueError("Without a condition, use otherwise for the next destination")
        return self


class StepBase(StrictModel):
    id: Code
    title: str = Field(min_length=1, max_length=250)
    route: Route = Field(default_factory=Route)


class InstructionStep(StepBase):
    kind: Literal["instruction"] = "instruction"
    text: str = Field(min_length=1, max_length=30000)
    acknowledgement_label: str | None = Field(default=None, min_length=1, max_length=500)
    continue_label: str = Field(default="Continue", min_length=1, max_length=100)


class ChoiceStep(StepBase):
    kind: Literal["choice"] = "choice"
    text: str = Field(default="", max_length=30000)
    prompt: str = Field(min_length=1, max_length=2000)
    multiple: bool = False
    options: list[ChoiceOption] = Field(min_length=2, max_length=100)

    @model_validator(mode="after")
    def unique_options(self):
        if len({option.id for option in self.options}) != len(self.options):
            raise ValueError("Choice option identifiers must be unique")
        return self


class MatrixStep(StepBase):
    kind: Literal["matrix"] = "matrix"
    instructions: str = Field(min_length=1, max_length=10000)
    rows: list[Question] = Field(min_length=1, max_length=100)
    scale: list[Option] = Field(min_length=2, max_length=11)
    allow_skips: bool = False

    @model_validator(mode="after")
    def unique_identifiers(self):
        if len({row.id for row in self.rows}) != len(self.rows):
            raise ValueError("Matrix row identifiers must be unique")
        if len({option.id for option in self.scale}) != len(self.scale):
            raise ValueError("Scale option identifiers must be unique")
        return self


class TestStep(StepBase):
    kind: Literal["test"] = "test"
    study_test_id: str = Field(min_length=1, max_length=100)
    layout: Literal["cards", "matrix"] = "cards"


Step = Annotated[InstructionStep | ChoiceStep | MatrixStep | TestStep, Field(discriminator="kind")]


class StudyForm(StrictModel):
    schema_version: Literal[1] = 1
    steps: list[Step] = Field(min_length=1, max_length=100)
    completion_message: str = Field(
        default="Thank you for participating.", min_length=1, max_length=10000
    )
    screen_out_message: str = Field(
        default="Your session has ended. Please contact the researcher.",
        min_length=1,
        max_length=10000,
    )

    @model_validator(mode="after")
    def valid_flow(self):
        ids = [step.id for step in self.steps]
        if len(set(ids)) != len(ids) or set(ids) & RESERVED:
            raise ValueError("Step identifiers must be unique and cannot be reserved destinations")
        positions = {step.id: i for i, step in enumerate(self.steps)}
        # Dominators are the choice steps guaranteed to have been answered on
        # every route to this step. Intersections avoid testing skipped answers.
        incoming: dict[str, list[set[str]]] = {ids[0]: [set()]}
        for i, step in enumerate(self.steps):
            before = set.intersection(*incoming[step.id]) if step.id in incoming else set()
            condition = step.route.condition
            if condition:
                source_index = positions.get(condition.source_step_id)
                source = self.steps[source_index] if source_index is not None else None
                if not isinstance(source, ChoiceStep) or source_index > i:
                    raise ValueError("Routes must use a choice in this step or an earlier step")
                if source.id != step.id and source.id not in before:
                    raise ValueError("A route cannot depend on a choice that may have been skipped")
                if not set(condition.option_ids) <= {option.id for option in source.options}:
                    raise ValueError("Route condition references an unknown choice option")
                if (
                    not source.multiple
                    and condition.match == "all"
                    and len(condition.option_ids) > 1
                ):
                    raise ValueError("A single-choice answer cannot match all of several options")
            after = before | ({step.id} if isinstance(step, ChoiceStep) else set())
            targets = [step.route.otherwise] + ([step.route.then] if condition else [])
            for target in targets:
                resolved = (
                    ids[i + 1]
                    if target == "next" and i + 1 < len(ids)
                    else "complete"
                    if target == "next"
                    else target
                )
                if resolved not in TERMINALS:
                    if resolved not in positions or positions[resolved] <= i:
                        raise ValueError("Routes must point to a later step or end the session")
                    if step.id in incoming:
                        incoming.setdefault(resolved, []).append(after)
        if set(incoming) != set(ids):
            raise ValueError("Every step must be reachable through at least one route")
        refs = [step.study_test_id for step in self.steps if isinstance(step, TestStep)]
        if len(refs) != len(set(refs)):
            raise ValueError("Each configured test may occur only once in a form")
        return self


class ContinueValue(StrictModel):
    state: Literal["continued"] = "continued"
    acknowledged: StrictBool = False


class ChoiceValue(StrictModel):
    state: Literal["answered"] = "answered"
    selected: list[Code] = Field(min_length=1, max_length=100)


class SelectionValue(StrictModel):
    state: Literal["selected", "skipped"]
    option_id: Code | None = None

    @model_validator(mode="after")
    def consistent(self):
        if (self.state == "selected") != (self.option_id is not None):
            raise ValueError("Selected answers need an option; skipped answers must have none")
        return self


class MatrixValue(StrictModel):
    state: Literal["matrix"] = "matrix"
    answers: dict[Code, SelectionValue] = Field(max_length=100)


StepValue = Annotated[ContinueValue | ChoiceValue | MatrixValue, Field(discriminator="state")]


def validate_form_tests(form: StudyForm, test_ids: set[str]):
    refs = {step.study_test_id for step in form.steps if isinstance(step, TestStep)}
    if refs != test_ids:
        raise ValueError("The session flow must include every configured test exactly once")


def validate_value(step: Step, value: ContinueValue | ChoiceValue | MatrixValue) -> dict:
    if isinstance(step, (InstructionStep, TestStep)):
        if not isinstance(value, ContinueValue):
            raise ValueError("This step expects a Continue event")
        if (
            isinstance(step, InstructionStep)
            and step.acknowledgement_label
            and not value.acknowledged
        ):
            raise ValueError("Confirm that you have read and understood the instructions")
    elif isinstance(step, ChoiceStep):
        if not isinstance(value, ChoiceValue):
            raise ValueError("This step expects a choice answer")
        selected = set(value.selected)
        if len(selected) != len(value.selected) or not selected <= {
            option.id for option in step.options
        }:
            raise ValueError("Select unique, configured choice options")
        if not step.multiple and len(selected) != 1:
            raise ValueError("Select exactly one option")
        if len(selected) > 1 and any(
            option.exclusive and option.id in selected for option in step.options
        ):
            raise ValueError("An exclusive option cannot be combined with other answers")
    else:
        if not isinstance(value, MatrixValue):
            raise ValueError("This step expects matrix answers")
        if not set(value.answers) <= {row.id for row in step.rows}:
            raise ValueError("Unknown matrix row")
        for row in step.rows:
            answer = value.answers.get(row.id)
            if row.required and answer is None:
                raise ValueError("Required matrix rows are still unanswered")
            if answer is not None:
                if answer.state == "skipped" and not step.allow_skips:
                    raise ValueError("This matrix does not allow skipping")
                if answer.state == "selected" and answer.option_id not in {
                    option.id for option in step.scale
                }:
                    raise ValueError("Unknown scale option")
    return value.model_dump(mode="json")


def next_destination(form: StudyForm, index: int, values: dict[str, dict]) -> str:
    step = form.steps[index]
    route = step.route
    target = route.otherwise
    if route.condition:
        selected = set(values[route.condition.source_step_id]["selected"])
        expected = set(route.condition.option_ids)
        matches = (
            bool(selected & expected) if route.condition.match == "any" else expected <= selected
        )
        target = route.then if matches else route.otherwise
    if target == "next":
        return form.steps[index + 1].id if index + 1 < len(form.steps) else "complete"
    return target


def progress(form: StudyForm, values: dict[str, dict]) -> tuple[str | None, str | None, list[str]]:
    """Return current step, terminal outcome, and submitted path, with no clock dependence."""
    positions = {step.id: i for i, step in enumerate(form.steps)}
    current = form.steps[0].id
    visited = []
    while current not in TERMINALS:
        if current not in values:
            return current, None, visited
        visited.append(current)
        current = next_destination(form, positions[current], values)
    return None, "completed" if current == "complete" else "screened_out", visited
