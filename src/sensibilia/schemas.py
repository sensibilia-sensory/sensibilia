from typing import Annotated, Literal
from uuid import UUID

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    computed_field,
    field_validator,
    model_serializer,
    model_validator,
)

from sensibilia.assets import AssetManifest
from sensibilia.flow_answers import FlowAnswer
from sensibilia.flows import DraftFlowV2, Text
from sensibilia.forms import Code, StepValue, StudyForm
from sensibilia.methods import (
    DEFAULT_LABELS,
    HEDONIC_ID,
    MethodConfiguration,
    MethodValue,
    StrictModel,
)


class HealthRead(StrictModel):
    status: Literal["ok"]


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class TestTypeRead(ORMModel):
    id: str
    key: str
    name: str
    schema_version: int
    configuration_schema: dict
    method_metadata: dict

    @computed_field
    @property
    def default_scale_labels(self) -> list[str] | None:
        """Code-owned method defaults for configuration UIs, never study-specific content."""
        return DEFAULT_LABELS.copy() if self.id == HEDONIC_ID else None


class StudyCreate(StrictModel):
    title: str = Field(min_length=1, max_length=250)
    description: str = Field(default="", max_length=10000)


class StudyUpdate(StudyCreate):
    study_version_id: UUID | None = None
    revision_hash: str | None = None


class VersionRead(ORMModel):
    id: str
    study_id: str
    version_number: int
    title: str
    description: str
    published_at: str | None
    form: StudyForm | DraftFlowV2 | None = None
    revision_hash: str


class FormUpdate(StrictModel):
    form: StudyForm | DraftFlowV2 | None
    revision_hash: str | None = None

    @field_validator("form", mode="before")
    @classmethod
    def select_version(cls, value):
        # Legacy clients omitted the v1 tag. Select one validation branch before
        # the union so v2 field errors retain their exact locations.
        if isinstance(value, dict):
            if value.get("schema_version", 1) == 2:
                return DraftFlowV2.model_validate(value)
            if value.get("schema_version", 1) == 1:
                return StudyForm.model_validate(value)
        return value


class VersionUpdate(StudyCreate):
    revision_hash: str


class DraftCreate(StrictModel):
    convert_legacy_flow: bool = False


class PublishRequest(StrictModel):
    study_version_id: UUID
    revision_hash: str
    acknowledged_warning_codes: list[str] = Field(default_factory=list)


class ValidationIssue(BaseModel):
    severity: Literal["error", "warning"]
    node_id: str | None = None
    study_test_id: str | None = None
    path: list[str | int]
    code: str
    message: str


class APIErrorRead(BaseModel):
    """Runtime errors retain either a message or precise field/report dictionaries."""

    detail: str | list[dict]


class ValidationReport(BaseModel):
    study_version_id: str
    revision_hash: str
    valid: bool
    issues: list[ValidationIssue]


class StudyRead(ORMModel):
    id: str
    title: str
    description: str
    status: str
    created_at: str
    closed_at: str | None = None
    archived_at: str | None = None
    open_assessments: int = 0
    versions: list[VersionRead]


class StudyClose(StrictModel):
    """Closing stops new assessments; open ones finish unless staff end them here."""

    end_open_assessments: bool = False


class TestCreate(StrictModel):
    test_type_id: str = "hedonic-9-v1"
    configuration: MethodConfiguration
    method_text: dict[Annotated[str, Field(pattern=r"^/")], Text] | None = None
    revision_hash: str | None = None


class TestRead(ORMModel):
    id: str
    study_version_id: str
    test_type_id: str
    position: int
    configuration: MethodConfiguration


class SessionContext(StrictModel):
    language: str
    booth_number: int | None = None
    table_number: int | None = None
    returning_code_hashes: list[str] = Field(default_factory=list)


class SessionCreate(StrictModel):
    study_version_id: UUID
    assessor_code: str = Field(min_length=1, max_length=100)
    context: SessionContext | None = None


