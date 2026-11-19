"""Consistent immutable exports. The API records jobs; it never executes scripts."""

import base64
import hashlib
import io
import zipfile
from collections import Counter
from pathlib import Path
from typing import Annotated, Literal
from uuid import UUID

from fastapi import HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import StringConstraints, computed_field
from sqlalchemy import select

from sensibilia.assets import storage_path, verified_bytes, version_assets
from sensibilia.data_service import canonical, data_rows
from sensibilia.drafts import snapshot
from sensibilia.export_service import long_csv, wide_csv
from sensibilia.methods import StrictModel
from sensibilia.models import (
    AnalysisJob,
    AssessorSession,
    AssetBlob,
    DatasetSnapshot,
    FormEvent,
    Observation,
    PathEvent,
    StudyTest,
    StudyVersion,
    TemporalEvent,
    TemporalRun,
    TestType,
    identifier,
    timestamp,
)
from sensibilia.schemas import ExportOptions, ORMModel
from sensibilia.wide_export import LIMITS, pivot

Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
MAX_BYTES = 64 * 1024 * 1024
RECIPE = "ledger-state-census-v1"
RECIPE_PATH = Path(__file__).with_name("analysis_recipe.py")


def sha(content):
    return hashlib.sha256(content).hexdigest()


class SnapshotCreate(StrictModel):
    label: Text
    staff_name: Text
    study_version_id: UUID | None = None
    history: Literal["all", "current"] = "all"


class FileDigest(StrictModel):
    sha256: str
    byte_size: int
    encoding: Literal["utf8", "base64"]


class SnapshotManifest(StrictModel):
    snapshot_id: str
    label: str
    staff_name: str
    principal: str
    schema_version: Literal[1] = 1
    study_id: str
    study_version_id: str | None
    created_at: str
    history: Literal["all", "current"]
    row_count: int
    session_count: int
    event_counts: dict[str, int]
    row_kinds: dict[str, int]
    states: dict[str, int]
    dataset_sha256: str
    files: dict[str, FileDigest]
    state_policy: str
    exclusion_policy: str
    limitations: list[str]


class SnapshotRead(ORMModel):
    id: str
    study_id: str
    study_version_id: str | None
    label: str
    staff_name: str
    principal: str
    created_at: str
    manifest: SnapshotManifest

    @computed_field
    @property
    def manifest_sha256(self) -> str:
        return sha(canonical(self.manifest.model_dump(mode="json")).encode())


class JobCreate(StrictModel):
    staff_name: Text
    recipe: Literal["ledger-state-census-v1"] = RECIPE


class JobCancel(StrictModel):
    staff_name: Text


class JobRead(ORMModel):
    id: str
    snapshot_id: str
    recipe: str
    recipe_sha256: str
    staff_name: str
    principal: str
    created_at: str
    status: Literal["queued", "running", "succeeded", "failed", "cancelled"]
    started_at: str | None
    finished_at: str | None
    image: str | None
    result: dict | None
    result_sha256: str | None
    error: str | None


def principal(request):
    return (
        "researcher-key:"
        + sha(request.app.state.settings.researcher_token.get_secret_value().encode())[:16]
    )


def model_data(record):
    return {
        c.name: getattr(record, c.name) for c in record.__table__.columns if c.name != "token_hash"
    }


