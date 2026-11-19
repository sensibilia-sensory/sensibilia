"""Closed Flow v2 storage types. Form v1 remains a separate contract."""

from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, StrictBool, StrictFloat, StrictInt, model_validator

from .methods import StrictModel

Language = Annotated[str, Field(pattern=r"^[a-z]{2}(-[A-Za-z0-9]{2,8})*$")]
Text = Annotated[dict[Language, Annotated[str, Field(max_length=30000)]], Field(max_length=10)]
Key = Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]+$", min_length=1, max_length=100)]
Scalar = str | StrictInt | StrictFloat | StrictBool
LiteralValue = Scalar | list[Scalar] | None


class Predicate(StrictModel):
    variable: str = Field(min_length=1, max_length=250)
    operator: Literal["eq", "neq", "lt", "lte", "gt", "gte", "in", "contains", "intersects"]
    value: LiteralValue


class Defined(StrictModel):
    variable: str = Field(min_length=1, max_length=250)
    operator: Literal["is_defined"]


class All(StrictModel):
    all: list["Condition"] = Field(min_length=1, max_length=20)


class AnyCondition(StrictModel):
    any: list["Condition"] = Field(min_length=1, max_length=20)


Condition = Predicate | Defined | All | AnyCondition


class ContinueAction(StrictModel):
    action: Literal["continue", "next_sample", "previous_question"] = "continue"


class TargetAction(StrictModel):
    action: Literal["skip_to", "end_study"]
    target_id: UUID


Otherwise = ContinueAction | TargetAction


class FlowOption(StrictModel):
    id: Key
    label: Text
    exclusive: bool = False
    score: StrictInt | StrictFloat | None = None


class FlowRow(StrictModel):
    id: Key
    prompt: Text
    required: bool


class InfoData(StrictModel):
    body: Text
    continue_label: Text
    asset_ids: list[UUID] = Field(default_factory=list, max_length=50)

    @model_validator(mode="after")
    def unique_assets(self):
        if len(set(self.asset_ids)) != len(self.asset_ids):
            raise ValueError("Info image references must be unique")
        return self


class ConsentData(StrictModel):
    body: Text
    accept_label: Text
    decline_label: Text


class QuestionData(StrictModel):
    prompt: Text
    answer_type: Literal["single", "multiple", "text", "integer"]
    options: list[FlowOption] | None = Field(default=None, min_length=2, max_length=100)
    required: bool
    allow_skip: bool
    min: StrictInt | None = None
    max: StrictInt | None = None
    max_length: StrictInt | None = Field(default=None, ge=1, le=30000)

    @model_validator(mode="after")
    def applicable_fields(self):
        choice = self.answer_type in {"single", "multiple"}
        if choice != (self.options is not None):
            raise ValueError("Only choice questions require options")
        if self.options:
            if len({o.id for o in self.options}) != len(self.options):
                raise ValueError("Option IDs must be unique")
            if self.answer_type == "single" and any(o.exclusive for o in self.options):
                raise ValueError("Exclusive options apply only to multiple choice")
            if any(o.score is not None for o in self.options):
                raise ValueError("Scores belong to matrix options")
        if self.answer_type != "integer" and (self.min is not None or self.max is not None):
            raise ValueError("Integer bounds apply only to integer answers")
        if self.min is not None and self.max is not None and self.min > self.max:
            raise ValueError("Minimum cannot exceed maximum")
        if self.answer_type != "text" and self.max_length is not None:
            raise ValueError("Text bounds apply only to text answers")
        return self


class MatrixData(StrictModel):
    instructions: Text
    rows: list[FlowRow] = Field(min_length=1, max_length=100)
    options: list[FlowOption] = Field(min_length=2, max_length=11)
    allow_skip: bool

    @model_validator(mode="after")
    def unique_ids(self):
        if len({r.id for r in self.rows}) != len(self.rows):
            raise ValueError("Row IDs must be unique")
        if len({o.id for o in self.options}) != len(self.options):
            raise ValueError("Option IDs must be unique")
        if any(o.exclusive for o in self.options):
            raise ValueError("Exclusive options apply only to multiple choice")
        return self


class MethodData(StrictModel):
    study_test_id: UUID
    sample_binding: Literal["none", "current", "set"]


class GroupData(StrictModel):
    children: list["Node"] = Field(max_length=100)