class SessionRead(ORMModel):
    id: str
    study_version_id: str
    assessor_code: str
    presentation_order: list[str]
    started_at: str
    completed_at: str | None
    status: str


class SessionProvisioned(SessionRead):
    session_token: str


class BlindSlot(StrictModel):
    slot_id: str
    code: str


class ProductSlot(BlindSlot):
    sample_id: UUID


class PublicAssignment(StrictModel):
    study_test_id: UUID
    kind: str
    samples: list[ProductSlot | BlindSlot]
    reference: BlindSlot | None = None


class PublicSample(StrictModel):
    id: UUID
    code: str


class ServingSlot(ProductSlot):
    label: str


class ServingPlan(StrictModel):
    study_test_id: UUID
    kind: str
    samples: list[ServingSlot]
    reference: ServingSlot | None = None
    sequence_key: str | None = None
    correct_slot_id: str | None = None


class LoopSample(StrictModel):
    sample_id: UUID
    code: str
    position: int = Field(ge=1)
    ingredient_tags: list[str]


class LoopAssignment(StrictModel):
    design_id: str | None = None
    design_seed: int | None = None
    design_algorithm: str | None = None
    design_block: Literal["complete", "incomplete"] | None = None
    design_block_size: int | None = None
    generator_version: str | None = None
    allocation_ordinal: int | None = None
    sequence_index: int | None = None
    loop_id: UUID
    samples: list[LoopSample]

    @model_serializer(mode="wrap")
    def serialize_assignment(self, handler):
        data = handler(self)
        if self.design_id is None:
            for key in (
                "design_id",
                "design_seed",
                "design_algorithm",
                "design_block",
                "design_block_size",
                "generator_version",
                "allocation_ordinal",
                "sequence_index",
            ):
                data.pop(key, None)
        return data


class ServingAssignmentRead(BaseModel):
    room_name: str | None = None
    booth_label: str | None = None
    room_revision: int | None = None
    id: str
    room_version_id: str
    booth_id: str
    session_id: str
    assigned_at: str
    released_at: str | None


class PackageRead(BaseModel):
    serving_assignment: ServingAssignmentRead | None = None

    @model_serializer(mode="wrap")
    def serving_serializer(self, handler):
        data = handler(self)
        if self.serving_assignment is None:
            data.pop("serving_assignment", None)
        return data

    package_schema_version: int = 1
    flow: DraftFlowV2 | None = None
    evaluator_version: str | None = None
    revision_hash: str | None = None
    context: dict = Field(default_factory=dict)
    loop_assignments: list[LoopAssignment] = Field(default_factory=list)
    session: SessionRead
    study_version: VersionRead
    test_types: list[TestTypeRead]
    tests: list[TestRead]
    samples: list[PublicSample] = Field(default_factory=list)
    assets: list[AssetManifest] = Field(default_factory=list)
    assignments: list[PublicAssignment] = Field(default_factory=list)


class EventCreate(StrictModel):
    client_event_id: UUID
    study_test_id: UUID
    sample_id: UUID | None = None
    question_id: str = Field(min_length=1, max_length=100)
    value: MethodValue
    recorded_at: AwareDatetime
    supersedes_event_id: UUID | None = None
    step_id: UUID | None = None
    occurrence_id: str | None = Field(default=None, max_length=100)


class ResponseBatch(StrictModel):
    events: list[EventCreate] = Field(min_length=1, max_length=500)


class EventAcknowledgement(BaseModel):
    client_event_id: str
    response_id: str
    status: str


class BatchAcknowledgement(BaseModel):
    events: list[EventAcknowledgement]


class FormEventCreate(StrictModel):
    client_event_id: UUID
    step_id: Code
    value: StepValue | FlowAnswer
    occurrence_id: str | None = Field(default=None, max_length=100)
    sample_id: UUID | None = None
    supersedes_event_id: UUID | None = None
    recorded_at: AwareDatetime