def make_snapshot(db, study, payload, package, snapshot_id, actor):
    budget = 0

    def account(value):
        nonlocal budget
        budget += len(canonical(value).encode())
        if budget > MAX_BYTES:
            raise HTTPException(422, "Snapshot source content exceeds 64 MiB limit")

    vid = str(payload.study_version_id) if payload.study_version_id else None
    versions = list(
        db.scalars(
            select(StudyVersion)
            .where(StudyVersion.study_id == study.id, StudyVersion.published_at.is_not(None))
            .order_by(StudyVersion.version_number)
        )
    )
    if vid:
        versions = [v for v in versions if v.id == vid]
    if not versions:
        raise HTTPException(409, "Snapshots require a published version")
    version_ids = [v.id for v in versions]
    sessions = list(
        db.scalars(
            select(AssessorSession)
            .where(AssessorSession.study_version_id.in_(version_ids))
            .order_by(AssessorSession.started_at, AssessorSession.id)
            .limit(LIMITS["sessions"] + 1)
        )
    )
    if len(sessions) > LIMITS["sessions"]:
        raise HTTPException(422, "Snapshot session limit exceeded")
    records = []
    for r in data_rows(db, study.id, vid):
        if len(records) >= LIMITS["records"]:
            raise HTTPException(422, "Snapshot record limit exceeded")
        account(r.model_dump(mode="json"))
        records.append(r)
    selected = [r for r in records if payload.history == "all" or r.is_current is not False]
    by_version = {v.id: v for v in versions}
    identities = [
        dict(
            study_id=study.id,
            study_version_id=s.study_version_id,
            version_number=by_version[s.study_version_id].version_number,
            session_id=s.id,
            assessor_code=s.assessor_code,
        )
        for s in sessions
    ]
    try:
        dictionary, wide = pivot(
            records,
            identities,
            study.id,
            vid,
            ExportOptions(format="wide", history=payload.history),
        )
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    ids = [s.id for s in sessions]
    ledgers = {}
    for model in (Observation, FormEvent, PathEvent, TemporalRun, TemporalEvent):
        query = (
            select(model)
            .join(TemporalRun)
            .where(TemporalRun.session_id.in_(ids))
            .order_by(model.client_event_id)
            if model is TemporalEvent
            else select(model).where(model.session_id.in_(ids)).order_by(model.id)
        ).limit(LIMITS["records"] + 1)
        ledger = []
        for r in db.scalars(query).yield_per(100):
            if len(ledger) >= LIMITS["records"]:
                raise HTTPException(422, "Snapshot atomic ledger limit exceeded")
            value = model_data(r)
            account(value)
            ledger.append(value)
        ledgers[model.__tablename__] = ledger
    packages = []
    for s in sessions:
        value = package(s, db).model_dump(mode="json")
        account(value)
        packages.append(value)
    methods = sorted(
        {
            t.test_type_id
            for v in versions
            for t in db.scalars(select(StudyTest).where(StudyTest.study_version_id == v.id))
        }
    )
    provenance = dict(
        study=model_data(study),
        versions=[
            dict(
                id=v.id,
                version_number=v.version_number,
                published_at=v.published_at,
                revision_hash=v.revision_hash,
                configuration=snapshot(db, v),
            )
            for v in versions
        ],
        methods=[model_data(db.get(TestType, m)) for m in methods],
        packages=[dict(sha256=sha(canonical(p).encode()), package=p) for p in packages],
        ledgers=ledgers,
    )
    files = {
        "dataset.json": canonical([r.model_dump(mode="json") for r in selected]),
        "provenance.json": canonical(provenance),
        "long.csv": long_csv(records, payload.history),
        "wide.csv": wide_csv(dictionary, wide),
        "dictionary.json": canonical(dictionary.model_dump(mode="json")),
    }
    encodings = {name: "utf8" for name in files}
    for v in versions:
        for asset in version_assets(db, v.id):
            name = "assets/" + asset.sha256 + ".png"
            files[name] = base64.b64encode(
                verified_bytes(storage_path(db.info["settings"]), db.get(AssetBlob, asset.sha256))
            ).decode()
            encodings[name] = "base64"
    if len(canonical(files).encode()) > MAX_BYTES:
        raise HTTPException(422, "Snapshot exceeds 64 MiB encoded archive limit")
    digests = {
        name: FileDigest(
            sha256=sha(decode(content, encodings[name])),
            byte_size=len(decode(content, encodings[name])),
            encoding=encodings[name],
        )
        for name, content in files.items()
    }
    manifest = SnapshotManifest(
        snapshot_id=snapshot_id,
        label=payload.label,
        staff_name=payload.staff_name,
        principal=actor,
        study_id=study.id,
        study_version_id=vid,
        created_at=timestamp(),
        history=payload.history,
        row_count=len(selected),
        session_count=len(sessions),
        event_counts={k: len(v) for k, v in ledgers.items()},
        row_kinds=dict(Counter(r.row_kind for r in selected)),
        states=dict(Counter(r.state or "null" for r in selected)),
        dataset_sha256=digests["dataset.json"].sha256,
        files=digests,
        state_policy=dictionary.state_policy,
        exclusion_policy=(
            "No participant or sample exclusions; current omits only superseded projected rows. "
            "Raw atomic ledgers always retain all history."
        ),
        limitations=[
            "Expected missing is an expectation, not proof of presentation.",
            "Physical/deployment/usability/parallel-system acceptance remains independent.",
            (
                "Runtime container/image provenance describes analysis execution, "
                "not the historical collection deployment."
            ),
        ],
    )
    return files, manifest


