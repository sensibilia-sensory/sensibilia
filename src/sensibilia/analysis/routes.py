"""Researcher endpoints of the analysis add-on. All need the researcher credential.

No `from __future__ import annotations` here: FastAPI must see the real `DB` dependency type.
"""

from collections import Counter
from datetime import UTC, datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, StringConstraints, TypeAdapter, ValidationError
from sqlalchemy import select

from sensibilia.analysis import reports
from sensibilia.analysis.power import PowerRead, PowerRequest, calculate
from sensibilia.analysis.presenter import present
from sensibilia.analysis.registry import HEDONIC, RECIPES, AnyResult, Presentation, for_method
from sensibilia.analysis_setup import status
from sensibilia.models import (
    AnalysisJob,
    AnalysisJobFigure,
    DatasetSnapshot,
    Sample,
    StudyTest,
    TestType,
    identifier,
    timestamp,
)
from sensibilia.snapshots import SnapshotCreate, make_snapshot, principal

Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
RESULT = TypeAdapter(AnyResult)


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AddOnStatusRead(BaseModel):
    state: Literal["ready", "needs_update", "missing", "broken"]
    message: str
    r_version: str | None = None


class TestChoice(BaseModel):
    study_test_id: str
    name: str
    questions: list[dict[str, str]]


class SuggestionRead(BaseModel):
    recipe: str
    recipe_title: str
    study_test_id: str
    test_name: str
    test_type_id: str
    samples: int
    assessors: int
    settings: dict
    liking_tests: list[TestChoice]
    needs_liking: bool


class AnalysisCreate(Strict):
    study_version_id: UUID
    study_test_id: UUID
    recipe: str
    settings: dict = {}
    staff_name: Text
    snapshot_id: UUID | None = None


class AnalysisRead(BaseModel):
    id: str
    study_id: str
    study_version_id: str | None
    snapshot_id: str
    snapshot_label: str
    snapshot_created_at: str
    study_test_id: str | None
    test_name: str
    recipe: str
    recipe_title: str
    recipe_version: int | None
    recipe_sha256: str
    parameters: dict | None
    status: Literal["queued", "running", "succeeded", "failed", "cancelled"]
    staff_name: str
    created_at: str
    started_at: str | None
    finished_at: str | None
    error: str | None
    runtime: dict | None
    result: AnyResult | None = None
    result_sha256: str | None
    presentation: Presentation | None = None
    figures: list[str] = []


def test_names(db, version_id: str) -> dict[str, tuple[str, str]]:
    """{test id: (name for people, test type id)}; numbered when one method appears twice."""
    rows = list(
        db.execute(
            select(StudyTest, TestType)
            .join(TestType, TestType.id == StudyTest.test_type_id)
            .where(StudyTest.study_version_id == version_id)
            .order_by(StudyTest.position)
        )
    )
    seen = Counter(kind.id for _, kind in rows)
    names = {}
    counter: dict[str, int] = {}
    for test, kind in rows:
        counter[kind.id] = counter.get(kind.id, 0) + 1
        name = kind.name.split(" — ")[0]
        if seen[kind.id] > 1:
            name += f" {counter[kind.id]}"
        names[test.id] = (name, kind.id)
    return names


def questions(test: StudyTest) -> list[dict[str, str]]:
    items = test.configuration.get("questions") or []
    return [{"id": q["id"], "text": q["prompt"]} for q in items]


