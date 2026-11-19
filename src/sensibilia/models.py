from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import (
    JSON,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def identifier() -> str:
    return str(uuid4())


def timestamp() -> str:
    return datetime.now(UTC).isoformat()


class Base(DeclarativeBase):
    pass


class AssetBlob(Base):
    __tablename__ = "asset_blobs"
    sha256: Mapped[str] = mapped_column(String, primary_key=True)
    media_type: Mapped[str] = mapped_column(String)
    byte_size: Mapped[int] = mapped_column(Integer)
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)


class Asset(Base):
    __tablename__ = "assets"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=identifier)
    study_version_id: Mapped[str] = mapped_column(ForeignKey("study_versions.id"), index=True)
    sha256: Mapped[str] = mapped_column(ForeignKey("asset_blobs.sha256"))
    name: Mapped[str] = mapped_column(String)
    alt_text: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[str] = mapped_column(String, default=timestamp)


class TestType(Base):
    __tablename__ = "test_types"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    key: Mapped[str] = mapped_column(String)
    name: Mapped[str] = mapped_column(String)
    schema_version: Mapped[int] = mapped_column(Integer)
    configuration_schema: Mapped[dict] = mapped_column(JSON)
    method_metadata: Mapped[dict] = mapped_column(JSON)
    __table_args__ = (UniqueConstraint("key", "schema_version"),)


class Study(Base):
    __tablename__ = "studies"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=identifier)
    title: Mapped[str] = mapped_column(String)
    description: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="draft")
    created_at: Mapped[str] = mapped_column(String, default=timestamp)
    closed_at: Mapped[str | None] = mapped_column(String)
    archived_at: Mapped[str | None] = mapped_column(String)


class StudyVersion(Base):
    __tablename__ = "study_versions"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=identifier)
    study_id: Mapped[str] = mapped_column(ForeignKey("studies.id"), index=True)
    version_number: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String)
    description: Mapped[str] = mapped_column(String)
    published_at: Mapped[str | None] = mapped_column(String)
    revision: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    @property
    def revision_hash(self) -> str:
        from sensibilia.flow_service import revision_hash

        return revision_hash(self)

    form: Mapped[dict | None] = mapped_column(JSON(none_as_null=True))
    __table_args__ = (
        UniqueConstraint("study_id", "version_number"),
        Index(
            "uq_study_versions_one_draft",
            "study_id",
            unique=True,
            sqlite_where=text("published_at IS NULL"),
        ),
    )


class StudyTest(Base):
    __tablename__ = "study_tests"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=identifier)
    study_version_id: Mapped[str] = mapped_column(ForeignKey("study_versions.id"), index=True)
    test_type_id: Mapped[str] = mapped_column(ForeignKey("test_types.id"))
    position: Mapped[int] = mapped_column(Integer)
    configuration: Mapped[dict] = mapped_column(JSON)
    __table_args__ = (UniqueConstraint("study_version_id", "position"),)


class AssessorSession(Base):
    __tablename__ = "sessions"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=identifier)
    study_version_id: Mapped[str] = mapped_column(ForeignKey("study_versions.id"), index=True)
    assessor_code: Mapped[str] = mapped_column(String)
    token_hash: Mapped[str] = mapped_column(String, unique=True)
    context: Mapped[dict] = mapped_column(JSON, default=dict, server_default="{}")
    loop_assignments: Mapped[list] = mapped_column(JSON, default=list, server_default="[]")
    presentation_order: Mapped[list] = mapped_column(JSON)
    started_at: Mapped[str] = mapped_column(String, default=timestamp)
    completed_at: Mapped[str | None] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="in_progress")


class Observation(Base):
    __tablename__ = "responses"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=identifier)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id"))
    study_test_id: Mapped[str] = mapped_column(ForeignKey("study_tests.id"))
    sample_id: Mapped[str | None] = mapped_column(String)
    step_id: Mapped[str | None] = mapped_column(String)
    occurrence_id: Mapped[str | None] = mapped_column(String)
    question_id: Mapped[str] = mapped_column(String)
    value: Mapped[dict] = mapped_column(JSON)
    recorded_at: Mapped[str] = mapped_column(String)
    received_at: Mapped[str] = mapped_column(String, default=timestamp)
    client_event_id: Mapped[str] = mapped_column(String, unique=True)
    supersedes_event_id: Mapped[str | None] = mapped_column(
        ForeignKey("responses.client_event_id"), unique=True
    )
    __table_args__ = (
        Index("ix_responses_session_test_question", "session_id", "study_test_id", "question_id"),
        Index("ix_responses_study_test_id", "study_test_id"),
    )