class FormBatch(StrictModel):
    events: list[FormEventCreate] = Field(min_length=1, max_length=100)


class FormEventRead(ORMModel):
    id: str
    session_id: str
    step_id: str
    value: StepValue | FlowAnswer
    occurrence_id: str | None = None
    sample_id: str | None = None
    supersedes_event_id: str | None = None
    recorded_at: str
    received_at: str
    client_event_id: str
    study_version_id: str
    version_number: int
    assessor_code: str


class ProgressRead(BaseModel):
    current_step_id: str | None
    outcome: str | None
    visited_step_ids: list[str]
    message: str | None = None
    occurrence_id: str | None = None
    next_seq: int | None = None


class ObservationRead(ORMModel):
    id: str
    session_id: str
    study_test_id: str
    sample_id: str | None
    question_id: str
    value: MethodValue
    recorded_at: str
    received_at: str
    client_event_id: str
    supersedes_event_id: str | None
    study_id: str
    study_version_id: str
    version_number: int
    assessor_code: str
    test_type_id: str
    method_key: str
    method_schema_version: int
    is_current: bool
    step_id: str | None = None
    occurrence_id: str | None = None


# Letters, digits, - and _; single spaces may separate words.
SAMPLE_CODE_PATTERN = r"^[A-Za-z0-9_-]+( [A-Za-z0-9_-]+)*$"


class SampleCreate(StrictModel):
    revision_hash: str | None = None
    code: str = Field(min_length=1, max_length=40, pattern=SAMPLE_CODE_PATTERN)
    label: str = Field(min_length=1, max_length=250)
    ingredient_tags: list[Annotated[str, Field(min_length=1, max_length=100)]] | None = Field(
        default=None, max_length=100
    )

    @field_validator("ingredient_tags")
    @classmethod
    def reviewed_tags(cls, tags):
        if tags is not None and any(not tag.strip() for tag in tags):
            raise ValueError("Ingredient tags must be nonblank")
        return tags


class SampleRead(ORMModel):
    id: str
    study_version_id: str
    code: str
    label: str

    ingredient_tags: list[str] | None = None


class PathEventCreate(StrictModel):
    client_event_id: UUID
    seq: int = Field(ge=1)
    step_id: UUID
    occurrence_id: str = Field(min_length=1, max_length=100)
    sample_id: UUID | None = None
    kind: Literal["entered", "submitted", "skipped", "reviewed", "ended"]
    reason: Literal["guard_false", "jumped", "restriction", "not_shown"] | None = None
    target_id: UUID | None = None
    answer_event_ids: list[UUID] = Field(default_factory=list, max_length=100)
    recorded_at: AwareDatetime


class PathBatch(StrictModel):
    events: list[PathEventCreate] = Field(min_length=1, max_length=500)


class PathAcknowledgement(BaseModel):
    client_event_id: str
    path_event_id: str
    status: Literal["accepted", "duplicate"]


class PathBatchAcknowledgement(BaseModel):
    events: list[PathAcknowledgement]
    next_seq: int


class PathEventRead(ORMModel):
    id: str
    session_id: str
    client_event_id: str
    seq: int
    step_id: str
    occurrence_id: str
    sample_id: str | None
    kind: Literal["entered", "submitted", "skipped", "reviewed", "ended"]
    reason: Literal["guard_false", "jumped", "restriction", "not_shown"] | None
    target_id: str | None
    answer_event_ids: list[str]
    recorded_at: str
    received_at: str
    study_id: str
    study_version_id: str
    version_number: int
    assessor_code: str


