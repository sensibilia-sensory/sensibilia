import hashlib
import json
import os
import secrets
import time
from contextlib import asynccontextmanager
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi import Path as APIPath
from fastapi.responses import FileResponse, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError
from sqlalchemy import func, inspect, select, text
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session
from starlette.exceptions import HTTPException as StarletteHTTPException

from sensibilia.assets import (
    MAX_BODY,
    AssetManifest,
    AssetRead,
    AssetUpload,
    asset_read,
    referenced_ids,
    storage_path,
    store_upload,
    verified_bytes,
    version_assets,
)
from sensibilia.config import Settings
from sensibilia.data_service import (
    data_rows,
    observation_read,
    path_read,
    path_rows,
    response_rows,
)
from sensibilia.db import EXPECTED_REVISION, make_engine
from sensibilia.designs import allocate, blind_codes, generate, version_designs
from sensibilia.drafts import clone_content, record_changes, snapshot
from sensibilia.flow_answers import validate_answer
from sensibilia.flow_execution import collected_path, current_for_write, progress_v2, replay
from sensibilia.flow_service import is_v2, precondition, report, validate_references
from sensibilia.flow_text import localized_configuration, method_fields
from sensibilia.flows import DraftFlowV2, FlowV2, MethodNode, walk
from sensibilia.form_service import (
    assigned_form,
    form_rows,
    read_progress,
    test_complete,
)
from sensibilia.forms import StudyForm, TestStep, validate_form_tests, validate_value
from sensibilia.legacy_flow import convert_legacy
from sensibilia.methods import CONFIGURATIONS, sample_ids, validate_observation
from sensibilia.models import (
    AssessorSession,
    Asset,
    AssetBlob,
    BoothIdentity,
    DesignAllocation,
    DraftAudit,
    FormEvent,
    Observation,
    PathEvent,
    QuestionnaireItem,
    Sample,
    ServingSignal,
    SessionTestAssignment,
    Study,
    StudyDesign,
    StudyTemplate,
    StudyTest,
    StudyVersion,
    TemporalEvent,
    TemporalRun,
    Terminal,
    TerminalAssignment,
    TerminalAudit,
    TerminalPairing,
    TestType,
    identifier,
    timestamp,
)
from sensibilia.presentation import (
    assignment_for,
    provision_assignments,
    public_assignment,
    validate_samples,
    version_samples,
)
from sensibilia.schemas import (
    AllocationRead,
    APIErrorRead,
    BatchAcknowledgement,
    BlindingGenerate,
    DataRowRead,
    DesignGenerate,
    DesignRead,
    DraftAuditRead,
    DraftCreate,
    DraftSave,
    EventAcknowledgement,
    ExportDictionaryRead,
    ExportOptions,
    FormBatch,
    FormEventRead,
    FormUpdate,
    HealthRead,
    NetworkAddress,
    NextAssessment,
    ObservationRead,
    PackageRead,
    PairingCreate,
    PairingIssued,
    PairingRedeem,
    PairingRedeemed,
    PairingStatus,
    PathAcknowledgement,
    PathBatch,
    PathBatchAcknowledgement,
    PathEventRead,
    ProgressRead,
    PublishRequest,
    QuestionnaireItemCreate,
    QuestionnaireItemRead,
    ResponseBatch,
    SampleCreate,
    SampleRead,
    SampleUpdate,
    ServingPlan,
    SessionContext,
    SessionCreate,
    SessionProvisioned,
    SessionRead,
    StudyClose,
    StudyCreate,
    StudyDuplicate,
    StudyFromSamples,
    StudyRead,
    StudyUpdate,
    TemplateCreate,
    TemplateRead,
    TerminalAssign,
    TerminalAuditRead,
    TerminalBoothLink,
    TerminalChange,
    TerminalCreate,
    TerminalRead,
    TerminalRegistered,
    TerminalTask,
    TestCreate,
    TestRead,
    TestTypeRead,
    ValidationReport,
    VersionRead,
    VersionUpdate,
)
from sensibilia.temporal import TemporalBatch
from sensibilia.terminals import (
    assign_session,
    audit,
    checked_terminal,
    current_assignment,
    digest,
    new_pairing_code,
    next_terminal_name,
    normalise_code,
    pairing_expiry,
    release_name,
    release_removed_names,
    terminal_read,
)

researcher_bearer = HTTPBearer(scheme_name="ResearcherToken", auto_error=False)
session_bearer = HTTPBearer(scheme_name="SessionToken", auto_error=False)
Credentials = HTTPAuthorizationCredentials | None


def database(request: Request):
    with Session(request.app.state.engine, expire_on_commit=False) as db:
        db.info["settings"] = request.app.state.settings
        # Reserve SQLite's writer before reads, avoiding read-to-write upgrade races.
        try:
            if request.method in {"POST", "PUT", "DELETE", "PATCH"}:
                db.connection(execution_options={"sqlite_begin_mode": "IMMEDIATE"})
            if request.method in {"POST", "PUT", "PATCH", "DELETE"} and request.url.path.startswith(
                "/studies"
            ):
                study_id = request.path_params.get("study_id")
                if study_id:
                    db.info["draft_audit"] = {
                        "study_id": str(study_id),
                        "principal": "researcher-key:"
                        + digest(request.app.state.settings.researcher_token.get_secret_value())[
                            :16
                        ],
                        "action": request.method + " " + request.scope.get("route").path,
                        "snapshots": {v.id: snapshot(db, v) for v in versions(db, str(study_id))},
                        "before": {
                            v.id: (v.revision_hash, v.published_at)
                            for v in versions(db, str(study_id))
                        },
                    }
            yield db
        except OperationalError as exc:
            db.rollback()
            if "locked" in str(exc).lower() or "busy" in str(exc).lower():
                raise HTTPException(
                    503, "Database busy; retry the same event IDs", headers={"Retry-After": "1"}
                ) from exc
            raise


DB = Annotated[Session, Depends(database)]


def researcher(
    request: Request,
    credentials: Annotated[Credentials, Depends(researcher_bearer)],
):
    expected = request.app.state.settings.researcher_token.get_secret_value()
    if not expected:
        return
    if not credentials or not secrets.compare_digest(
        credentials.credentials.encode(), expected.encode()
    ):
        raise HTTPException(
            401, "Researcher credential required", headers={"WWW-Authenticate": "Bearer"}
        )


def assigned_session(
    session_id: UUID,
    request: Request,
    db: DB,
    credentials: Annotated[Credentials, Depends(session_bearer)],
) -> AssessorSession:
    session = db.get(AssessorSession, str(session_id))
    supplied_hash = hashlib.sha256(
        credentials.credentials.encode() if credentials else b""
    ).hexdigest()
    authorized = bool(session and secrets.compare_digest(supplied_hash, session.token_hash))
    if not authorized and credentials and session:
        terminal = db.scalar(
            select(Terminal).where(
                Terminal.token_hash == supplied_hash, Terminal.retired_at.is_(None)
            )
        )
        assignment = (
            db.scalar(
                select(TerminalAssignment).where(
                    TerminalAssignment.terminal_id == terminal.id,
                    TerminalAssignment.session_id == session.id,
                )
            )
            if terminal
            else None
        )
        # Historical assignments allow exact upload retries, never another package selection.
        authorized = bool(
            assignment and (request.method == "POST" or assignment.released_at is None)
        )
    if not credentials or not session or not authorized:
        raise HTTPException(
            401,
            "Credential does not authorize this session",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return session


Assigned = Annotated[AssessorSession, Depends(assigned_session)]


def get_study(db: Session, study_id: UUID) -> Study:
    study = db.get(Study, str(study_id))
    if not study:
        raise HTTPException(404, "Study not found")
    return study


def versions(db: Session, study_id: str) -> list[StudyVersion]:
    return list(
        db.scalars(
            select(StudyVersion)
            .where(StudyVersion.study_id == study_id)
            .order_by(StudyVersion.version_number)
        )
    )


STUDY_FIELDS = (
    "id",
    "title",
    "description",
    "status",
    "created_at",
    "closed_at",
    "archived_at",
)


def accepts_events(session: AssessorSession, recorded_at: datetime) -> bool:
    """Open sessions accept events. An assessment ended by staff still accepts what the tablet
    recorded before the end (it may sync late) and nothing recorded afterwards."""
    if session.status == "in_progress":
        return True
    return (
        session.status == "ended"
        and session.completed_at is not None
        and recorded_at <= datetime.fromisoformat(session.completed_at)
    )


def end_session(db: Session, session: AssessorSession):
    from sensibilia.booths import active_assignment, cancel_assignment

    session.status = "ended"
    session.completed_at = timestamp()
    assignment = active_assignment(db, session.id)
    if assignment:
        cancel_assignment(db, assignment, "session:" + session.id, "assessment ended by staff")


def open_sessions(db: Session, study_id: str) -> list[AssessorSession]:
    return list(
        db.scalars(
            select(AssessorSession)
            .join(StudyVersion, StudyVersion.id == AssessorSession.study_version_id)
            .where(StudyVersion.study_id == study_id, AssessorSession.status == "in_progress")
            .order_by(AssessorSession.started_at, AssessorSession.id)
        )
    )


def open_counts(db: Session, study_ids) -> dict[str, int]:
    rows = db.execute(
        select(StudyVersion.study_id, func.count(AssessorSession.id))
        .join(AssessorSession, AssessorSession.study_version_id == StudyVersion.id)
        .where(StudyVersion.study_id.in_(list(study_ids)), AssessorSession.status == "in_progress")
        .group_by(StudyVersion.study_id)
    )
    return {study_id: count for study_id, count in rows}


def draft(db: Session, study_id: UUID) -> StudyVersion:
    if get_study(db, study_id).archived_at:
        raise HTTPException(409, "Restore this archived study before editing it")
    version = db.scalar(
        select(StudyVersion).where(
            StudyVersion.study_id == str(study_id), StudyVersion.published_at.is_(None)
        )
    )
    if not version:
        raise HTTPException(409, "No draft exists; create a new draft version first")
    return version


def tests(db: Session, version_id: str) -> list[StudyTest]:
    return list(
        db.scalars(
            select(StudyTest)
            .where(StudyTest.study_version_id == version_id)
            .order_by(StudyTest.position)
        )
    )


def validate_test(payload: TestCreate) -> dict:
    model = CONFIGURATIONS.get(payload.test_type_id)
    if model is None:
        raise HTTPException(422, "Unsupported method or schema version")
    try:
        return model.model_validate(payload.configuration.model_dump()).model_dump(mode="json")
    except ValidationError as exc:
        raise HTTPException(422, "Configuration does not match the selected method") from exc


def commit(db: Session):
    try:
        record_changes(db)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "Operation conflicts with existing data") from exc