class FormEvent(Base):
    """Atomic Continue submissions for all ordinary questionnaire block kinds."""

    __tablename__ = "form_events"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=identifier)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id"), index=True)
    step_id: Mapped[str] = mapped_column(String)
    value: Mapped[dict] = mapped_column(JSON)
    recorded_at: Mapped[str] = mapped_column(String)
    received_at: Mapped[str] = mapped_column(String, default=timestamp)
    client_event_id: Mapped[str] = mapped_column(String, unique=True)
    occurrence_id: Mapped[str | None] = mapped_column(String)
    sample_id: Mapped[str | None] = mapped_column(String)
    supersedes_event_id: Mapped[str | None] = mapped_column(String)
    __table_args__ = (
        UniqueConstraint("session_id", "step_id", "occurrence_id"),
        Index(
            "uq_form_events_legacy_step",
            "session_id",
            "step_id",
            unique=True,
            sqlite_where=text("occurrence_id IS NULL"),
        ),
    )


class Sample(Base):
    __tablename__ = "samples"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=identifier)
    study_version_id: Mapped[str] = mapped_column(ForeignKey("study_versions.id"), index=True)
    code: Mapped[str] = mapped_column(String)
    label: Mapped[str] = mapped_column(String)
    ingredient_tags: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    __table_args__ = (UniqueConstraint("study_version_id", "code"),)


class SessionTestAssignment(Base):
    __tablename__ = "session_test_assignments"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=identifier)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id"), index=True)
    study_test_id: Mapped[str] = mapped_column(ForeignKey("study_tests.id"), index=True)
    plan: Mapped[dict] = mapped_column(JSON)
    __table_args__ = (UniqueConstraint("session_id", "study_test_id"),)


class PathEvent(Base):
    __tablename__ = "path_events"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=identifier)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id"), index=True)
    client_event_id: Mapped[str] = mapped_column(String, unique=True)
    seq: Mapped[int] = mapped_column(Integer)
    step_id: Mapped[str] = mapped_column(String)
    occurrence_id: Mapped[str] = mapped_column(String)
    sample_id: Mapped[str | None] = mapped_column(String)
    kind: Mapped[str] = mapped_column(String)
    reason: Mapped[str | None] = mapped_column(String)
    target_id: Mapped[str | None] = mapped_column(String)
    answer_event_ids: Mapped[list] = mapped_column(JSON)
    recorded_at: Mapped[str] = mapped_column(String)
    received_at: Mapped[str] = mapped_column(String, default=timestamp)
    __table_args__ = (UniqueConstraint("session_id", "seq"),)


class Terminal(Base):
    __tablename__ = "terminals"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=identifier)
    name: Mapped[str] = mapped_column(String, unique=True)
    token_hash: Mapped[str] = mapped_column(String, unique=True)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    registered_at: Mapped[str] = mapped_column(String, default=timestamp)
    retired_at: Mapped[str | None] = mapped_column(String)
    booth_id: Mapped[str | None] = mapped_column(String)
    __table_args__ = (
        Index(
            "uq_terminal_active_booth",
            "booth_id",
            unique=True,
            sqlite_where=text("retired_at IS NULL AND booth_id IS NOT NULL"),
        ),
    )


class TerminalPairing(Base):
    """One-time code a staff member shows; redeeming it on the tablet registers a terminal."""

    __tablename__ = "terminal_pairings"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=identifier)
    code_hash: Mapped[str] = mapped_column(String, unique=True)
    staff_name: Mapped[str] = mapped_column(String)
    principal: Mapped[str] = mapped_column(String)
    booth_id: Mapped[str | None] = mapped_column(ForeignKey("booths.id"))
    created_at: Mapped[str] = mapped_column(String, default=timestamp)
    expires_at: Mapped[str] = mapped_column(String)
    redeemed_at: Mapped[str | None] = mapped_column(String)
    terminal_id: Mapped[str | None] = mapped_column(ForeignKey("terminals.id"))


class TerminalAssignment(Base):
    __tablename__ = "terminal_assignments"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=identifier)
    terminal_id: Mapped[str] = mapped_column(ForeignKey("terminals.id"), index=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id"), unique=True)
    assigned_at: Mapped[str] = mapped_column(String, default=timestamp)
    released_at: Mapped[str | None] = mapped_column(String)
    __table_args__ = (
        Index(
            "uq_terminal_current_assignment",
            "terminal_id",
            unique=True,
            sqlite_where=text("released_at IS NULL"),
        ),
    )


class TerminalAudit(Base):
    __tablename__ = "terminal_audit"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=identifier)
    terminal_id: Mapped[str] = mapped_column(ForeignKey("terminals.id"), index=True)
    session_id: Mapped[str | None] = mapped_column(ForeignKey("sessions.id"))
    action: Mapped[str] = mapped_column(String)
    staff_name: Mapped[str] = mapped_column(String)
    principal: Mapped[str] = mapped_column(String)
    reason: Mapped[str] = mapped_column(String)
    revision: Mapped[int] = mapped_column(Integer)
    recorded_at: Mapped[str] = mapped_column(String, default=timestamp)