class DataRowRead(BaseModel):
    """Read-only long ledger; JSON columns use the exact lossless CSV encoding."""

    row_id: str
    row_kind: Literal[
        "answer", "form_answer", "path", "expected_missing", "temporal_run", "temporal_transition"
    ]
    study_id: str
    study_version_id: str
    version_number: int
    session_id: str
    assessor_code: str
    id: str | None = None
    study_test_id: str | None = None
    sample_id_json: str = "null"
    question_id: str | None = None
    value_json: str = "null"
    recorded_at: str | None = None
    received_at: str | None = None
    client_event_id: str | None = None
    supersedes_event_id: str | None = None
    test_type_id: str | None = None
    method_key: str | None = None
    method_schema_version: int | None = None
    is_current: bool | None = None
    step_id: str | None = None
    occurrence_id: str | None = None
    block_kind: str | None = None
    form_schema_version: int | None = None
    state: str | None = None
    skip_reason: str | None = None
    path_seq: int | None = None
    path_kind: str | None = None
    target_id: str | None = None
    answer_event_ids_json: str = "null"
    option_label: str | None = None
    score_json: str | None = None
    sample_code: str | None = None
    sample_label: str | None = None
    attribute_label: str | None = None
    descriptor_id: str | None = None
    descriptor: str | None = None
    rank: int | None = None
    x: float | None = None
    y: float | None = None
    coordinate_units: str | None = None
    selected_code: str | None = None
    correct: bool | None = None
    serving_plan_json: str | None = None
    design_id: str | None = None
    design_seed: int | None = None
    design_algorithm: str | None = None
    generator_version: str | None = None
    allocation_ordinal: int | None = None
    sequence_index: int | None = None
    sample_position: int | None = None
    serving_slot_id: str | None = None
    temporal_attributes_json: str | None = None
    temporal_run_id: str | None = None
    temporal_seq: int | None = None
    temporal_elapsed_milliseconds: int | None = None
    clock_resolution_ms: float | None = None
    interruption_flags_json: str | None = None


class StaffAction(StrictModel):
    staff_name: str = Field(min_length=1, max_length=100, pattern=r"\S")
    reason: str = Field(min_length=1, max_length=500, pattern=r"\S")


class TerminalCreate(StaffAction):
    name: str = Field(min_length=1, max_length=100, pattern=r"\S")


class TerminalChange(StaffAction):
    expected_revision: int = Field(ge=0)


class TerminalAssign(TerminalChange):
    session_id: UUID


class TerminalRead(BaseModel):
    id: str
    name: str
    revision: int
    booth_id: str | None
    registered_at: str
    retired_at: str | None
    session_id: str | None
    assessor_code: str | None
    study_version_id: str | None
    session_status: str | None


class TerminalBoothLink(TerminalChange):
    booth_id: UUID | None


class NextAssessment(TerminalChange):
    study_version_id: UUID | None = None
    assessor_code: str | None = Field(default=None, min_length=1, max_length=100, pattern=r"\S")


class PairingCreate(StrictModel):
    staff_name: str = Field(min_length=1, max_length=100, pattern=r"\S")
    booth_id: UUID | None = None


class PairingIssued(BaseModel):
    id: str
    code: str
    expires_at: str
    booth_id: str | None


class NetworkAddress(BaseModel):
    address: str | None


class PairingStatus(BaseModel):
    id: str
    status: Literal["waiting", "paired", "expired"]
    terminal: "TerminalRead | None"


class PairingRedeem(StrictModel):
    code: str = Field(min_length=6, max_length=20)


class PairingRedeemed(BaseModel):
    terminal_id: str
    name: str
    terminal_token: str


class TerminalRegistered(TerminalRead):
    terminal_token: str


class TerminalTask(BaseModel):
    terminal_id: str
    revision: int
    session_id: str | None


class TerminalAuditRead(ORMModel):
    id: str
    terminal_id: str
    session_id: str | None
    action: Literal["registered", "assigned", "retired", "booth_linked"]
    staff_name: str
    principal: str
    reason: str
    revision: int
    recorded_at: str


class TemplateCreate(StrictModel):
    source_version_id: UUID
    name: str = Field(min_length=1, max_length=250)
    review_notes: str = Field(min_length=1, max_length=10000)


class TemplateRead(ORMModel):
    id: str
    source_version_id: str
    name: str
    review_notes: str
    principal: str
    created_at: str