def create_app(settings: Settings | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        config = settings or Settings()
        engine = make_engine(config.database_url)
        try:
            with engine.connect() as connection:
                if not inspect(connection).has_table("alembic_version"):
                    raise RuntimeError("Run alembic upgrade head before starting the API")
                revisions = connection.scalars(
                    text("SELECT version_num FROM alembic_version")
                ).all()
                if revisions != [EXPECTED_REVISION]:
                    raise RuntimeError("Run alembic upgrade head before starting the API")
            app.state.settings = config
            app.state.engine = engine
            scheduler = None
            if config.analysis_runner:
                from sensibilia.analysis.scheduler import Scheduler

                scheduler = Scheduler(engine)
                scheduler.start()
            app.state.analysis_scheduler = scheduler
            yield
            if scheduler:
                scheduler.stop()
        finally:
            engine.dispose()

    app = FastAPI(
        title="Sensibilia API",
        version="0.1.0",
        lifespan=lifespan,
        description="Published sensory studies and idempotent response collection.",
        responses={
            401: {
                "model": APIErrorRead,
                "description": "Missing or invalid researcher/session credential",
            },
            404: {
                "model": APIErrorRead,
                "description": "Resource not found or foreign version membership",
            },
            409: {
                "model": APIErrorRead,
                "description": "Immutable version, stale revision or conflicting operation",
            },
            422: {
                "model": APIErrorRead,
                "description": "Invalid fields, flow issues or unacknowledged warnings",
            },
            503: {
                "model": APIErrorRead,
                "description": "SQLite busy; Retry-After header gives retry delay",
            },
        },
    )
    researcher_dependencies = [Depends(researcher)]

    @app.middleware("http")
    async def bounded_asset_upload(request: Request, call_next):
        if request.method == "POST" and request.url.path.endswith("/assets"):
            size, chunks = 0, []
            async for chunk in request.stream():
                size += len(chunk)
                if size > MAX_BODY:
                    return Response(
                        status_code=413,
                        content='{"detail":"Asset upload exceeds 7 MiB request limit"}',
                        media_type="application/json",
                    )
                chunks.append(chunk)
            request._body = b"".join(chunks)
        return await call_next(request)

    @app.get("/health", response_model=HealthRead, tags=["operations"])
    def health(db: DB):
        try:
            revisions = db.scalars(text("SELECT version_num FROM alembic_version")).all()
            if revisions != [EXPECTED_REVISION]:
                raise HTTPException(503, "Database revision does not match this release")
        except OperationalError:
            raise HTTPException(503, "Database unavailable") from None
        return {"status": "ok"}

    @app.get(
        "/test-types",
        response_model=list[TestTypeRead],
        dependencies=researcher_dependencies,
        tags=["methods"],
    )
    def list_methods(db: DB):
        return list(db.scalars(select(TestType).order_by(TestType.id)))

    @app.get(
        "/test-types/{test_type_id}",
        response_model=TestTypeRead,
        dependencies=researcher_dependencies,
        tags=["methods"],
    )
    def get_method(test_type_id: str, db: DB):
        method = db.get(TestType, test_type_id)
        if not method:
            raise HTTPException(404, "Method not found")
        return method

    @app.post(
        "/studies",
        response_model=StudyRead,
        status_code=201,
        dependencies=researcher_dependencies,
        tags=["studies"],
    )
    def create_study(payload: StudyCreate, db: DB):
        study = Study(**payload.model_dump())
        db.add(study)
        db.flush()
        version = StudyVersion(
            study_id=study.id, version_number=1, title=study.title, description=study.description
        )
        db.add(version)
        commit(db)
        return StudyRead.model_validate(
            {
                **{key: getattr(study, key) for key in STUDY_FIELDS},
                "versions": [version],
            }
        )

    @app.post(
        "/studies/from-samples",
        response_model=StudyRead,
        status_code=201,
        dependencies=researcher_dependencies,
        tags=["studies"],
    )
    def create_study_from_samples(payload: StudyFromSamples, db: DB):
        study = Study(title=payload.title, description=payload.description)
        db.add(study)
        db.flush()
        version = StudyVersion(
            study_id=study.id, version_number=1, title=study.title, description=study.description
        )
        db.add(version)
        db.flush()
        lang = payload.language
        created = [
            Sample(study_version_id=version.id, **item.model_dump(exclude={"revision_hash"}))
            for item in payload.samples
        ]
        db.add_all(created)
        db.flush()
        version.form = {
            "schema_version": 2,
            "languages": [lang],
            "default_language": lang,
            "nodes": [],
        }
        children = []
        for position, item in enumerate(payload.methods):
            method = db.get(TestType, item.test_type_id)
            test = StudyTest(
                study_version_id=version.id,
                test_type_id=item.test_type_id,
                position=position,
                configuration=validate_test(item),
            )
            check_samples(db, version, test.test_type_id, test.configuration)
            db.add(test)
            db.flush()
            save_method_text(version, test, item)
            children.append(
                {
                    "id": str(uuid4()),
                    "kind": "embedded_method",
                    "title": {lang: method.name if method else item.test_type_id},
                    "data": {"study_test_id": test.id, "sample_binding": "current"},
                }
            )
        form = deepcopy(version.form)
        form["nodes"] = [
            {
                "id": str(uuid4()),
                "kind": "loop_samples",
                "title": {lang: "Samples"},
                "data": {"sample_ids": [s.id for s in created], "children": children},
            },
            {
                "id": str(uuid4()),
                "kind": "end",
                "title": {lang: "Finish"},
                "data": {"body": {lang: "Thank you for participating."}, "outcome": "completed"},
            },
        ]
        try:
            version.form = DraftFlowV2.model_validate(form).model_dump(mode="json")
        except ValidationError as exc:
            db.rollback()
            raise HTTPException(422, "The sample battery does not form a valid study") from exc
        commit(db)
        return StudyRead.model_validate(
            {
                **{key: getattr(study, key) for key in STUDY_FIELDS},
                "versions": [version],
            }
        )

    @app.get(
        "/studies",
        response_model=list[StudyRead],
        dependencies=researcher_dependencies,
        tags=["studies"],
    )
    def list_studies(
        db: DB,
        limit: Annotated[int, Query(ge=1, le=1000)] = 50,
        offset: Annotated[int, Query(ge=0)] = 0,
        search: Annotated[str, Query(max_length=250)] = "",
        archived: Literal["exclude", "only", "include"] = "exclude",
    ):
        statement = select(Study).order_by(Study.created_at.desc(), Study.id)
        if archived == "exclude":
            statement = statement.where(Study.archived_at.is_(None))
        elif archived == "only":
            statement = statement.where(Study.archived_at.is_not(None))
        if search.strip():
            statement = statement.where(Study.title.icontains(search.strip(), autoescape=True))
        selected = list(db.scalars(statement.limit(limit).offset(offset)))
        grouped = {study.id: [] for study in selected}
        for version in db.scalars(
            select(StudyVersion)
            .where(StudyVersion.study_id.in_(grouped))
            .order_by(StudyVersion.version_number)
        ):
            grouped[version.study_id].append(version)
        counts = open_counts(db, grouped)
        return [
            {
                **{key: getattr(study, key) for key in STUDY_FIELDS},
                "open_assessments": counts.get(study.id, 0),
                "versions": grouped[study.id],
            }
            for study in selected
        ]

    def study_read(db, study):
        return {
            **{key: getattr(study, key) for key in STUDY_FIELDS},
            "open_assessments": open_counts(db, [study.id]).get(study.id, 0),
            "versions": versions(db, study.id),
        }

    @app.post(
        "/studies/{study_id}/close",
        response_model=StudyRead,
        dependencies=researcher_dependencies,
        tags=["studies"],
    )
    def close_study(study_id: UUID, db: DB, payload: StudyClose | None = None):
        study = get_study(db, study_id)
        if study.closed_at:
            raise HTTPException(409, "Study is already closed")
        if study.status == "draft":
            raise HTTPException(409, "Only a released study can be closed")
        if payload and payload.end_open_assessments:
            for session in open_sessions(db, study.id):
                end_session(db, session)
        study.status = "closed"
        study.closed_at = timestamp()
        commit(db)
        return study_read(db, study)

    @app.post(
        "/studies/{study_id}/reopen",
        response_model=StudyRead,
        dependencies=researcher_dependencies,
        tags=["studies"],
    )
    def reopen_study(study_id: UUID, db: DB):
        study = get_study(db, study_id)
        if study.archived_at:
            raise HTTPException(409, "Restore this archived study first")
        if not study.closed_at:
            raise HTTPException(409, "Study is not closed")
        study.status = "active"
        study.closed_at = None
        commit(db)
        return study_read(db, study)

    @app.post(
        "/studies/{study_id}/archive",
        response_model=StudyRead,
        dependencies=researcher_dependencies,
        tags=["studies"],
    )
    def archive_study(study_id: UUID, db: DB):
        study = get_study(db, study_id)
        if study.archived_at:
            raise HTTPException(409, "Study is already archived")
        waiting = len(open_sessions(db, study.id))
        if waiting:
            raise HTTPException(
                409, f"End or finish the {waiting} assessment(s) in progress before archiving"
            )
        study.archived_at = timestamp()
        commit(db)
        return study_read(db, study)

    @app.post(
        "/studies/{study_id}/restore",
        response_model=StudyRead,
        dependencies=researcher_dependencies,
        tags=["studies"],
    )
    def restore_study(study_id: UUID, db: DB):
        study = get_study(db, study_id)
        if not study.archived_at:
            raise HTTPException(409, "Study is not archived")
        study.archived_at = None
        commit(db)
        return study_read(db, study)

    @app.post(
        "/sessions/{session_id}/end",
        response_model=SessionRead,
        dependencies=researcher_dependencies,
        tags=["sessions"],
    )
    def end_assessment(session_id: UUID, db: DB):
        """Staff end an open assessment; answers recorded before this moment can still sync."""
        session = db.get(AssessorSession, str(session_id))
        if not session:
            raise HTTPException(404, "Session not found")
        if session.status != "in_progress":
            raise HTTPException(409, "Only an assessment in progress can be ended")
        end_session(db, session)
        commit(db)
        return session

    @app.patch(
        "/studies/{study_id}",
        response_model=StudyRead,
        dependencies=researcher_dependencies,
        tags=["studies"],
    )
    def update_study(study_id: UUID, payload: StudyUpdate, db: DB):
        version = draft(db, study_id)
        if is_v2(version.form) or payload.revision_hash is not None:
            if str(payload.study_version_id) != version.id:
                raise HTTPException(409, "Metadata save requires the current draft ID")
            precondition(version, payload.revision_hash)
        version.revision += 1
        study = get_study(db, study_id)
        study.title = version.title = payload.title
        study.description = version.description = payload.description
        commit(db)
        return study_read(db, study)

    @app.get(
        "/studies/{study_id}",
        response_model=StudyRead,
        dependencies=researcher_dependencies,
        tags=["studies"],
    )
    def read_study(study_id: UUID, db: DB):
        return study_read(db, get_study(db, study_id))

    def owned_version(study_id, version_id, db):
        get_study(db, study_id)
        version = db.get(StudyVersion, str(version_id))
        if not version or version.study_id != str(study_id):
            raise HTTPException(404, "Study version not found")
        return version

    @app.get(
        "/studies/{study_id}/versions/{version_id}",
        response_model=VersionRead,
        dependencies=researcher_dependencies,
        tags=["studies"],
    )
    def read_version(study_id: UUID, version_id: UUID, db: DB):
        return owned_version(study_id, version_id, db)

    @app.get(
        "/studies/{study_id}/versions/{version_id}/assets",
        response_model=list[AssetRead],
        dependencies=researcher_dependencies,
        tags=["assets"],
    )
    def list_assets(study_id: UUID, version_id: UUID, db: DB):
        version = owned_version(study_id, version_id, db)
        return [asset_read(db, a) for a in version_assets(db, version.id)]

    @app.post(
        "/studies/{study_id}/versions/{version_id}/assets",
        response_model=AssetRead,
        status_code=201,
        dependencies=researcher_dependencies,
        tags=["assets"],
        responses={
            413: {"model": APIErrorRead, "description": "Upload exceeds 7 MiB request limit"}
        },
    )
    def upload_asset(
        study_id: UUID, version_id: UUID, payload: AssetUpload, request: Request, db: DB
    ):
        version = owned_version(study_id, version_id, db)
        precondition(version, payload.revision_hash)
        asset = store_upload(db, version, payload, storage_path(request.app.state.settings))
        commit(db)
        return asset_read(db, asset)

    def stimulus_response(db, asset, request):
        blob = db.get(AssetBlob, asset.sha256)
        return Response(
            verified_bytes(storage_path(request.app.state.settings), blob),
            media_type=blob.media_type,
            headers={
                "ETag": '"' + blob.sha256 + '"',
                "Cache-Control": "private, no-store",
                "X-Content-Type-Options": "nosniff",
            },
        )

    @app.get(
        "/studies/{study_id}/versions/{version_id}/assets/{asset_id}/content",
        dependencies=researcher_dependencies,
        tags=["assets"],
        response_class=Response,
        responses={
            200: {"content": {"image/png": {"schema": {"type": "string", "format": "binary"}}}}
        },
    )
    def researcher_asset(
        study_id: UUID, version_id: UUID, asset_id: UUID, request: Request, db: DB
    ):
        version = owned_version(study_id, version_id, db)
        asset = db.get(Asset, str(asset_id))
        if not asset or asset.study_version_id != version.id:
            raise HTTPException(404, "Image does not belong to this version")
        return stimulus_response(db, asset, request)

    @app.get(
        "/sessions/{session_id}/assets/{sha256}",
        tags=["tablets"],
        response_class=Response,
        responses={
            200: {"content": {"image/png": {"schema": {"type": "string", "format": "binary"}}}}
        },
    )
    def session_asset(
        sha256: Annotated[str, APIPath(pattern=r"^[a-f0-9]{64}$")],
        session: Assigned,
        request: Request,
        db: DB,
    ):
        version = db.get(StudyVersion, session.study_version_id)
        asset = next(
            (
                a
                for a in version_assets(db, version.id)
                if a.sha256 == sha256 and a.id in referenced_ids(version.form)
            ),
            None,
        )
        if not asset:
            raise HTTPException(404, "Image is not assigned to this session")
        return stimulus_response(db, asset, request)

    @app.patch(
        "/studies/{study_id}/versions/{version_id}",
        response_model=VersionRead,
        dependencies=researcher_dependencies,
        tags=["studies"],
    )
    def update_version(study_id: UUID, version_id: UUID, payload: VersionUpdate, db: DB):
        version = owned_version(study_id, version_id, db)
        precondition(version, payload.revision_hash)
        version.title = payload.title
        version.description = payload.description
        version.revision += 1
        study = get_study(db, study_id)
        study.title, study.description = payload.title, payload.description
        commit(db)
        return version

    @app.get(
        "/studies/{study_id}/versions/{version_id}/validation",
        response_model=ValidationReport,
        dependencies=researcher_dependencies,
        tags=["forms"],
    )
    def validate_version(study_id: UUID, version_id: UUID, db: DB):
        version = owned_version(study_id, version_id, db)
        if not is_v2(version.form):
            raise HTTPException(409, "Flow check requires a saved Flow v2")
        return report(db, version)

    @app.post(
        "/studies/{study_id}/drafts",
        response_model=VersionRead,
        status_code=201,
        dependencies=researcher_dependencies,
        tags=["studies"],
    )
    def create_draft(study_id: UUID, db: DB, payload: DraftCreate | None = None):
        study = get_study(db, study_id)
        if study.archived_at:
            raise HTTPException(409, "Restore this archived study before editing it")
        all_versions = versions(db, study.id)
        if any(version.published_at is None for version in all_versions):
            raise HTTPException(409, "A draft already exists")
        previous = all_versions[-1]
        version = StudyVersion(
            study_id=study.id,
            version_number=previous.version_number + 1,
            title=study.title,
            description=study.description,
        )
        db.add(version)
        db.flush()
        mapping = clone_content(db, previous, version)
        if is_v2(previous.form):
            pass
        elif payload and payload.convert_legacy_flow:
            try:
                legacy_form = previous.form or {
                    "schema_version": 1,
                    "steps": [
                        {
                            "id": f"method_{i}",
                            "kind": "test",
                            "title": f"Method {i + 1}",
                            "study_test_id": test.id,
                        }
                        for i, test in enumerate(tests(db, previous.id))
                    ],
                }
                version.form = convert_legacy(legacy_form, mapping, study.id)
            except (ValueError, ValidationError) as exc:
                raise HTTPException(422, str(exc)) from exc
        elif previous.form:
            version.form = deepcopy(previous.form)
            for step in version.form["steps"]:
                if step["kind"] == "test":
                    step["study_test_id"] = mapping[step["study_test_id"]]
        commit(db)
        db.refresh(version)
        return version

    @app.post(
        "/studies/{study_id}/samples",
        response_model=SampleRead,
        status_code=201,
        dependencies=researcher_dependencies,
        tags=["samples"],
    )
    def add_sample(study_id: UUID, payload: SampleCreate, db: DB):
        version = draft(db, study_id)
        if payload.revision_hash is not None:
            precondition(version, payload.revision_hash)
        sample = Sample(
            study_version_id=version.id, **payload.model_dump(exclude={"revision_hash"})
        )
        db.add(sample)
        commit(db)
        return sample

    @app.get(
        "/studies/{study_id}/versions/{version_id}/samples",
        response_model=list[SampleRead],
        dependencies=researcher_dependencies,
        tags=["samples"],
    )
    def list_samples(study_id: UUID, version_id: UUID, db: DB):
        get_study(db, study_id)
        version = db.get(StudyVersion, str(version_id))
        if not version or version.study_id != str(study_id):
            raise HTTPException(404, "Study version not found")
        return version_samples(db, version.id)

    @app.put(
        "/studies/{study_id}/versions/{version_id}/samples/{sample_id}",
        response_model=SampleRead,
        dependencies=researcher_dependencies,
        tags=["samples"],
    )
    def edit_sample(
        study_id: UUID, version_id: UUID, sample_id: UUID, payload: SampleUpdate, db: DB
    ):
        version = owned_version(study_id, version_id, db)
        precondition(version, payload.revision_hash)
        sample = db.get(Sample, str(sample_id))
        if not sample or sample.study_version_id != version.id:
            raise HTTPException(404, "Sample does not belong to this version")
        for key, value in payload.model_dump(exclude={"revision_hash"}).items():
            setattr(sample, key, value)
        commit(db)
        return sample

    @app.delete(
        "/studies/{study_id}/versions/{version_id}/samples/{sample_id}",
        status_code=204,
        dependencies=researcher_dependencies,
        tags=["samples"],
    )
    def delete_sample(
        study_id: UUID, version_id: UUID, sample_id: UUID, revision_hash: str, db: DB
    ):
        version = owned_version(study_id, version_id, db)
        precondition(version, revision_hash)
        sample = db.get(Sample, str(sample_id))
        if not sample or sample.study_version_id != version.id:
            raise HTTPException(404, "Sample does not belong to this version")
        if any(
            str(sample_id)
            in sample_ids(CONFIGURATIONS[t.test_type_id].model_validate(t.configuration))
            for t in tests(db, version.id)
        ):
            raise HTTPException(409, "Remove the sample from configured methods first")
        if is_v2(version.form) and any(
            n.kind in {"loop_samples", "serve_gate"} and sample_id in n.data.sample_ids
            for n in walk(DraftFlowV2.model_validate(version.form).nodes)
        ):
            raise HTTPException(409, "Remove the sample from its loop and design first")
        if any(str(sample_id) in d.settings["sample_ids"] for d in version_designs(db, version.id)):
            raise HTTPException(409, "Remove the sample design first")
        db.delete(sample)
        commit(db)

    @app.get(
        "/studies/{study_id}/versions/{version_id}/designs",
        response_model=list[DesignRead],
        dependencies=researcher_dependencies,
        tags=["designs"],
    )
    def list_designs(study_id: UUID, version_id: UUID, db: DB):
        version = owned_version(study_id, version_id, db)
        return version_designs(db, version.id)

    @app.post(
        "/studies/{study_id}/versions/{version_id}/designs",
        response_model=DesignRead,
        dependencies=researcher_dependencies,
        tags=["designs"],
    )
    def generate_design(study_id: UUID, version_id: UUID, payload: DesignGenerate, db: DB):
        version = owned_version(study_id, version_id, db)
        precondition(version, payload.revision_hash)
        design = generate(db, version, payload)
        commit(db)
        return design

    @app.delete(
        "/studies/{study_id}/versions/{version_id}/designs/{design_id}",
        status_code=204,
        dependencies=researcher_dependencies,
        tags=["designs"],
    )
    def delete_design(
        study_id: UUID, version_id: UUID, design_id: UUID, revision_hash: str, db: DB
    ):
        version = owned_version(study_id, version_id, db)
        precondition(version, revision_hash)
        design = db.get(StudyDesign, str(design_id))
        if not design or design.study_version_id != version.id:
            raise HTTPException(404, "Design does not belong to this version")
        db.delete(design)
        commit(db)

    @app.get(
        "/studies/{study_id}/versions/{version_id}/design-allocations",
        response_model=list[AllocationRead],
        dependencies=researcher_dependencies,
        tags=["designs"],
    )
    def list_allocations(
        study_id: UUID,
        version_id: UUID,
        db: DB,
        limit: Annotated[int, Query(ge=1, le=1000)] = 100,
        offset: Annotated[int, Query(ge=0)] = 0,
    ):
        version = owned_version(study_id, version_id, db)
        return list(
            db.scalars(
                select(DesignAllocation)
                .join(StudyDesign)
                .where(StudyDesign.study_version_id == version.id)
                .order_by(DesignAllocation.design_id, DesignAllocation.ordinal)
                .limit(limit)
                .offset(offset)
            )
        )

    @app.post(
        "/studies/{study_id}/versions/{version_id}/blinding",
        response_model=list[SampleRead],
        dependencies=researcher_dependencies,
        tags=["samples"],
    )
    def generate_blinding(study_id: UUID, version_id: UUID, payload: BlindingGenerate, db: DB):
        version = owned_version(study_id, version_id, db)
        precondition(version, payload.revision_hash)
        samples = blind_codes(db, version, payload.seed)
        commit(db)
        return samples

    def check_samples(db, version, method_id, configuration):
        try:
            validate_samples(
                db, version.id, CONFIGURATIONS[method_id].model_validate(configuration)
            )
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc

    def save_method_text(version, test, payload):
        if payload.method_text is None and (
            not is_v2(version.form) or "{{" not in json.dumps(test.configuration)
        ):
            return
        if not is_v2(version.form):
            raise HTTPException(409, "Method overlays require a saved Flow v2")
        form = deepcopy(version.form)
        if payload.method_text is not None:
            form.setdefault("method_text", {})[test.id] = payload.method_text
        form["text_version"] = 1
        version.form = DraftFlowV2.model_validate(form).model_dump(mode="json")
        version.revision += 1

    @app.post(
        "/studies/{study_id}/tests",
        response_model=TestRead,
        status_code=201,
        dependencies=researcher_dependencies,
        tags=["studies"],
    )
    def add_test(study_id: UUID, payload: TestCreate, db: DB):
        version = draft(db, study_id)
        if is_v2(version.form) or payload.revision_hash is not None:
            precondition(version, payload.revision_hash)
        test = StudyTest(
            study_version_id=version.id,
            test_type_id=payload.test_type_id,
            position=len(tests(db, version.id)),
            configuration=validate_test(payload),
        )
        check_samples(db, version, test.test_type_id, test.configuration)
        db.add(test)
        db.flush()
        save_method_text(version, test, payload)
        commit(db)
        return test

    @app.get(
        "/studies/{study_id}/versions/{version_id}/tests",
        response_model=list[TestRead],
        dependencies=researcher_dependencies,
        tags=["studies"],
    )
    def read_tests(study_id: UUID, version_id: UUID, db: DB):
        get_study(db, study_id)
        version = db.get(StudyVersion, str(version_id))
        if not version or version.study_id != str(study_id):
            raise HTTPException(404, "Study version not found")
        return tests(db, version.id)

    @app.put(
        "/studies/{study_id}/tests/{test_id}",
        response_model=TestRead,
        dependencies=researcher_dependencies,
        tags=["studies"],
    )
    def replace_test(study_id: UUID, test_id: UUID, payload: TestCreate, db: DB):
        version = draft(db, study_id)
        test = db.get(StudyTest, str(test_id))
        if not test or test.study_version_id != version.id:
            raise HTTPException(409, "Only tests in the current draft can be edited")
        if is_v2(version.form) or payload.revision_hash is not None:
            precondition(version, payload.revision_hash)
        test.configuration = validate_test(payload)
        test.test_type_id = payload.test_type_id
        check_samples(db, version, test.test_type_id, test.configuration)
        save_method_text(version, test, payload)
        commit(db)
        return test

    @app.delete(
        "/studies/{study_id}/tests/{test_id}",
        status_code=204,
        dependencies=researcher_dependencies,
        tags=["studies"],
    )
    def remove_test(study_id: UUID, test_id: UUID, db: DB, revision_hash: str | None = None):
        version = draft(db, study_id)
        if is_v2(version.form) or revision_hash is not None:
            precondition(version, revision_hash)
        test = db.get(StudyTest, str(test_id))
        if not test or test.study_version_id != version.id:
            raise HTTPException(409, "Only tests in the current draft can be removed")
        if is_v2(version.form) and any(
            str(n.data.study_test_id) == test.id
            for n in walk(VersionRead.model_validate(version).form.nodes)
            if isinstance(n, MethodNode)
        ):
            raise HTTPException(409, "Remove the method node and save the flow first")
        if (
            version.form
            and not is_v2(version.form)
            and any(step.get("study_test_id") == test.id for step in version.form["steps"])
        ):
            raise HTTPException(
                409, "Remove this test's block from the session flow and save the flow first"
            )
        if is_v2(version.form):
            form = deepcopy(version.form)
            form.get("method_text", {}).pop(test.id, None)
            version.form = form
            version.revision += 1
        db.delete(test)
        db.flush()
        # Flush each ascending shift separately to avoid transient position uniqueness collisions.
        for position, remaining in enumerate(tests(db, version.id)):
            remaining.position = position
            db.flush()
        commit(db)
        return Response(status_code=204)

    @app.post(
        "/studies/{study_id}/publish",
        response_model=VersionRead,
        dependencies=researcher_dependencies,
        tags=["studies"],
    )
    def publish(study_id: UUID, db: DB, payload: PublishRequest | None = None):
        version = draft(db, study_id)
        if is_v2(version.form):
            if payload is None or str(payload.study_version_id) != version.id:
                raise HTTPException(
                    409, "Flow v2 publication requires the reviewed version and hash"
                )
            precondition(version, payload.revision_hash)
            validation = report(db, version)
            if not validation["valid"]:
                raise HTTPException(422, validation["issues"])
            warnings = {i["code"] for i in validation["issues"] if i["severity"] == "warning"}
            if warnings - set(payload.acknowledged_warning_codes):
                raise HTTPException(
                    422, "Acknowledge all reviewed warning codes before publication"
                )
        configured = tests(db, version.id)
        if not configured and not version.form:
            raise HTTPException(422, "A study must contain at least one configured test")
        for test in configured:
            if test.test_type_id == "tcata-v1" and not is_v2(version.form):
                raise HTTPException(422, "TCATA requires a validated v2 flow")
            try:
                parsed_config = CONFIGURATIONS[test.test_type_id].model_validate(test.configuration)
                validate_samples(db, version.id, parsed_config)
            except (KeyError, ValueError) as exc:
                raise HTTPException(422, "Study contains an invalid method configuration") from exc
        if version.form and not is_v2(version.form):
            try:
                validate_form_tests(
                    StudyForm.model_validate(version.form), {test.id for test in configured}
                )
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from exc
        for asset in version_assets(db, version.id):
            if asset.id in referenced_ids(version.form):
                verified_bytes(storage_path(db.info["settings"]), db.get(AssetBlob, asset.sha256))
        version.published_at = timestamp()
        get_study(db, study_id).status = "active"
        commit(db)
        return version

    @app.put(
        "/studies/{study_id}/versions/{version_id}/form",
        response_model=VersionRead,
        dependencies=researcher_dependencies,
        tags=["forms"],
    )
    def save_form(study_id: UUID, version_id: UUID, payload: FormUpdate, db: DB):
        version = draft(db, study_id)
        if version.id != str(version_id):
            raise HTTPException(409, "Only the current draft's session flow can be edited")
        if is_v2(version.form) or (payload.form and payload.form.schema_version == 2):
            precondition(version, payload.revision_hash)
        apply_form(version, payload, db)
        commit(db)
        return version

    def apply_form(version, payload, db):
        if payload.form and payload.form.schema_version == 2:
            validate_references(db, version, payload.form)
            if (
                len(payload.form.languages) > 1
                or payload.form.method_text
                or "{{"
                in json.dumps(
                    {
                        "flow": payload.form.model_dump(mode="json"),
                        "configurations": [t.configuration for t in tests(db, version.id)],
                    }
                )
            ):
                payload.form.text_version = 1
            if (
                is_v2(version.form)
                and payload.form.default_language != version.form["default_language"]
            ):
                previous_language = version.form["default_language"]
                for test in tests(db, version.id):
                    overlays = payload.form.method_text.setdefault(UUID(test.id), {})
                    for pointer, original in method_fields(test.configuration).items():
                        localized = overlays.get(pointer, {})
                        if not localized.get(payload.form.default_language, "").strip():
                            raise HTTPException(
                                422,
                                [
                                    {
                                        "loc": [
                                            "body",
                                            "form",
                                            "method_text",
                                            test.id,
                                            pointer,
                                            payload.form.default_language,
                                        ],
                                        "msg": "Review the new default-language method text first",
                                        "type": "missing_translation",
                                    }
                                ],
                            )
                        overlays[pointer] = {**localized, previous_language: original}
                    try:
                        test.configuration = (
                            CONFIGURATIONS[test.test_type_id]
                            .model_validate(
                                localized_configuration(
                                    test.configuration, overlays, payload.form.default_language
                                )
                            )
                            .model_dump(mode="json")
                        )
                    except (KeyError, ValueError) as exc:
                        raise HTTPException(
                            422, "New default-language method configuration is invalid"
                        ) from exc
        elif payload.form:
            refs = {step.study_test_id for step in payload.form.steps if isinstance(step, TestStep)}
            if not refs <= {test.id for test in tests(db, version.id)}:
                raise HTTPException(422, "Flow references a test outside this draft version")
        version.form = payload.form.model_dump(mode="json") if payload.form else None
        version.revision += 1

    @app.post(
        "/study-templates",
        response_model=TemplateRead,
        status_code=201,
        dependencies=researcher_dependencies,
        tags=["studies"],
    )
    def create_template(payload: TemplateCreate, request: Request, db: DB):
        source = db.get(StudyVersion, str(payload.source_version_id))
        if not source or not source.published_at:
            raise HTTPException(422, "Templates require a reviewed published version")
        template = StudyTemplate(
            **payload.model_dump(mode="json"),
            principal="researcher-key:"
            + digest(request.app.state.settings.researcher_token.get_secret_value())[:16],
        )
        db.add(template)
        commit(db)
        return template

    @app.get(
        "/study-templates",
        response_model=list[TemplateRead],
        dependencies=researcher_dependencies,
        tags=["studies"],
    )
    def list_templates(
        db: DB,
        limit: Annotated[int, Query(ge=1, le=100)] = 50,
        offset: Annotated[int, Query(ge=0)] = 0,
    ):
        return list(
            db.scalars(
                select(StudyTemplate)
                .order_by(StudyTemplate.created_at.desc(), StudyTemplate.id)
                .limit(limit)
                .offset(offset)
            )
        )

    @app.get(
        "/study-templates/{template_id}/form",
        response_model=FlowV2,
        dependencies=researcher_dependencies,
        tags=["studies"],
    )
    def template_form(template_id: UUID, db: DB):
        template = db.get(StudyTemplate, str(template_id))
        if not template:
            raise HTTPException(404, "Template not found")
        source = db.get(StudyVersion, template.source_version_id)
        if not source or not source.published_at or not is_v2(source.form):
            raise HTTPException(422, "Questionnaire blocks require a published Flow v2 template")
        return source.form

    ordinary_kinds = {"group", "info", "consent", "confirm", "question", "matrix_question"}

    @app.post(
        "/questionnaire-items",
        response_model=QuestionnaireItemRead,
        status_code=201,
        dependencies=researcher_dependencies,
        tags=["studies"],
    )
    def create_questionnaire_item(payload: QuestionnaireItemCreate, request: Request, db: DB):
        try:
            flow = DraftFlowV2.model_validate(
                {
                    "schema_version": 2,
                    "text_version": payload.text_version,
                    "languages": payload.languages,
                    "default_language": payload.default_language,
                    "nodes": [payload.node],
                }
            )
        except ValueError as error:
            raise HTTPException(422, "The step is not a valid questionnaire step") from error
        node = flow.nodes[0]
        if any(n.kind not in ordinary_kinds for n in walk([node])):
            raise HTTPException(
                422, "Only questions, information, consent and confirm steps can be saved"
            )
        item = QuestionnaireItem(
            name=payload.name,
            kind=node.kind,
            languages=payload.languages,
            default_language=payload.default_language,
            text_version=payload.text_version,
            node=node.model_dump(mode="json"),
            principal="researcher-key:"
            + digest(request.app.state.settings.researcher_token.get_secret_value())[:16],
        )
        db.add(item)
        commit(db)
        return item

    @app.get(
        "/questionnaire-items",
        response_model=list[QuestionnaireItemRead],
        dependencies=researcher_dependencies,
        tags=["studies"],
    )
    def list_questionnaire_items(
        db: DB,
        include_archived: bool = False,
        limit: Annotated[int, Query(ge=1, le=200)] = 100,
        offset: Annotated[int, Query(ge=0)] = 0,
    ):
        query = select(QuestionnaireItem)
        if not include_archived:
            query = query.where(QuestionnaireItem.archived_at.is_(None))
        return list(
            db.scalars(
                query.order_by(QuestionnaireItem.created_at.desc(), QuestionnaireItem.id)
                .limit(limit)
                .offset(offset)
            )
        )

    @app.post(
        "/questionnaire-items/{item_id}/archive",
        response_model=QuestionnaireItemRead,
        dependencies=researcher_dependencies,
        tags=["studies"],
    )
    def archive_questionnaire_item(item_id: UUID, db: DB):
        item = db.get(QuestionnaireItem, str(item_id))
        if not item:
            raise HTTPException(404, "Item not found")
        if item.archived_at is None:
            item.archived_at = timestamp()
            commit(db)
        return item

    @app.post(
        "/studies/duplicate",
        response_model=StudyRead,
        status_code=201,
        dependencies=researcher_dependencies,
        tags=["studies"],
    )
    def duplicate_study(payload: StudyDuplicate, request: Request, db: DB):
        source = db.get(StudyVersion, str(payload.source_version_id))
        if not source or not source.published_at:
            raise HTTPException(
                422,
                "Duplicate a published version; "
                "review wording, restrictions, codes and translations",
            )
        study = Study(title=payload.title, description=payload.description)
        db.add(study)
        db.flush()
        version = StudyVersion(
            study_id=study.id, version_number=1, title=study.title, description=study.description
        )
        db.add(version)
        db.flush()
        mapping = clone_content(db, source, version)
        if source.form and not is_v2(source.form):
            version.form = deepcopy(source.form)
            for step in version.form["steps"]:
                if step["kind"] == "test":
                    step["study_test_id"] = mapping[step["study_test_id"]]
        db.info["draft_audit"] = {
            "study_id": study.id,
            "principal": "researcher-key:"
            + digest(request.app.state.settings.researcher_token.get_secret_value())[:16],
            "action": "duplicate:" + source.id,
            "before": {},
        }
        commit(db)
        return {
            "id": study.id,
            "title": study.title,
            "description": study.description,
            "status": study.status,
            "created_at": study.created_at,
            "versions": [version],
        }

    @app.get(
        "/studies/{study_id}/versions/{version_id}/audit",
        response_model=list[DraftAuditRead],
        dependencies=researcher_dependencies,
        tags=["studies"],
    )
    def draft_history(
        study_id: UUID,
        version_id: UUID,
        db: DB,
        limit: Annotated[int, Query(ge=1, le=100)] = 50,
        offset: Annotated[int, Query(ge=0)] = 0,
    ):
        owned_version(study_id, version_id, db)
        return list(
            db.scalars(
                select(DraftAudit)
                .where(DraftAudit.study_version_id == str(version_id))
                .order_by(DraftAudit.recorded_at.desc(), DraftAudit.id)
                .limit(limit)
                .offset(offset)
            )
        )

    @app.put(
        "/studies/{study_id}/versions/{version_id}/draft",
        response_model=VersionRead,
        dependencies=researcher_dependencies,
        tags=["studies"],
    )
    def save_draft(study_id: UUID, version_id: UUID, payload: DraftSave, db: DB):
        version = owned_version(study_id, version_id, db)
        precondition(version, payload.revision_hash)
        if version.form and not is_v2(version.form):
            raise HTTPException(409, "Convert legacy drafts explicitly before aggregate editing")
        ids = [str(t.id) for t in payload.tests]
        if len(set(ids)) != len(ids):
            raise HTTPException(422, "Duplicate test IDs")
        current = tests(db, version.id)
        allowed = {t.id for t in current}
        for history in db.scalars(
            select(DraftAudit).where(DraftAudit.study_version_id == version.id)
        ):
            allowed.update(t["id"] for t in history.snapshot["tests"])
        if not set(ids) <= allowed:
            raise HTTPException(
                422, "Only this draft's existing or previously deleted tests can be restored"
            )
        for test in current:
            db.delete(test)
        db.flush()
        for position, item in enumerate(payload.tests):
            existing = db.get(StudyTest, str(item.id))
            if existing:
                raise HTTPException(422, "Test belongs to another version")
            configuration = validate_test(
                TestCreate(test_type_id=item.test_type_id, configuration=item.configuration)
            )
            check_samples(db, version, item.test_type_id, configuration)
            db.add(
                StudyTest(
                    id=str(item.id),
                    study_version_id=version.id,
                    test_type_id=item.test_type_id,
                    position=position,
                    configuration=configuration,
                )
            )
        db.flush()
        version.title, version.description = payload.title, payload.description
        study = get_study(db, study_id)
        study.title, study.description = payload.title, payload.description
        apply_form(version, FormUpdate(form=payload.form), db)
        commit(db)
        return version

    @app.post(
        "/terminals",
        response_model=TerminalRegistered,
        status_code=201,
        dependencies=researcher_dependencies,
        tags=["terminals"],
    )
    def register_terminal(payload: TerminalCreate, request: Request, db: DB):
        release_removed_names(db)
        if db.scalar(select(Terminal.id).where(Terminal.name == payload.name.strip())):
            raise HTTPException(409, "Terminal name already registered")
        token = secrets.token_urlsafe(32)
        terminal = Terminal(name=payload.name.strip(), token_hash=digest(token))
        db.add(terminal)
        db.flush()
        audit(
            db,
            terminal,
            "registered",
            payload.staff_name,
            payload.reason,
            "researcher:"
            + digest(request.app.state.settings.researcher_token.get_secret_value())[:16],
        )
        commit(db)
        return TerminalRegistered(**terminal_read(db, terminal).model_dump(), terminal_token=token)

    def staff_principal(request: Request) -> str:
        return (
            "researcher:"
            + digest(request.app.state.settings.researcher_token.get_secret_value())[:16]
        )

    def known_booth(db: Session, booth_id: UUID | None) -> str | None:
        if booth_id and not db.get(BoothIdentity, str(booth_id)):
            raise HTTPException(422, "Unknown booth")
        return str(booth_id) if booth_id else None

    def booth_in_use(db: Session, booth_id: str | None, own_id: str | None = None):
        if booth_id and db.scalar(
            select(Terminal.id).where(
                Terminal.booth_id == booth_id,
                Terminal.retired_at.is_(None),
                Terminal.id != (own_id or ""),
            )
        ):
            raise HTTPException(409, "Booth already has a tablet")

    redeem_failures: list[float] = []

    @app.get(
        "/terminals/network-address",
        response_model=NetworkAddress,
        dependencies=researcher_dependencies,
        tags=["terminals"],
    )
    def network_address(request: Request):
        """The server's laboratory-network address, for pairing links opened from localhost."""
        address = request.app.state.settings.lan_address.strip()
        loopback = not address or address == "localhost" or address.startswith(("127.", "::1"))
        return NetworkAddress(address=None if loopback else address)

    @app.post(
        "/terminals/pairings",
        response_model=PairingIssued,
        status_code=201,
        dependencies=researcher_dependencies,
        tags=["terminals"],
    )
    def issue_pairing(payload: PairingCreate, request: Request, db: DB):
        booth_id = known_booth(db, payload.booth_id)
        booth_in_use(db, booth_id)
        code = new_pairing_code()
        pairing = TerminalPairing(
            code_hash=digest(code),
            staff_name=payload.staff_name,
            principal=staff_principal(request),
            booth_id=booth_id,
            expires_at=pairing_expiry(),
        )
        db.add(pairing)
        commit(db)
        return PairingIssued(
            id=pairing.id, code=code, expires_at=pairing.expires_at, booth_id=booth_id
        )

    @app.get(
        "/terminals/pairings/{pairing_id}",
        response_model=PairingStatus,
        dependencies=researcher_dependencies,
        tags=["terminals"],
    )
    def pairing_status(pairing_id: UUID, db: DB):
        pairing = db.get(TerminalPairing, str(pairing_id))
        if not pairing:
            raise HTTPException(404, "Pairing not found")
        terminal = db.get(Terminal, pairing.terminal_id) if pairing.terminal_id else None
        if terminal:
            return PairingStatus(
                id=pairing.id, status="paired", terminal=terminal_read(db, terminal)
            )
        expired = datetime.fromisoformat(pairing.expires_at) <= datetime.now(UTC)
        return PairingStatus(
            id=pairing.id, status="expired" if expired else "waiting", terminal=None
        )

    @app.post(
        "/terminal-pairings/redeem",
        response_model=PairingRedeemed,
        tags=["tablets"],
    )
    def redeem_pairing(payload: PairingRedeem, db: DB):
        now = time.monotonic()
        redeem_failures[:] = [t for t in redeem_failures if now - t < 60]
        if len(redeem_failures) >= 10:
            raise HTTPException(429, "Too many pairing attempts; wait a minute")
        pairing = db.scalar(
            select(TerminalPairing).where(
                TerminalPairing.code_hash == digest(normalise_code(payload.code))
            )
        )
        if (
            not pairing
            or pairing.redeemed_at
            or datetime.fromisoformat(pairing.expires_at) <= datetime.now(UTC)
        ):
            redeem_failures.append(now)
            raise HTTPException(404, "Pairing code is invalid, used or expired")
        try:
            booth_in_use(db, pairing.booth_id)
        except HTTPException:
            pairing.booth_id = None
        token = secrets.token_urlsafe(32)
        terminal = Terminal(
            name=next_terminal_name(db), token_hash=digest(token), booth_id=pairing.booth_id
        )
        db.add(terminal)
        db.flush()
        pairing.redeemed_at, pairing.terminal_id = timestamp(), terminal.id
        audit(
            db,
            terminal,
            "registered",
            pairing.staff_name,
            "Paired with one-time code",
            pairing.principal,
        )
        commit(db)
        return PairingRedeemed(terminal_id=terminal.id, name=terminal.name, terminal_token=token)

    @app.put(
        "/terminals/{terminal_id}/booth",
        response_model=TerminalRead,
        dependencies=researcher_dependencies,
        tags=["terminals"],
    )
    def link_terminal_booth(
        terminal_id: UUID, payload: TerminalBoothLink, request: Request, db: DB
    ):
        terminal = checked_terminal(db, str(terminal_id), payload.expected_revision)
        booth_id = known_booth(db, payload.booth_id)
        booth_in_use(db, booth_id, terminal.id)
        terminal.booth_id = booth_id
        terminal.revision += 1
        audit(
            db,
            terminal,
            "booth_linked",
            payload.staff_name,
            payload.reason,
            staff_principal(request),
        )
        commit(db)
        return terminal_read(db, terminal)

    @app.get(
        "/terminals",
        response_model=list[TerminalRead],
        dependencies=researcher_dependencies,
        tags=["terminals"],
    )
    def list_terminals(
        db: DB,
        limit: Annotated[int, Query(ge=1, le=1000)] = 50,
        offset: Annotated[int, Query(ge=0)] = 0,
        retired: Literal["exclude", "include"] = "include",
    ):
        statement = select(Terminal).order_by(Terminal.name, Terminal.id)
        if retired == "exclude":
            statement = statement.where(Terminal.retired_at.is_(None))
        return [
            terminal_read(db, terminal)
            for terminal in db.scalars(statement.limit(limit).offset(offset))
        ]

    @app.post(
        "/terminals/{terminal_id}/assignments",
        response_model=TerminalRead,
        dependencies=researcher_dependencies,
        tags=["terminals"],
    )
    def assign_terminal(terminal_id: UUID, payload: TerminalAssign, request: Request, db: DB):
        terminal = checked_terminal(db, str(terminal_id), payload.expected_revision)
        assign_session(
            db,
            terminal,
            str(payload.session_id),
            payload.staff_name,
            payload.reason,
            "researcher:"
            + digest(request.app.state.settings.researcher_token.get_secret_value())[:16],
        )
        commit(db)
        return terminal_read(db, terminal)

    @app.post(
        "/terminals/{terminal_id}/next-assessment",
        response_model=TerminalRead,
        dependencies=researcher_dependencies,
        tags=["terminals"],
    )
    def next_assessment(terminal_id: UUID, payload: NextAssessment, request: Request, db: DB):
        """Continue the tablet's study: new session, tablet (and booth) assignment, one step."""
        terminal = checked_terminal(db, str(terminal_id), payload.expected_revision)
        previous = current_assignment(db, terminal.id)
        old = db.get(AssessorSession, previous.session_id) if previous else None
        if old and old.status == "in_progress":
            raise HTTPException(409, "The current assessment is still in progress")
        version_id = str(payload.study_version_id) if payload.study_version_id else None
        if not old and not version_id:
            raise HTTPException(409, "Choose a released study for the first assessment")
        version = db.get(StudyVersion, version_id or old.study_version_id)
        if not version or not version.published_at:
            raise HTTPException(422, "Assessments require a released study version")
        used = set(
            db.scalars(
                select(AssessorSession.assessor_code).where(
                    AssessorSession.study_version_id == version.id
                )
            )
        )
        code = payload.assessor_code
        if not code:
            n = len(used) + 1
            while f"A{n:03d}" in used:
                n += 1
            code = f"A{n:03d}"
        language = (
            old.context.get("language") if old and old.study_version_id == version.id else None
        )
        session, _ = new_session(
            db, version, code, SessionContext(language=language) if language else None
        )
        principal = staff_principal(request)
        assign_session(db, terminal, session.id, payload.staff_name, payload.reason, principal)
        from sensibilia.booths import follow_booth

        follow_booth(db, terminal, old, session, payload.staff_name, payload.reason, principal)
        commit(db)
        return terminal_read(db, terminal)

    @app.post(
        "/terminals/{terminal_id}/retire",
        response_model=TerminalRead,
        dependencies=researcher_dependencies,
        tags=["terminals"],
    )
    def retire_terminal(terminal_id: UUID, payload: TerminalChange, request: Request, db: DB):
        terminal = checked_terminal(db, str(terminal_id), payload.expected_revision)
        previous = current_assignment(db, terminal.id)
        terminal.retired_at = timestamp()
        terminal.revision += 1
        release_name(terminal)
        if previous:
            previous.released_at = terminal.retired_at
            from sensibilia.booths import active_assignment, cancel_assignment

            booth = active_assignment(db, previous.session_id)
            if booth:
                cancel_assignment(
                    db,
                    booth,
                    "researcher:"
                    + digest(request.app.state.settings.researcher_token.get_secret_value())[:16],
                    "terminal retired",
                )
        audit(
            db,
            terminal,
            "retired",
            payload.staff_name,
            payload.reason,
            "researcher:"
            + digest(request.app.state.settings.researcher_token.get_secret_value())[:16],
            previous.session_id if previous else None,
        )
        commit(db)
        return terminal_read(db, terminal)

    @app.get(
        "/terminals/{terminal_id}/audit",
        response_model=list[TerminalAuditRead],
        dependencies=researcher_dependencies,
        tags=["terminals"],
    )
    def terminal_audit(
        terminal_id: UUID,
        db: DB,
        limit: Annotated[int, Query(ge=1, le=1000)] = 100,
        offset: Annotated[int, Query(ge=0)] = 0,
    ):
        if not db.get(Terminal, str(terminal_id)):
            raise HTTPException(404, "Terminal not found")
        return list(
            db.scalars(
                select(TerminalAudit)
                .where(TerminalAudit.terminal_id == str(terminal_id))
                .order_by(TerminalAudit.recorded_at, TerminalAudit.id)
                .limit(limit)
                .offset(offset)
            )
        )

    @app.get("/terminals/{terminal_id}/assignment", response_model=TerminalTask, tags=["tablets"])
    def terminal_task(
        terminal_id: UUID, db: DB, credentials: Annotated[Credentials, Depends(session_bearer)]
    ):
        terminal = db.get(Terminal, str(terminal_id))
        if (
            not credentials
            or not terminal
            or terminal.retired_at
            or not secrets.compare_digest(digest(credentials.credentials), terminal.token_hash)
        ):
            raise HTTPException(
                401, "Active terminal credential required", headers={"WWW-Authenticate": "Bearer"}
            )
        assigned = current_assignment(db, terminal.id)
        return TerminalTask(
            terminal_id=terminal.id,
            revision=terminal.revision,
            session_id=assigned.session_id if assigned else None,
        )

    def new_session(
        db: Session, version: StudyVersion, assessor_code: str, context_in: SessionContext | None
    ):
        if not version or not version.published_at:
            raise HTTPException(422, "Sessions require an existing published study version")
        study = db.get(Study, version.study_id)
        if study.archived_at or study.closed_at:
            raise HTTPException(
                409, "This study is closed or archived; reopen it to start new assessments"
            )
        context = {}
        if is_v2(version.form):
            language = context_in.language if context_in else version.form["default_language"]
            if language not in version.form["languages"]:
                raise HTTPException(422, "Session language is not declared by this version")
            context = (
                context_in.model_dump(mode="json", exclude_none=True)
                if context_in
                else {"language": language}
            )
        token = secrets.token_urlsafe(32)
        session = AssessorSession(
            id=identifier(),
            study_version_id=version.id,
            assessor_code=assessor_code,
            token_hash=hashlib.sha256(token.encode()).hexdigest(),
            context=context,
            loop_assignments=[],
            presentation_order=[test.id for test in tests(db, version.id)],
        )
        if is_v2(version.form):
            with db.no_autoflush:
                session.loop_assignments = allocate(db, version, session)
        db.add(session)
        db.flush()
        provision_assignments(db, session, tests(db, version.id))
        return session, token

    @app.post(
        "/sessions",
        response_model=SessionProvisioned,
        status_code=201,
        dependencies=researcher_dependencies,
        tags=["sessions"],
    )
    def provision(payload: SessionCreate, db: DB):
        session, token = new_session(
            db,
            db.get(StudyVersion, str(payload.study_version_id)),
            payload.assessor_code,
            payload.context,
        )
        commit(db)
        return SessionProvisioned(
            **SessionRead.model_validate(session).model_dump(), session_token=token
        )

    @app.get(
        "/studies/{study_id}/versions/{version_id}/sessions",
        response_model=list[SessionRead],
        dependencies=researcher_dependencies,
        tags=["sessions"],
    )
    def list_sessions(
        study_id: UUID,
        version_id: UUID,
        db: DB,
        status: Annotated[
            str | None, Query(pattern="^(in_progress|completed|screened_out|ended)$")
        ] = None,
        limit: Annotated[int, Query(ge=1, le=1000)] = 50,
        offset: Annotated[int, Query(ge=0)] = 0,
    ):
        get_study(db, study_id)
        version = db.get(StudyVersion, str(version_id))
        if not version or version.study_id != str(study_id):
            raise HTTPException(404, "Version does not belong to this study")
        statement = select(AssessorSession).where(AssessorSession.study_version_id == version.id)
        if status:
            statement = statement.where(AssessorSession.status == status)
        return list(
            db.scalars(
                statement.order_by(AssessorSession.started_at, AssessorSession.id)
                .limit(limit)
                .offset(offset)
            )
        )

    @app.post(
        "/sessions/{session_id}/path-events",
        response_model=PathBatchAcknowledgement,
        tags=["tablets"],
    )
    def ingest_path(payload: PathBatch, session: Assigned, db: DB):
        if not is_v2(db.get(StudyVersion, session.study_version_id).form):
            raise HTTPException(409, "Path events require Flow v2")
        acknowledgements = []
        rows = collected_path(db, session)
        for event in payload.events:
            data = event.model_dump(mode="json")
            data["recorded_at"] = event.recorded_at.astimezone(UTC).isoformat()
            existing = next(
                (r for r in rows if r.client_event_id == data["client_event_id"]), None
            ) or db.scalar(
                select(PathEvent).where(PathEvent.client_event_id == data["client_event_id"])
            )
            if existing:
                if existing.session_id != session.id or any(
                    getattr(existing, k) != v for k, v in data.items()
                ):
                    raise HTTPException(409, "Event ID already exists with different data")
                acknowledgements.append(
                    PathAcknowledgement(
                        client_event_id=existing.client_event_id,
                        path_event_id=existing.id or "",
                        status="duplicate",
                    )
                )
                continue
            if any(
                db.scalar(
                    select(model.client_event_id).where(
                        model.client_event_id == data["client_event_id"]
                    )
                )
                for model in (Observation, FormEvent, TemporalRun, TemporalEvent)
            ):
                raise HTTPException(409, "Event ID already exists with different data")
            if not accepts_events(session, event.recorded_at):
                raise HTTPException(409, "Session is closed; only exact retries are accepted")
            if event.seq != len(rows) + 1:
                raise HTTPException(422, "Path sequence must be contiguous")
            row = PathEvent(session_id=session.id, **data)
            rows.append(row)
            acknowledgements.append(
                PathAcknowledgement(
                    client_event_id=row.client_event_id, path_event_id="", status="accepted"
                )
            )
        # Whole-batch replay includes staged answers and all proposed audit events.
        replay(db, session, rows)
        for row in rows:
            if row not in db:
                db.add(row)
        db.flush()
        for ack in acknowledgements:
            ack.path_event_id = next(r.id for r in rows if r.client_event_id == ack.client_event_id)
        commit(db)
        return PathBatchAcknowledgement(events=acknowledgements, next_seq=len(rows) + 1)

    @app.get(
        "/sessions/{session_id}/serving-plan",
        response_model=list[ServingPlan],
        dependencies=researcher_dependencies,
        tags=["sessions"],
    )
    def serving_plan(session_id: UUID, db: DB):
        session = db.get(AssessorSession, str(session_id))
        if not session:
            raise HTTPException(404, "Session not found")
        return [
            {"study_test_id": row.study_test_id, **row.plan}
            for row in db.scalars(
                select(SessionTestAssignment).where(SessionTestAssignment.session_id == session.id)
            )
        ]

    @app.get("/sessions/{session_id}/test", response_model=PackageRead, tags=["tablets"])
    def package(session: Assigned, db: DB):
        configured = tests(db, session.study_version_id)
        method_ids = {test.test_type_id for test in configured}
        version = db.get(StudyVersion, session.study_version_id)
        flow_v2 = is_v2(version.form)
        from sensibilia.booths import active_assignment, assignment_read

        serving = active_assignment(db, session.id)
        return PackageRead(
            assets=[
                AssetManifest.model_validate(
                    asset_read(db, a, f"/sessions/{session.id}/assets/{a.sha256}").model_dump(
                        exclude={"name", "created_at"}
                    )
                )
                for a in version_assets(db, version.id)
                if a.id in referenced_ids(version.form)
            ],
            serving_assignment=assignment_read(serving) if serving else None,
            flow=version.form if flow_v2 else None,
            evaluator_version=(
                "assets-v2.10"
                if flow_v2 and referenced_ids(version.form)
                else "temporal-v2.9"
                if flow_v2 and "tcata-v1" in method_ids
                else "methods-v2.8"
                if flow_v2 and any(t.test_type_id != "hedonic-9-v1" for t in configured)
                else "serving-v2.7"
                if flow_v2
                and any(
                    n.kind == "serve_gate"
                    for n in walk(DraftFlowV2.model_validate(version.form).nodes)
                )
                else "designs-v2.6"
                if flow_v2 and any(a.get("design_id") for a in session.loop_assignments)
                else "text-v2.5"
                if flow_v2 and version.form.get("text_version") == 1
                else "samples-v2.3"
                if flow_v2 and session.loop_assignments
                else "guards-v2.2"
                if flow_v2
                and any(
                    n.kind not in {"embedded_method", "end"}
                    or n.guard
                    or n.otherwise.action != "continue"
                    for n in walk(DraftFlowV2.model_validate(version.form).nodes)
                )
                else "linear-v2.1"
                if flow_v2
                else None
            ),
            revision_hash=version.revision_hash if flow_v2 else None,
            context=session.context,
            loop_assignments=session.loop_assignments,
            package_schema_version=4
            if flow_v2
            else 3
            if any(test.test_type_id != "hedonic-9-v1" for test in configured)
            else 2
            if assigned_form(db, session)
            else 1,
            session=SessionRead.model_validate(session),
            study_version=VersionRead.model_validate(
                db.get(StudyVersion, session.study_version_id)
            ),
            tests=[TestRead.model_validate(test) for test in configured],
            assignments=[
                public_assignment(row)
                for row in db.scalars(
                    select(SessionTestAssignment).where(
                        SessionTestAssignment.session_id == session.id
                    )
                )
            ],
            samples=[
                {"id": sample.id, "code": sample.code}
                for sample in version_samples(db, session.study_version_id)
                if any(
                    sample.id
                    in sample_ids(
                        CONFIGURATIONS[test.test_type_id].model_validate(test.configuration)
                    )
                    for test in configured
                    if test.test_type_id not in {"triangle-v1", "duo-trio-v1", "two-afc-v1"}
                )
            ],
            test_types=[
                TestTypeRead.model_validate(db.get(TestType, method_id))
                for method_id in sorted(method_ids)
            ],
        )

    @app.get("/sessions/{session_id}/progress", response_model=ProgressRead, tags=["tablets"])
    def session_progress(session: Assigned, db: DB):
        if is_v2(db.get(StudyVersion, session.study_version_id).form):
            return progress_v2(db, session)
        form = assigned_form(db, session)
        if not form:
            raise HTTPException(
                409, "This legacy session uses sequential tests, without form blocks"
            )
        return read_progress(db, session, form)

    @app.post(
        "/sessions/{session_id}/form-events",
        response_model=BatchAcknowledgement,
        tags=["tablets"],
    )
    def ingest_form(payload: FormBatch, session: Assigned, db: DB):
        if is_v2(db.get(StudyVersion, session.study_version_id).form):
            return ingest_v2_form(payload, session, db)
        form = assigned_form(db, session)
        if not form:
            raise HTTPException(409, "No form is assigned to this session")
        if any(
            e.occurrence_id is not None
            or e.sample_id is not None
            or e.supersedes_event_id is not None
            for e in payload.events
        ):
            raise HTTPException(422, "Occurrence fields require Flow v2")
        acknowledgements = []
        for event in payload.events:
            data = event.model_dump(mode="json")
            data["recorded_at"] = event.recorded_at.astimezone(UTC).isoformat()
            existing = db.scalar(
                select(FormEvent).where(FormEvent.client_event_id == data["client_event_id"])
            )
            if existing:
                if existing.session_id != session.id or any(
                    getattr(existing, key) != value for key, value in data.items()
                ):
                    raise HTTPException(409, "Event ID already exists with different data")
                acknowledgements.append(
                    EventAcknowledgement(
                        client_event_id=existing.client_event_id,
                        response_id=existing.id,
                        status="duplicate",
                    )
                )
                continue
            if db.scalar(
                select(Observation.id).where(Observation.client_event_id == data["client_event_id"])
            ):
                raise HTTPException(409, "Event ID already exists with different data")
            if not accepts_events(session, event.recorded_at):
                raise HTTPException(409, "Session is closed; only exact retries are accepted")
            current = read_progress(db, session, form).current_step_id
            if event.step_id != current:
                raise HTTPException(409, "Submit only the current step on the assigned route")
            step = next(step for step in form.steps if step.id == current)
            try:
                validate_value(step, event.value)
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from exc
            if isinstance(step, TestStep) and not test_complete(
                db, session.id, db.get(StudyTest, step.study_test_id)
            ):
                raise HTTPException(422, "Required test questions are still unanswered")
            submission = FormEvent(session_id=session.id, **data)
            db.add(submission)
            db.flush()
            acknowledgements.append(
                EventAcknowledgement(
                    client_event_id=submission.client_event_id,
                    response_id=submission.id,
                    status="accepted",
                )
            )
        commit(db)
        return BatchAcknowledgement(events=acknowledgements)

    def ingest_v2_form(payload: FormBatch, session: AssessorSession, db: Session):
        acknowledgements = []
        for event in payload.events:
            data = event.model_dump(mode="json")
            data["recorded_at"] = event.recorded_at.astimezone(UTC).isoformat()
            existing = db.scalar(
                select(FormEvent).where(FormEvent.client_event_id == data["client_event_id"])
            )
            if existing:
                if existing.session_id != session.id or any(
                    getattr(existing, k) != v for k, v in data.items()
                ):
                    raise HTTPException(409, "Event ID already exists with different data")
                acknowledgements.append(
                    EventAcknowledgement(
                        client_event_id=existing.client_event_id,
                        response_id=existing.id,
                        status="duplicate",
                    )
                )
                continue
            if any(
                db.scalar(
                    select(model.client_event_id).where(
                        model.client_event_id == data["client_event_id"]
                    )
                )
                for model in (Observation, PathEvent, TemporalRun, TemporalEvent)
            ):
                raise HTTPException(409, "Event ID already exists with different data")
            state = current_for_write(
                db, session, event.step_id, event.occurrence_id, data["sample_id"]
            )
            if state["node"].kind == "embedded_method" or event.supersedes_event_id:
                raise HTTPException(
                    422, "Method answers use responses; advanced answers are immutable"
                )
            try:
                validate_answer(state["node"], data["value"], state["variables"])
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from exc
            node = state["node"]
            if (
                node.kind == "serve_gate"
                and node.data.require_staff_delivery
                and data["value"].get("mode") == "served"
                and not db.scalar(
                    select(ServingSignal.id).where(
                        ServingSignal.session_id == session.id,
                        ServingSignal.step_id == str(event.step_id),
                        ServingSignal.occurrence_id == event.occurrence_id,
                        ServingSignal.state == "served",
                    )
                )
            ):
                raise HTTPException(422, "Staff must mark these samples delivered first")
            if db.scalar(
                select(FormEvent.id).where(
                    FormEvent.session_id == session.id,
                    FormEvent.step_id == event.step_id,
                    FormEvent.occurrence_id == event.occurrence_id,
                )
            ):
                raise HTTPException(
                    409, "Occurrence answer already saved; retry its original event ID"
                )
            row = FormEvent(session_id=session.id, **data)
            db.add(row)
            db.flush()
            acknowledgements.append(
                EventAcknowledgement(
                    client_event_id=row.client_event_id, response_id=row.id, status="accepted"
                )
            )
        commit(db)
        return BatchAcknowledgement(events=acknowledgements)

    @app.post(
        "/sessions/{session_id}/responses", response_model=BatchAcknowledgement, tags=["tablets"]
    )
    def ingest(payload: ResponseBatch, session: Assigned, db: DB):
        acknowledgements = []
        for event in payload.events:
            data = event.model_dump(mode="json")
            data["recorded_at"] = event.recorded_at.astimezone(UTC).isoformat()
            existing = db.scalar(
                select(Observation).where(Observation.client_event_id == data["client_event_id"])
            )
            if existing:
                if existing.session_id != session.id or any(
                    getattr(existing, key) != value for key, value in data.items()
                ):
                    raise HTTPException(409, "Event ID already exists with different data")
                acknowledgements.append(
                    EventAcknowledgement(
                        client_event_id=existing.client_event_id,
                        response_id=existing.id,
                        status="duplicate",
                    )
                )
                continue
            if any(
                db.scalar(
                    select(model.client_event_id).where(
                        model.client_event_id == data["client_event_id"]
                    )
                )
                for model in (FormEvent, PathEvent, TemporalRun, TemporalEvent)
            ):
                raise HTTPException(409, "Event ID already exists with different data")
            if not accepts_events(session, event.recorded_at):
                raise HTTPException(409, "Session is complete; only exact retries are accepted")
            test = db.get(StudyTest, data["study_test_id"])
            if not test or test.study_version_id != session.study_version_id:
                raise HTTPException(422, "Test does not belong to the assigned study version")
            v2 = is_v2(db.get(StudyVersion, session.study_version_id).form)
            if v2:
                state = current_for_write(
                    db, session, data["step_id"], event.occurrence_id, data["sample_id"]
                )
                node = state["node"]
                if (
                    node.kind != "embedded_method"
                    or str(node.data.study_test_id) != test.id
                    or event.supersedes_event_id
                ):
                    raise HTTPException(
                        422,
                        "Response must match the assigned method; advanced answers are immutable",
                    )
            elif event.step_id is not None or event.occurrence_id is not None:
                raise HTTPException(422, "Occurrence fields require Flow v2")
            form = None if v2 else assigned_form(db, session)
            if form:
                current = read_progress(db, session, form).current_step_id
                step = next((step for step in form.steps if step.id == current), None)
                if not isinstance(step, TestStep) or step.study_test_id != test.id:
                    raise HTTPException(
                        409, "This test is not the current step on the assigned route"
                    )
            assignment = assignment_for(db, session.id, test.id)
            try:
                validate_observation(
                    test.test_type_id,
                    test.configuration,
                    event.question_id,
                    None
                    if v2
                    and (
                        test.test_type_id == "hedonic-9-v1"
                        or (
                            "questions" in test.configuration
                            and not test.configuration.get("sample_ids")
                        )
                    )
                    else data["sample_id"],
                    data["value"],
                    assignment.plan if assignment else None,
                )
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from exc
            previous = list(
                db.scalars(
                    select(Observation).where(
                        Observation.session_id == session.id,
                        Observation.study_test_id == test.id,
                        Observation.question_id == event.question_id,
                        Observation.sample_id == data["sample_id"],
                        Observation.occurrence_id == data["occurrence_id"],
                    )
                )
            )
            superseded = {row.supersedes_event_id for row in previous}
            current = next((row for row in previous if row.client_event_id not in superseded), None)
            if current:
                if data["supersedes_event_id"] != current.client_event_id:
                    raise HTTPException(409, "Corrections must reference the current event ID")
            elif data["supersedes_event_id"] is not None:
                raise HTTPException(409, "There is no current event to correct")
            observation = Observation(session_id=session.id, **data)
            db.add(observation)
            db.flush()
            acknowledgements.append(
                EventAcknowledgement(
                    client_event_id=observation.client_event_id,
                    response_id=observation.id,
                    status="accepted",
                )
            )
        commit(db)  # Never acknowledge an event before the whole batch commits.
        return BatchAcknowledgement(events=acknowledgements)

    @app.post(
        "/sessions/{session_id}/temporal-runs",
        response_model=BatchAcknowledgement,
        tags=["tablets"],
    )
    def ingest_temporal(payload: TemporalBatch, session: Assigned, db: DB):
        from sensibilia.temporal import ingest as ingest_runs

        events = ingest_runs(db, session, payload)
        commit(db)
        return BatchAcknowledgement(events=events)

    @app.post("/sessions/{session_id}/complete", response_model=SessionRead, tags=["tablets"])
    def complete(session: Assigned, db: DB):
        if session.status in {"completed", "screened_out", "ended"}:
            return session
        v2 = is_v2(db.get(StudyVersion, session.study_version_id).form)
        if v2:
            outcome = progress_v2(db, session).outcome
            if outcome is None:
                raise HTTPException(422, "The audited assigned flow is not finished")
            session.status = outcome
            session.completed_at = timestamp()
            from sensibilia.booths import active_assignment, cancel_assignment

            assignment = active_assignment(db, session.id)
            if assignment:
                cancel_assignment(db, assignment, "session:" + session.id, "assessment ended")
            commit(db)
            return session
        form = assigned_form(db, session)
        if form:
            outcome = read_progress(db, session, form).outcome
            if outcome is None:
                raise HTTPException(422, "The assigned session flow is not finished")
            session.status = outcome
        else:
            for test in tests(db, session.study_version_id):
                if not test_complete(db, session.id, test):
                    raise HTTPException(422, "Required questions are still unanswered")
            session.status = "completed"
        session.completed_at = timestamp()
        commit(db)
        return session

    @app.get(
        "/studies/{study_id}/responses",
        response_model=list[ObservationRead],
        dependencies=researcher_dependencies,
        tags=["exports"],
    )
    def read_responses(
        study_id: UUID,
        db: DB,
        study_version_id: UUID | None = None,
        limit: Annotated[int, Query(ge=1, le=1000)] = 100,
        offset: Annotated[int, Query(ge=0)] = 0,
    ):
        get_study(db, study_id)
        if study_version_id is not None:
            owned_version(study_id, study_version_id, db)
        return [
            observation_read(row)
            for row in response_rows(
                db,
                str(study_id),
                limit,
                offset,
                str(study_version_id) if study_version_id else None,
            )
        ]

    @app.get(
        "/studies/{study_id}/form-responses",
        response_model=list[FormEventRead],
        dependencies=researcher_dependencies,
        tags=["exports"],
    )
    def read_form_responses(
        study_id: UUID,
        db: DB,
        study_version_id: UUID | None = None,
        limit: Annotated[int, Query(ge=1, le=1000)] = 100,
        offset: Annotated[int, Query(ge=0)] = 0,
    ):
        get_study(db, study_id)
        if study_version_id is not None:
            owned_version(study_id, study_version_id, db)
        return [
            FormEventRead(
                **{
                    column.name: getattr(event, column.name)
                    for column in FormEvent.__table__.columns
                },
                study_version_id=version.id,
                version_number=version.version_number,
                assessor_code=session.assessor_code,
            )
            for event, session, version in form_rows(
                db,
                str(study_id),
                limit,
                offset,
                str(study_version_id) if study_version_id else None,
            )
        ]

    @app.get(
        "/studies/{study_id}/path-events",
        response_model=list[PathEventRead],
        dependencies=researcher_dependencies,
        tags=["exports"],
    )
    def read_path_events(
        study_id: UUID,
        db: DB,
        study_version_id: UUID | None = None,
        limit: Annotated[int, Query(ge=1, le=1000)] = 100,
        offset: Annotated[int, Query(ge=0)] = 0,
    ):
        get_study(db, study_id)
        if study_version_id is not None:
            owned_version(study_id, study_version_id, db)
        return [
            path_read(row)
            for row in path_rows(
                db,
                str(study_id),
                limit,
                offset,
                str(study_version_id) if study_version_id else None,
            )
        ]

    @app.get(
        "/studies/{study_id}/data",
        response_model=list[DataRowRead],
        dependencies=researcher_dependencies,
        tags=["exports"],
    )
    def read_data(
        study_id: UUID,
        db: DB,
        study_version_id: UUID | None = None,
        limit: Annotated[int, Query(ge=1, le=1000)] = 100,
        offset: Annotated[int, Query(ge=0)] = 0,
    ):
        from itertools import islice

        get_study(db, study_id)
        if study_version_id is not None:
            owned_version(study_id, study_version_id, db)
        return list(
            islice(
                data_rows(db, str(study_id), str(study_version_id) if study_version_id else None),
                offset,
                offset + limit,
            )
        )

    @app.get(
        "/studies/{study_id}/export",
        dependencies=researcher_dependencies,
        tags=["exports"],
        response_class=Response,
        responses={
            200: {
                "content": {"text/csv": {}},
                "description": (
                    "Long ledger, keyed wide CSV or R-ready CSV (format=r: one plain value per "
                    "cell, current answers by default); all history by default for long and wide"
                ),
            }
        },
    )
    def export(
        study_id: UUID,
        db: DB,
        study_version_id: UUID | None = None,
        format: Literal["long", "wide", "r"] = "long",
        history: Literal["all", "current"] | None = None,
    ):
        get_study(db, study_id)
        if study_version_id is not None:
            owned_version(study_id, study_version_id, db)
        history_r = history or "current"
        history = history or "all"
        if format == "wide":
            dictionary, rows = checked_wide(db, study_id, study_version_id, history)
            from sensibilia.export_service import wide_csv

            return Response(
                wide_csv(dictionary, rows),
                media_type="text/csv",
                headers={
                    "Content-Disposition": f'attachment; filename="{study_id}-wide-{history}.csv"'
                },
            )
        if format == "r":
            from sensibilia.export_service import r_csv

            return Response(
                r_csv(
                    data_rows(
                        db, str(study_id), str(study_version_id) if study_version_id else None
                    ),
                    history_r,
                ),
                media_type="text/csv",
                headers={"Content-Disposition": f'attachment; filename="{study_id}-r.csv"'},
            )
        from sensibilia.export_service import long_csv

        return Response(
            long_csv(
                data_rows(db, str(study_id), str(study_version_id) if study_version_id else None),
                history,
            ),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{study_id}.csv"'},
        )

    def checked_wide(db, study_id, version_id, history):
        from sensibilia.wide_export import wide_data

        try:
            return wide_data(
                db,
                str(study_id),
                str(version_id) if version_id else None,
                ExportOptions(format="wide", history=history),
            )
        except ValueError as error:
            raise HTTPException(422, str(error)) from error

    @app.get(
        "/studies/{study_id}/export/dictionary",
        response_model=ExportDictionaryRead,
        dependencies=researcher_dependencies,
        tags=["exports"],
    )
    def export_dictionary(
        study_id: UUID,
        db: DB,
        study_version_id: UUID | None = None,
        history: Literal["all", "current"] = "all",
    ):
        get_study(db, study_id)
        if study_version_id is not None:
            owned_version(study_id, study_version_id, db)
        # This is a live read, not an immutable dataset snapshot.
        return checked_wide(db, study_id, study_version_id, history)[0]

    from sensibilia.snapshots import register_snapshot_routes

    register_snapshot_routes(
        app, DB, researcher_dependencies, get_study, owned_version, package, commit
    )
    from sensibilia.analysis.routes import register_analysis_routes

    register_analysis_routes(
        app, DB, researcher_dependencies, get_study, owned_version, package, commit
    )

    # Runtime errors are part of the transport contract, including string and field 422s.
    from fastapi.routing import APIRoute

    for route in app.routes:
        if isinstance(route, APIRoute) and route.path != "/health":
            for status in (401, 404, 409, 503):
                route.responses.setdefault(
                    status,
                    {
                        "description": {
                            401: "Credential required",
                            404: "Resource not found",
                            409: "Immutable or stale revision",
                            503: "Database busy; Retry-After",
                        }[status]
                    },
                )
            route.responses[422] = {
                "description": "Validation error (field list or global string)",
                "content": {
                    "application/json": {
                        "schema": {
                            "type": "object",
                            "properties": {
                                "detail": {
                                    "anyOf": [
                                        {"type": "string"},
                                        {"type": "array", "items": {"type": "object"}},
                                    ]
                                }
                            },
                        }
                    }
                },
            }

    frontend = (
        (
            settings.root
            if settings
            else Path(os.getenv("SENSIBILIA_ROOT", Path(__file__).resolve().parents[2]))
        )
        / "frontend"
        / "dist"
    )
    if frontend.is_dir():

        @app.get("/operator", include_in_schema=False)
        @app.get("/operator/", include_in_schema=False)
        def operator_shell():
            return FileResponse(frontend / "index.html", headers={"Cache-Control": "no-cache"})

        class ResearcherFiles(StaticFiles):
            async def get_response(self, path, scope):
                path = path.replace("\\", "/")
                try:
                    response = await super().get_response(path, scope)
                    if response.media_type == "text/html":
                        response.headers["Cache-Control"] = "no-cache"
                    return response
                except StarletteHTTPException as exc:
                    if exc.status_code == 404 and (
                        path == ""
                        or path == "rooms"
                        or path == "terminals"
                        or path == "templates"
                        or path == "methods"
                        or path.startswith("methods/")
                        or path == "studies"
                        or path.startswith("studies/")
                    ):
                        response = await super().get_response("index.html", scope)
                        response.headers["Cache-Control"] = "no-cache"
                        return response
                    raise

        app.mount("/researcher", ResearcherFiles(directory=frontend, html=True), name="researcher")

        class AssessorFiles(StaticFiles):
            async def get_response(self, path, scope):
                path = path.replace("\\", "/")
                if path in {"sw.js", "manifest.webmanifest", "icon.svg"} or (
                    path.endswith(".png") and path.startswith(("icon-", "apple-touch-icon"))
                ):
                    response = await super().get_response("assessor/" + path, scope)
                    response.headers["Cache-Control"] = "no-cache"
                    return response
                if path.startswith("sessions/") or path in {"", "index.html", "pair"}:
                    response = await super().get_response("index.html", scope)
                    response.headers["Cache-Control"] = "no-cache"
                    return response
                return await super().get_response(path, scope)

        app.mount("/assessor", AssessorFiles(directory=frontend, html=True), name="assessor")
    from sensibilia.booths import install

    app.state.operations_process = identifier()
    install(app, database, researcher, assigned_session, commit)
    return app