class StudyTemplate(Base):
    __tablename__ = "study_templates"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=identifier)
    source_version_id: Mapped[str] = mapped_column(ForeignKey("study_versions.id"), index=True)
    name: Mapped[str] = mapped_column(String)
    review_notes: Mapped[str] = mapped_column(String)
    principal: Mapped[str] = mapped_column(String)
    created_at: Mapped[str] = mapped_column(String, default=timestamp)


class QuestionnaireItem(Base):
    """A saved step. Copied into drafts, never linked; archived, never deleted."""

    __tablename__ = "questionnaire_items"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=identifier)
    name: Mapped[str] = mapped_column(String)
    kind: Mapped[str] = mapped_column(String)
    languages: Mapped[list] = mapped_column(JSON)
    default_language: Mapped[str] = mapped_column(String)
    text_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    node: Mapped[dict] = mapped_column(JSON)
    principal: Mapped[str] = mapped_column(String)
    created_at: Mapped[str] = mapped_column(String, default=timestamp)
    archived_at: Mapped[str | None] = mapped_column(String, nullable=True)


class DraftAudit(Base):
    __tablename__ = "draft_audit"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=identifier)
    study_version_id: Mapped[str] = mapped_column(ForeignKey("study_versions.id"), index=True)
    principal: Mapped[str] = mapped_column(String)
    action: Mapped[str] = mapped_column(String)
    revision_hash: Mapped[str] = mapped_column(String)
    snapshot: Mapped[dict] = mapped_column(JSON)
    recorded_at: Mapped[str] = mapped_column(String, default=timestamp)


class StudyDesign(Base):
    __tablename__ = "study_designs"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=identifier)
    study_version_id: Mapped[str] = mapped_column(ForeignKey("study_versions.id"), index=True)
    loop_id: Mapped[str] = mapped_column(String)
    settings: Mapped[dict] = mapped_column(JSON)
    sequences: Mapped[list] = mapped_column(JSON)
    __table_args__ = (UniqueConstraint("study_version_id", "loop_id"),)


class DesignAllocation(Base):
    __tablename__ = "design_allocations"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=identifier)
    design_id: Mapped[str] = mapped_column(ForeignKey("study_designs.id"), index=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id"), index=True)
    ordinal: Mapped[int] = mapped_column(Integer)
    sequence_index: Mapped[int] = mapped_column(Integer)
    __table_args__ = (
        UniqueConstraint("design_id", "ordinal"),
        UniqueConstraint("design_id", "session_id"),
    )


class LaboratoryRoom(Base):
    __tablename__ = "rooms"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=identifier)
    created_at: Mapped[str] = mapped_column(String, default=timestamp)


class BoothIdentity(Base):
    __tablename__ = "booths"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    room_id: Mapped[str] = mapped_column(ForeignKey("rooms.id"), index=True)


class RoomVersion(Base):
    __tablename__ = "room_versions"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=identifier)
    room_id: Mapped[str] = mapped_column(ForeignKey("rooms.id"), index=True)
    revision: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String)
    rows: Mapped[int] = mapped_column(Integer)
    columns: Mapped[int] = mapped_column(Integer)
    booths: Mapped[list] = mapped_column(JSON)
    created_at: Mapped[str] = mapped_column(String, default=timestamp)
    __table_args__ = (UniqueConstraint("room_id", "revision"),)


class BoothAssignment(Base):
    __tablename__ = "booth_assignments"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=identifier)
    room_version_id: Mapped[str] = mapped_column(ForeignKey("room_versions.id"), index=True)
    booth_id: Mapped[str] = mapped_column(ForeignKey("booths.id"))
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id"), index=True)
    staff_name: Mapped[str] = mapped_column(String)
    principal: Mapped[str] = mapped_column(String)
    reason: Mapped[str] = mapped_column(String)
    assigned_at: Mapped[str] = mapped_column(String, default=timestamp)
    released_at: Mapped[str | None] = mapped_column(String)
    __table_args__ = (
        Index("uq_booth_active", "booth_id", unique=True, sqlite_where=text("released_at IS NULL")),
        Index(
            "uq_session_booth_active",
            "session_id",
            unique=True,
            sqlite_where=text("released_at IS NULL"),
        ),
    )


class Presence(Base):
    __tablename__ = "presence"
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id"), primary_key=True)
    last_seen: Mapped[str] = mapped_column(String)
    process_id: Mapped[str] = mapped_column(String)