class LoopData(GroupData):
    sample_ids: list[UUID] = Field(max_length=50)

    @model_validator(mode="after")
    def unique_samples(self):
        if len(set(self.sample_ids)) != len(self.sample_ids):
            raise ValueError("Sample IDs must be unique")
        return self


class ConfirmData(StrictModel):
    body: Text
    ack_label: Text


class CodeData(StrictModel):
    prompt: Text
    source: Literal["sample_code", "returning_codes"]
    allow_unknown: bool
    normalization: Literal["trim_exact", "trim_upper_ascii"]


class ServeData(StrictModel):
    body: Text
    preparation: Text
    study_test_id: UUID | None = None
    timeout_seconds: int = Field(default=120, ge=30, le=600)
    sample_binding: Literal["current", "set"] = "current"
    sample_ids: list[UUID] = Field(default_factory=list, max_length=50)

    @model_validator(mode="after")
    def binding(self):
        if self.sample_binding == "current" and self.study_test_id:
            raise ValueError("Method serving plans require set binding")
        if self.sample_binding == "current" and self.sample_ids:
            raise ValueError(
                "Set serving requires explicit samples; current serving uses its frozen loop"
            )
        if len(set(self.sample_ids)) != len(self.sample_ids):
            raise ValueError("Serving samples must be distinct")
        return self


class EndData(StrictModel):
    body: Text
    outcome: Literal["completed", "screened_out"]


class NodeBase(StrictModel):
    id: UUID
    title: Text
    guard: Condition | None = None
    otherwise: Otherwise = Field(default_factory=ContinueAction)


class InfoNode(NodeBase):
    kind: Literal["info"]
    data: InfoData


class ConsentNode(NodeBase):
    kind: Literal["consent"]
    data: ConsentData


class QuestionNode(NodeBase):
    kind: Literal["question"]
    data: QuestionData


class MatrixNode(NodeBase):
    kind: Literal["matrix_question"]
    data: MatrixData


class MethodNode(NodeBase):
    kind: Literal["embedded_method"]
    data: MethodData


class GroupNode(NodeBase):
    kind: Literal["group"]
    data: GroupData


class LoopNode(NodeBase):
    kind: Literal["loop_samples"]
    data: LoopData


class ConfirmNode(NodeBase):
    kind: Literal["confirm"]
    data: ConfirmData


class CodeNode(NodeBase):
    kind: Literal["code_entry"]
    data: CodeData


class EndNode(NodeBase):
    kind: Literal["end"]
    data: EndData


class ServeNode(NodeBase):
    kind: Literal["serve_gate"]
    data: ServeData


Node = Annotated[
    InfoNode
    | ConsentNode
    | QuestionNode
    | MatrixNode
    | MethodNode
    | GroupNode
    | LoopNode
    | ConfirmNode
    | CodeNode
    | EndNode
    | ServeNode,
    Field(discriminator="kind"),
]


def walk(nodes):
    for node in nodes:
        yield node
        if isinstance(node, (GroupNode, LoopNode)):
            yield from walk(node.data.children)


def condition_depth(condition):
    children = getattr(condition, "all", getattr(condition, "any", []))
    return 1 + max((condition_depth(c) for c in children), default=0)