class QuestionnaireItemCreate(StrictModel):
    """A step saved for reuse. `node` is checked as a one-step Flow v2 and must be an ordinary
    question, battery, consent, information or confirm step (or a group of those)."""

    name: str = Field(min_length=1, max_length=250)
    languages: list[str] = Field(min_length=1, max_length=10)
    default_language: str = Field(min_length=1, max_length=20)
    text_version: Literal[1] | None = None
    node: dict


class QuestionnaireItemRead(ORMModel):
    id: str
    name: str
    kind: str
    languages: list[str]
    default_language: str
    text_version: int | None
    node: dict
    principal: str
    created_at: str
    archived_at: str | None


class StudyDuplicate(StudyCreate):
    source_version_id: UUID
    reviewed_content: Literal[True]


class DraftTest(StrictModel):
    id: UUID
    test_type_id: str
    configuration: MethodConfiguration


class DraftSave(VersionUpdate):
    form: DraftFlowV2
    tests: list[DraftTest] = Field(max_length=100)


class DraftAuditRead(ORMModel):
    id: str
    study_version_id: str
    principal: str
    action: str
    revision_hash: str
    recorded_at: str


PER_SAMPLE_METHODS = {"hedonic-9-v1", "cata-v1", "rata-v1", "jar-v1", "tcata-v1"}


class StudyFromSamples(StudyCreate):
    """A study that runs the listed methods once for each listed sample, in the entered order."""

    language: str = Field(default="en", pattern=r"^[a-z]{2}(-[A-Za-z0-9]{2,8})*$")
    samples: list[SampleCreate] = Field(min_length=2, max_length=50)
    methods: list[TestCreate] = Field(min_length=1, max_length=20)

    @model_validator(mode="after")
    def battery(self):
        codes = [s.code for s in self.samples]
        if len(set(codes)) != len(codes):
            raise ValueError("Sample codes must be unique")
        for item in [*self.samples, *self.methods]:
            if item.revision_hash is not None:
                raise ValueError("Revision hashes do not apply to a new study")
        for method in self.methods:
            if method.test_type_id not in PER_SAMPLE_METHODS:
                raise ValueError(
                    "Only methods answered once per sample can be added here: "
                    + ", ".join(sorted(PER_SAMPLE_METHODS))
                )
        return self


class SampleUpdate(SampleCreate):
    revision_hash: str


class DesignGenerate(StrictModel):
    revision_hash: str
    loop_id: UUID
    algorithm: Literal["fixed", "shuffle", "latin", "williams", "incomplete"]
    seed: int = Field(ge=0, le=2147483647)
    sequence_count: int = Field(default=24, ge=1, le=1000)
    allocation_basis: Literal["provisioned"]
    replacement_policy: Literal["retain_and_allocate_next"]
    block: Literal["complete", "incomplete"]
    block_size: int | None = Field(default=None, ge=2, le=49)
    replicates: Literal[1]


class DesignRead(ORMModel):
    id: str
    study_version_id: str
    loop_id: str
    settings: dict
    sequences: list[list[str]]


class AllocationRead(ORMModel):
    id: str
    design_id: str
    session_id: str
    ordinal: int
    sequence_index: int


class BlindingGenerate(StrictModel):
    revision_hash: str
    seed: int = Field(ge=0, le=2147483647)


class ExportOptions(StrictModel):
    format: Literal["long", "wide", "r"] = "long"
    history: Literal["all", "current"] = "all"


class WideColumnRead(StrictModel):
    column: str
    key_json: str
    description: str


class ExportDictionaryRead(StrictModel):
    schema_version: Literal[1] = 1
    study_id: str
    study_version_id: str | None
    options: ExportOptions
    row_keys: list[str]
    key_fields: list[str]
    cell_encoding: str
    history_policy: str
    state_policy: str
    limits: dict[str, int]
    columns: list[WideColumnRead]