class ServingSignal(Base):
    __tablename__ = "serving_signals"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=identifier)
    assignment_id: Mapped[str] = mapped_column(ForeignKey("booth_assignments.id"), index=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id"), index=True)
    step_id: Mapped[str] = mapped_column(String)
    occurrence_id: Mapped[str] = mapped_column(String)
    state: Mapped[str] = mapped_column(String)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    requested_at: Mapped[str] = mapped_column(String)
    updated_at: Mapped[str] = mapped_column(String)
    actor: Mapped[str] = mapped_column(String)
    __table_args__ = (UniqueConstraint("assignment_id", "step_id", "occurrence_id"),)


class OperationalEvent(Base):
    __tablename__ = "operational_events"
    cursor: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    client_event_id: Mapped[str] = mapped_column(String, unique=True)
    signal_id: Mapped[str | None] = mapped_column(ForeignKey("serving_signals.id"), index=True)
    assignment_id: Mapped[str] = mapped_column(ForeignKey("booth_assignments.id"), index=True)
    action: Mapped[str] = mapped_column(String)
    payload: Mapped[dict] = mapped_column(JSON)
    actor: Mapped[str] = mapped_column(String)
    principal: Mapped[str] = mapped_column(String)
    recorded_at: Mapped[str] = mapped_column(String)
    received_at: Mapped[str] = mapped_column(String, default=timestamp)
    result: Mapped[dict] = mapped_column(JSON)


class TemporalRun(Base):
    __tablename__ = "temporal_runs"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=identifier)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id"), index=True)
    study_test_id: Mapped[str] = mapped_column(ForeignKey("study_tests.id"), index=True)
    step_id: Mapped[str] = mapped_column(String)
    occurrence_id: Mapped[str] = mapped_column(String)
    sample_id: Mapped[str | None] = mapped_column(ForeignKey("samples.id"))
    client_event_id: Mapped[str] = mapped_column(String, unique=True)
    payload: Mapped[dict] = mapped_column(JSON)
    recorded_at: Mapped[str] = mapped_column(String)
    received_at: Mapped[str] = mapped_column(String, default=timestamp)
    __table_args__ = (UniqueConstraint("session_id", "step_id", "occurrence_id"),)


class TemporalEvent(Base):
    __tablename__ = "temporal_events"
    client_event_id: Mapped[str] = mapped_column(String, primary_key=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("temporal_runs.id"), index=True)
    seq: Mapped[int] = mapped_column(Integer)
    elapsed_ms: Mapped[int] = mapped_column(Integer)
    attribute_id: Mapped[str] = mapped_column(String)
    selected: Mapped[bool] = mapped_column(Integer)
    recorded_at: Mapped[str] = mapped_column(String)
    __table_args__ = (UniqueConstraint("run_id", "seq"),)


class DatasetSnapshot(Base):
    __tablename__ = "dataset_snapshots"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=identifier)
    study_id: Mapped[str] = mapped_column(ForeignKey("studies.id"), index=True)
    study_version_id: Mapped[str | None] = mapped_column(ForeignKey("study_versions.id"))
    label: Mapped[str] = mapped_column(String)
    staff_name: Mapped[str] = mapped_column(String)
    principal: Mapped[str] = mapped_column(String)
    created_at: Mapped[str] = mapped_column(String, default=timestamp)
    manifest: Mapped[dict] = mapped_column(JSON)
    files: Mapped[dict] = mapped_column(JSON)


class AnalysisJob(Base):
    __tablename__ = "analysis_jobs"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=identifier)
    snapshot_id: Mapped[str] = mapped_column(ForeignKey("dataset_snapshots.id"), index=True)
    recipe: Mapped[str] = mapped_column(String)
    recipe_sha256: Mapped[str] = mapped_column(String)
    staff_name: Mapped[str] = mapped_column(String)
    principal: Mapped[str] = mapped_column(String)
    created_at: Mapped[str] = mapped_column(String, default=timestamp)
    status: Mapped[str] = mapped_column(String, default="queued")
    started_at: Mapped[str | None] = mapped_column(String)
    finished_at: Mapped[str | None] = mapped_column(String)
    image: Mapped[str | None] = mapped_column(String)
    result: Mapped[dict | None] = mapped_column(JSON(none_as_null=True))
    result_sha256: Mapped[str | None] = mapped_column(String)
    error: Mapped[str | None] = mapped_column(String)
    # Analysis add-on; None for ledger census jobs.
    recipe_version: Mapped[int | None] = mapped_column(Integer)
    parameters: Mapped[dict | None] = mapped_column(JSON(none_as_null=True))
    study_test_id: Mapped[str | None] = mapped_column(String)
    runtime: Mapped[dict | None] = mapped_column(JSON(none_as_null=True))


class AnalysisJobFigure(Base):
    __tablename__ = "analysis_job_figures"
    job_id: Mapped[str] = mapped_column(ForeignKey("analysis_jobs.id"), primary_key=True)
    name: Mapped[str] = mapped_column(String, primary_key=True)
    content: Mapped[bytes] = mapped_column(LargeBinary)
    sha256: Mapped[str] = mapped_column(String)
