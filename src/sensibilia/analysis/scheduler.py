"""Background runner for add-on jobs: one at a time, never inside a request handler (059)."""

from __future__ import annotations

import hashlib
import logging
import threading

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from sensibilia.analysis import inputs, runner
from sensibilia.analysis.registry import RECIPES
from sensibilia.analysis_setup import lock_sha256, runtime_directory, status
from sensibilia.data_service import canonical
from sensibilia.models import AnalysisJob, AnalysisJobFigure, DatasetSnapshot, timestamp

log = logging.getLogger("sensibilia.analysis")
INTERRUPTED = "Interrupted by a server restart; run it again."


def immediate(db: Session) -> None:
    db.connection(execution_options={"sqlite_begin_mode": "IMMEDIATE"})


def recover_interrupted(engine) -> int:
    """Add-on jobs still 'running' at startup lost their R process with the old server."""
    with Session(engine) as db:
        immediate(db)
        jobs = list(
            db.scalars(
                select(AnalysisJob).where(
                    AnalysisJob.status == "running", AnalysisJob.recipe.in_(list(RECIPES))
                )
            )
        )
        for job in jobs:
            job.status, job.finished_at, job.error = "failed", timestamp(), INTERRUPTED
        db.commit()
        return len(jobs)


def claim(engine) -> str | None:
    with Session(engine) as db:
        immediate(db)
        job = db.scalar(
            select(AnalysisJob)
            .where(AnalysisJob.status == "queued", AnalysisJob.recipe.in_(list(RECIPES)))
            .order_by(AnalysisJob.created_at, AnalysisJob.id)
            .limit(1)
        )
        if job is None:
            return None
        state = status()
        job.status, job.started_at = "running", timestamp()
        receipt = state.get("receipt") or {}
        job.runtime = {
            "lock_sha256": lock_sha256(),
            "state": state["state"],
            "versions": receipt.get("versions"),
            "snapshot_date": receipt.get("snapshot_date"),
        }
        db.commit()
        return job.id


def finish(engine, job_id: str, result=None, figures=None, error=None) -> str:
    with Session(engine) as db:
        immediate(db)
        job = db.get(AnalysisJob, job_id)
        if job.status == "cancelled":  # a late result never replaces a cancellation
            return "cancelled"
        job.finished_at = timestamp()
        if error:
            job.status, job.error = "failed", error[:500]
        else:
            job.status, job.result = "succeeded", result
            job.result_sha256 = hashlib.sha256(canonical(result).encode()).hexdigest()
            for name, content in (figures or {}).items():
                db.add(
                    AnalysisJobFigure(
                        job_id=job_id,
                        name=name,
                        content=content,
                        sha256=hashlib.sha256(content).hexdigest(),
                    )
                )
        db.commit()
        return job.status


def run_one(engine, run=runner.run) -> str | None:
    """Claim and run the oldest queued add-on job. Returns its final status, or None if idle."""
    job_id = claim(engine)
    if job_id is None:
        return None
    try:
        with Session(engine) as db:
            job = db.get(AnalysisJob, job_id)
            recipe = RECIPES[job.recipe]
            if job.runtime["state"] != "ready":
                raise runner.RecipeFailed(
                    "The analysis add-on is not ready on the server: " + status()["message"]
                )
            item = db.get(DatasetSnapshot, job.snapshot_id)
            files = inputs.build(item, job.study_test_id, job.parameters)

        def cancelled():
            with Session(engine) as db:
                return db.get(AnalysisJob, job_id).status == "cancelled"

        raw, figures = run(recipe, files, runtime_directory(), cancelled)
        result = recipe.result.model_validate(raw).model_dump(mode="json")
    except runner.RecipeFailed as problem:
        return finish(engine, job_id, error=str(problem))
    except HTTPException as problem:
        return finish(engine, job_id, error=str(problem.detail))
    except ValidationError as problem:
        log.warning("Recipe %s returned an invalid result: %s", job_id, problem)
        return finish(engine, job_id, error="The analysis returned a result in an unexpected form.")
    except Exception as problem:  # noqa: BLE001 - every failure is recorded on the job
        log.exception("Analysis job %s failed", job_id)
        return finish(engine, job_id, error="Unexpected error: " + str(problem))
    return finish(engine, job_id, result=result, figures=figures)


class Scheduler:
    """One daemon thread; `wake()` after queuing starts work without waiting for the next poll."""

    def __init__(self, engine, poll_seconds: float = 5.0):
        self.engine = engine
        self.poll = poll_seconds
        self.signal = threading.Event()
        self.stopping = False
        self.thread = threading.Thread(target=self.loop, name="analysis-runner", daemon=True)

    def start(self):
        recover_interrupted(self.engine)
        self.thread.start()

    def wake(self):
        self.signal.set()

    def stop(self):
        self.stopping = True
        self.signal.set()
        self.thread.join(timeout=5)

    def loop(self):
        while not self.stopping:
            try:
                while not self.stopping and run_one(self.engine) is not None:
                    pass
            except Exception:  # noqa: BLE001 - keep the runner alive; the job records the error
                log.exception("Analysis runner error")
            self.signal.wait(self.poll)
            self.signal.clear()