def register_analysis_routes(app, DB, dependencies, get_study, owned_version, package, commit):
    def analysis_read(db, job: AnalysisJob, full: bool = False) -> AnalysisRead:
        item = db.get(DatasetSnapshot, job.snapshot_id)
        names = test_names(db, item.study_version_id) if item.study_version_id else {}
        read = AnalysisRead(
            id=job.id,
            study_id=item.study_id,
            study_version_id=item.study_version_id,
            snapshot_id=item.id,
            snapshot_label=item.label,
            snapshot_created_at=item.created_at,
            study_test_id=job.study_test_id,
            test_name=names.get(job.study_test_id, ("Test", ""))[0],
            recipe=job.recipe,
            recipe_title=RECIPES[job.recipe].title,
            recipe_version=job.recipe_version,
            recipe_sha256=job.recipe_sha256,
            parameters=job.parameters,
            status=job.status,
            staff_name=job.staff_name,
            created_at=job.created_at,
            started_at=job.started_at,
            finished_at=job.finished_at,
            error=job.error,
            runtime=job.runtime,
            result_sha256=job.result_sha256,
        )
        if full and job.result is not None:
            read.result = RESULT.validate_python(job.result)
            read.presentation = Presentation(**present(job.recipe, job.result))
            read.figures = list(
                db.scalars(
                    select(AnalysisJobFigure.name)
                    .where(AnalysisJobFigure.job_id == job.id)
                    .order_by(AnalysisJobFigure.name)
                )
            )
        return read

    def owned_analysis(db, study_id, job_id) -> AnalysisJob:
        get_study(db, study_id)
        job = db.get(AnalysisJob, str(job_id))
        if not job or job.recipe not in RECIPES:
            raise HTTPException(404, "Analysis not found")
        if db.get(DatasetSnapshot, job.snapshot_id).study_id != str(study_id):
            raise HTTPException(404, "Analysis not found")
        return job

    @app.get(
        "/analysis/status",
        response_model=AddOnStatusRead,
        dependencies=dependencies,
        tags=["analysis"],
    )
    def addon_status():
        state = status()
        versions = (state.get("receipt") or {}).get("versions") or {}
        return AddOnStatusRead(
            state=state["state"], message=state["message"], r_version=versions.get("R")
        )

    @app.post(
        "/analysis/power",
        response_model=PowerRead,
        dependencies=dependencies,
        tags=["analysis"],
    )
    def power(payload: PowerRequest):
        # Arithmetic on the settings only: no collected data, so no snapshot or job is needed.
        return calculate(payload)

    @app.get(
        "/studies/{study_id}/versions/{version_id}/analyses/suggested",
        response_model=list[SuggestionRead],
        dependencies=dependencies,
        tags=["analysis"],
    )
    def suggested(study_id: UUID, version_id: UUID, db: DB):
        version = owned_version(study_id, version_id, db)
        if not version.published_at:
            raise HTTPException(409, "Analyses need a published version")
        from sensibilia.models import AssessorSession

        assessors = len(
            list(
                db.scalars(
                    select(AssessorSession.id).where(AssessorSession.study_version_id == version.id)
                )
            )
        )
        names = test_names(db, version.id)
        version_samples = len(
            list(db.scalars(select(Sample.id).where(Sample.study_version_id == version.id)))
        )
        all_tests = list(
            db.scalars(
                select(StudyTest)
                .where(StudyTest.study_version_id == version.id)
                .order_by(StudyTest.position)
            )
        )
        liking = [
            TestChoice(study_test_id=t.id, name=names[t.id][0], questions=questions(t))
            for t in all_tests
            if t.test_type_id == HEDONIC
        ]
        out = []
        for test in all_tests:
            for recipe in for_method(test.test_type_id):
                defaults = {}
                needs_liking = recipe.id == "jar-penalty"
                if recipe.id in ("jar-penalty", "cata") and liking:
                    defaults["liking_test_id"] = liking[0].study_test_id
                if needs_liking and not liking:
                    continue  # penalty analysis needs liking in the same version
                settings = recipe.settings.model_validate(defaults).model_dump(mode="json")
                out.append(
                    SuggestionRead(
                        recipe=recipe.id,
                        recipe_title=recipe.title,
                        study_test_id=test.id,
                        test_name=names[test.id][0],
                        test_type_id=test.test_type_id,
                        # Hedonic tests take their samples from the loop around them.
                        samples=len(test.configuration.get("sample_ids") or []) or version_samples,
                        assessors=assessors,
                        settings=settings,
                        liking_tests=liking,
                        needs_liking=needs_liking,
                    )
                )
        return out

    @app.post(
        "/studies/{study_id}/analyses",
        response_model=AnalysisRead,
        status_code=201,
        dependencies=dependencies,
        tags=["analysis"],
    )
    def create(study_id: UUID, payload: AnalysisCreate, request: Request, db: DB):
        """Freeze the latest answers (or use a chosen snapshot) and queue one analysis.

        Atomic: the snapshot and the job commit together or not at all."""
        study = get_study(db, study_id)
        state = status()
        if state["state"] != "ready":
            raise HTTPException(409, state["message"])
        recipe = RECIPES.get(payload.recipe)
        if recipe is None:
            raise HTTPException(422, "Unknown analysis")
        version = owned_version(study_id, payload.study_version_id, db)
        if not version.published_at:
            raise HTTPException(409, "Analyses need a published version")
        test = db.get(StudyTest, str(payload.study_test_id))
        if not test or test.study_version_id != version.id:
            raise HTTPException(422, "That test is not part of this version")
        if test.test_type_id not in recipe.methods:
            raise HTTPException(422, "This analysis does not apply to that test")
        try:
            settings = recipe.settings.model_validate(payload.settings).model_dump(mode="json")
        except ValidationError as error:
            raise HTTPException(422, "Settings: " + error.errors()[0]["msg"]) from error
        liking = settings.get("liking_test_id")
        if liking:
            other = db.get(StudyTest, liking)
            if not other or other.study_version_id != version.id or other.test_type_id != HEDONIC:
                raise HTTPException(422, "Choose a liking test from the same version")
        actor = principal(request)
        if payload.snapshot_id:
            item = db.get(DatasetSnapshot, str(payload.snapshot_id))
            if not item or item.study_id != study.id or item.study_version_id != version.id:
                raise HTTPException(422, "Choose a snapshot of this version")
        else:
            snapshot_id = identifier()
            label = "For analysis " + datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC")
            request_body = SnapshotCreate(
                label=label,
                staff_name=payload.staff_name,
                study_version_id=payload.study_version_id,
                history="current",
            )
            files, manifest = make_snapshot(db, study, request_body, package, snapshot_id, actor)
            item = DatasetSnapshot(
                id=snapshot_id,
                study_id=study.id,
                study_version_id=version.id,
                label=label,
                staff_name=payload.staff_name,
                principal=actor,
                created_at=manifest.created_at,
                manifest=manifest.model_dump(mode="json"),
                files=files,
            )
            db.add(item)
            db.flush()
        job = AnalysisJob(
            id=identifier(),
            snapshot_id=item.id,
            recipe=recipe.id,
            recipe_version=recipe.version,
            recipe_sha256=recipe.sha256(),
            parameters=settings,
            study_test_id=test.id,
            staff_name=payload.staff_name,
            principal=actor,
            created_at=timestamp(),
            status="queued",
        )
        db.add(job)
        commit(db)
        scheduler = getattr(request.app.state, "analysis_scheduler", None)
        if scheduler:
            scheduler.wake()
        return analysis_read(db, job)

    @app.get(
        "/studies/{study_id}/analyses",
        response_model=list[AnalysisRead],
        dependencies=dependencies,
        tags=["analysis"],
    )
    def listing(study_id: UUID, db: DB):
        get_study(db, study_id)
        jobs = db.scalars(
            select(AnalysisJob)
            .join(DatasetSnapshot, DatasetSnapshot.id == AnalysisJob.snapshot_id)
            .where(DatasetSnapshot.study_id == str(study_id), AnalysisJob.recipe.in_(list(RECIPES)))
            .order_by(AnalysisJob.created_at.desc(), AnalysisJob.id)
            .limit(200)
        )
        return [analysis_read(db, job) for job in jobs]

    @app.get(
        "/studies/{study_id}/analyses/{job_id}",
        response_model=AnalysisRead,
        dependencies=dependencies,
        tags=["analysis"],
    )
    def read(study_id: UUID, job_id: UUID, db: DB):
        return analysis_read(db, owned_analysis(db, study_id, job_id), full=True)

    @app.get(
        "/studies/{study_id}/analyses/{job_id}/figures/{name}",
        response_class=Response,
        dependencies=dependencies,
        tags=["analysis"],
        responses={200: {"content": {"image/png": {}}, "description": "Figure drawn by R"}},
    )
    def figure(study_id: UUID, job_id: UUID, name: str, db: DB):
        job = owned_analysis(db, study_id, job_id)
        stored = db.get(AnalysisJobFigure, (job.id, name))
        if not stored:
            raise HTTPException(404, "Figure not found")
        return Response(stored.content, media_type="image/png")

    @app.get(
        "/studies/{study_id}/analyses/{job_id}/report",
        response_class=Response,
        dependencies=dependencies,
        tags=["analysis"],
        responses={
            200: {
                "content": {
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {},
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {},
                },
                "description": "Excel workbook or Word report of a finished analysis",
            }
        },
    )
    def report(study_id: UUID, job_id: UUID, db: DB, format: Literal["xlsx", "docx"] = "xlsx"):
        job = owned_analysis(db, study_id, job_id)
        if job.status != "succeeded":
            raise HTTPException(409, "The analysis has no result yet")
        read = analysis_read(db, job)
        study = get_study(db, study_id)
        item = db.get(DatasetSnapshot, job.snapshot_id)
        meta = {
            "title": f"{read.recipe_title} – {read.test_name}",
            "study": study.title,
            "test": read.test_name,
            "snapshot_label": item.label,
            "snapshot_created_at": item.created_at,
            "dataset_sha256": item.manifest["dataset_sha256"],
            "job": read.model_dump(mode="json"),
        }
        if format == "xlsx":
            content = reports.xlsx(job.recipe, job.result, meta)
            media = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        else:
            figures = {
                f.name: f.content
                for f in db.scalars(
                    select(AnalysisJobFigure).where(AnalysisJobFigure.job_id == job.id)
                )
            }
            content = reports.docx(job.recipe, job.result, meta, figures)
            media = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        name = f"{RECIPES[job.recipe].id}-{read.test_name}-{job.id[:8]}.{format}"
        safe = "".join(c if c.isalnum() or c in "-_." else "-" for c in name)
        return Response(
            content,
            media_type=media,
            headers={"Content-Disposition": f'attachment; filename="{safe}"'},
        )