def decode(content, encoding):
    return (
        base64.b64decode(content, validate=True)
        if encoding == "base64"
        else content.encode("utf-8")
    )


def verified_file(item, name):
    entry = item.manifest["files"][name]
    content = decode(item.files[name], entry["encoding"])
    if len(content) != entry["byte_size"] or sha(content) != entry["sha256"]:
        raise HTTPException(503, "Snapshot checksum mismatch")
    return content


def register_snapshot_routes(app, DB, dependencies, get_study, owned_version, package, commit):
    def owned(study_id, snapshot_id, db):
        get_study(db, study_id)
        item = db.get(DatasetSnapshot, str(snapshot_id))
        if not item or item.study_id != str(study_id):
            raise HTTPException(404, "Snapshot not found")
        return item

    def owned_job(study_id, snapshot_id, job_id, db):
        owned(study_id, snapshot_id, db)
        job = db.get(AnalysisJob, str(job_id))
        if not job or job.snapshot_id != str(snapshot_id):
            raise HTTPException(404, "Job not found")
        return job

    base = "/studies/{study_id}/snapshots"

    @app.post(
        base,
        response_model=SnapshotRead,
        status_code=201,
        dependencies=dependencies,
        tags=["snapshots"],
    )
    def create(study_id: UUID, payload: SnapshotCreate, request: Request, db: DB):
        study = get_study(db, study_id)
        if payload.study_version_id:
            v = owned_version(study_id, payload.study_version_id, db)
            if not v.published_at:
                raise HTTPException(409, "Snapshots require a published version")
        snapshot_id, actor = identifier(), principal(request)
        files, manifest = make_snapshot(db, study, payload, package, snapshot_id, actor)
        item = DatasetSnapshot(
            id=snapshot_id,
            study_id=str(study_id),
            study_version_id=manifest.study_version_id,
            label=payload.label,
            staff_name=payload.staff_name,
            principal=actor,
            created_at=manifest.created_at,
            manifest=manifest.model_dump(mode="json"),
            files=files,
        )
        db.add(item)
        commit(db)
        return item

    @app.get(base, response_model=list[SnapshotRead], dependencies=dependencies, tags=["snapshots"])
    def listing(
        study_id: UUID,
        db: DB,
        limit: Annotated[int, Query(ge=1, le=100)] = 50,
        offset: Annotated[int, Query(ge=0)] = 0,
    ):
        get_study(db, study_id)
        return list(
            db.scalars(
                select(DatasetSnapshot)
                .where(DatasetSnapshot.study_id == str(study_id))
                .order_by(DatasetSnapshot.created_at.desc(), DatasetSnapshot.id)
                .limit(limit)
                .offset(offset)
            )
        )

    @app.get(
        base + "/{snapshot_id}",
        response_model=SnapshotRead,
        dependencies=dependencies,
        tags=["snapshots"],
    )
    def read(study_id: UUID, snapshot_id: UUID, db: DB):
        return owned(study_id, snapshot_id, db)

    @app.get(
        base + "/{snapshot_id}/export",
        response_class=Response,
        dependencies=dependencies,
        tags=["snapshots"],
        responses={
            200: {
                "content": {"text/csv": {}, "application/zip": {}},
                "description": "Frozen CSV or complete checksum archive",
            }
        },
    )
    def download(
        study_id: UUID,
        snapshot_id: UUID,
        db: DB,
        format: Literal["long", "wide", "archive"] = "archive",
    ):
        item = owned(study_id, snapshot_id, db)
        if format != "archive":
            return Response(
                verified_file(item, format + ".csv"),
                media_type="text/csv",
                headers={
                    "Content-Disposition": f'attachment; filename="{snapshot_id}-{format}.csv"'
                },
            )
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for name in sorted(item.files):
                archive.writestr(
                    zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0)),
                    verified_file(item, name),
                )
            archive.writestr(
                zipfile.ZipInfo("manifest.sha256", date_time=(1980, 1, 1, 0, 0, 0)),
                (sha(canonical(item.manifest).encode()) + "  manifest.json\n").encode(),
            )
            archive.writestr(
                zipfile.ZipInfo("manifest.json", date_time=(1980, 1, 1, 0, 0, 0)),
                canonical(item.manifest).encode(),
            )
        return Response(
            output.getvalue(),
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{snapshot_id}.zip"'},
        )

    @app.post(
        base + "/{snapshot_id}/jobs",
        response_model=JobRead,
        status_code=201,
        dependencies=dependencies,
        tags=["analysis"],
    )
    def queue(study_id: UUID, snapshot_id: UUID, payload: JobCreate, request: Request, db: DB):
        owned(study_id, snapshot_id, db)
        job = AnalysisJob(
            id=identifier(),
            snapshot_id=str(snapshot_id),
            recipe=payload.recipe,
            recipe_sha256=sha(RECIPE_PATH.read_bytes()),
            staff_name=payload.staff_name,
            principal=principal(request),
            created_at=timestamp(),
            status="queued",
        )
        db.add(job)
        commit(db)
        return job

    @app.get(
        base + "/{snapshot_id}/jobs",
        response_model=list[JobRead],
        dependencies=dependencies,
        tags=["analysis"],
    )
    def jobs(
        study_id: UUID,
        snapshot_id: UUID,
        db: DB,
        limit: Annotated[int, Query(ge=1, le=100)] = 50,
        offset: Annotated[int, Query(ge=0)] = 0,
    ):
        owned(study_id, snapshot_id, db)
        return list(
            db.scalars(
                select(AnalysisJob)
                .where(AnalysisJob.snapshot_id == str(snapshot_id))
                .order_by(AnalysisJob.created_at.desc(), AnalysisJob.id)
                .limit(limit)
                .offset(offset)
            )
        )

    @app.get(
        base + "/{snapshot_id}/jobs/{job_id}",
        response_model=JobRead,
        dependencies=dependencies,
        tags=["analysis"],
    )
    def job_read(study_id: UUID, snapshot_id: UUID, job_id: UUID, db: DB):
        return owned_job(study_id, snapshot_id, job_id, db)

    @app.post(
        base + "/{snapshot_id}/jobs/{job_id}/cancel",
        response_model=JobRead,
        dependencies=dependencies,
        tags=["analysis"],
    )
    def cancel(
        study_id: UUID,
        snapshot_id: UUID,
        job_id: UUID,
        payload: JobCancel,
        request: Request,
        db: DB,
    ):
        job = owned_job(study_id, snapshot_id, job_id, db)
        if job.status == "cancelled":
            return job
        if job.status not in ("queued", "running"):
            raise HTTPException(409, "Finished jobs cannot be cancelled")
        job.status = "cancelled"
        job.finished_at = timestamp()
        job.error = "Cancelled by " + payload.staff_name + " (" + principal(request) + ")"
        commit(db)
        return job