class DraftFlowV2(StrictModel):
    schema_version: Literal[2]
    text_version: Literal[1] | None = None
    languages: list[Language] = Field(min_length=1, max_length=10)
    default_language: Language
    nodes: list[Node] = Field(max_length=100)
    method_text: dict[UUID, dict[str, Text]] = Field(default_factory=dict)
    restriction_source_id: UUID | None = None
    restriction_tag_map: dict[str, list[str]] = Field(default_factory=dict, max_length=100)

    @model_validator(mode="after")
    def integrity(self):
        if len(set(self.languages)) != len(self.languages):
            raise ValueError("Languages must be unique")
        if self.default_language not in self.languages:
            raise ValueError("Default language must be declared")
        flat = list(walk(self.nodes))
        ids = {node.id for node in flat}
        if len(flat) > 100 or len(ids) != len(flat):
            raise ValueError("At most 100 nodes with unique IDs are allowed")
        refs = [n.data.study_test_id for n in flat if isinstance(n, MethodNode)]
        if len(set(refs)) != len(refs):
            raise ValueError("Each study test occurs once structurally")

        def check(nodes, depth=1, in_loop=False):
            if nodes and depth > 4:
                raise ValueError("Nesting exceeds four levels")
            for node in nodes:
                if node.guard and condition_depth(node.guard) > 4:
                    raise ValueError("Condition nesting exceeds four levels")
                if isinstance(node.otherwise, TargetAction) and node.otherwise.target_id not in ids:
                    raise ValueError("Dangling Otherwise target")
                if isinstance(node, ServeNode):
                    if (node.data.sample_binding == "current") != in_loop:
                        raise ValueError(
                            "Current serving requires a loop; set serving must be outside loops"
                        )
                if isinstance(node, MethodNode):
                    if (node.data.sample_binding == "current") != in_loop:
                        raise ValueError("Current sample binding is required only within loops")
                if isinstance(node, LoopNode):
                    if in_loop:
                        raise ValueError("Nested sample loops are forbidden")
                    check(node.data.children, depth + 1, True)
                elif isinstance(node, GroupNode):
                    check(node.data.children, depth + 1, in_loop)

        check(self.nodes)
        if self.restriction_source_id is not None and self.restriction_source_id not in ids:
            raise ValueError("Dangling restriction source")
        if any(
            not pointer.startswith("/") for texts in self.method_text.values() for pointer in texts
        ):
            raise ValueError("Method text keys must be JSON pointers")
        # Reject foreign node references even in incomplete drafts.
        for node in flat:

            def refs_in(condition):
                if isinstance(condition, (Predicate, Defined)):
                    if condition.variable.startswith("answer."):
                        source = condition.variable.split(".")[1]
                        if source not in {str(i) for i in ids}:
                            raise ValueError("Dangling answer variable")
                else:
                    for child in getattr(condition, "all", getattr(condition, "any", [])):
                        refs_in(child)

            if node.guard:
                refs_in(node.guard)
        return self


# Separate publication schema: draft text/children can be incomplete.
class FlowV2(DraftFlowV2):
    nodes: list[Node] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def complete_text(self):
        text_fields = {
            "title",
            "body",
            "prompt",
            "label",
            "instructions",
            "continue_label",
            "accept_label",
            "decline_label",
            "ack_label",
            "preparation",
        }

        def text(value):
            if set(value) != set(self.languages) or any(
                not isinstance(v, str) or not v.strip() for v in value.values()
            ):
                raise ValueError("Every declared language needs nonblank reviewed text")

        def check(value):
            if isinstance(value, dict):
                for key, child in value.items():
                    if key in text_fields:
                        text(child)
                    else:
                        check(child)
            elif isinstance(value, list):
                for child in value:
                    check(child)

        check(self.model_dump(mode="json")["nodes"])
        for overlays in self.method_text.values():
            for localized in overlays.values():
                text(localized)
        for node in walk(self.nodes):
            if isinstance(node, (GroupNode, LoopNode)) and not node.data.children:
                raise ValueError("Published containers need children")
            if (
                isinstance(node, ServeNode)
                and node.data.sample_binding == "set"
                and not node.data.sample_ids
            ):
                raise ValueError("Published serving sets need samples")
            if isinstance(node, LoopNode) and not node.data.sample_ids:
                raise ValueError("Published loops need samples")
        return self

    @classmethod
    def model_json_schema(cls, **kwargs):
        # Publication's structural requirements are also machine-readable.
        schema = super().model_json_schema(**kwargs)

        def tighten(value):
            if isinstance(value, dict):
                if value.get("type") == "object" and "propertyNames" in value:
                    names = value["propertyNames"]
                    if names.get("pattern", "").startswith("^[a-z]{2}"):
                        value["minProperties"] = 1
                        value["additionalProperties"]["minLength"] = 1
                for pattern, child in value.get("patternProperties", {}).items():
                    if pattern.startswith("^[a-z]{2}"):
                        value["minProperties"] = 1
                        value["additionalProperties"] = False
                        child["minLength"] = 1
                for key, child in value.get("properties", {}).items():
                    if key == "children" or (
                        key == "sample_ids" and "children" in value.get("properties", {})
                    ):
                        child["minItems"] = 1
                for child in list(value.values()):
                    tighten(child)
            elif isinstance(value, list):
                for child in value:
                    tighten(child)

        tighten(schema)
        return schema


for model in (All, AnyCondition, GroupData, LoopData, DraftFlowV2, FlowV2):
    model.model_rebuild()
