"""TCATA transition ledger. Complete traces commit atomically before acknowledgement."""

from datetime import UTC
from typing import Literal
from uuid import UUID

from fastapi import HTTPException
from pydantic import AwareDatetime, Field, StrictInt, field_serializer
from sqlalchemy import select

from sensibilia.flow_execution import current_for_write
from sensibilia.flow_service import is_v2
from sensibilia.methods import StrictModel, TCATAConfiguration
from sensibilia.models import (
    FormEvent,
    Observation,
    PathEvent,
    StudyTest,
    StudyVersion,
    TemporalEvent,
    TemporalRun,
)


class Transition(StrictModel):
    client_event_id: UUID
    seq: StrictInt = Field(ge=1, le=10000)
    elapsed_ms: StrictInt = Field(ge=0, le=600000)
    attribute_id: str = Field(min_length=1, max_length=100)
    selected: bool = Field(strict=True)
    recorded_at: AwareDatetime

    @field_serializer("recorded_at")
    def utc(self, value):
        return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


class TemporalValue(StrictModel):
    state: Literal["complete", "interrupted", "skipped"]
    started_at: AwareDatetime | None
    ended_at: AwareDatetime
    elapsed_ms: StrictInt = Field(ge=0, le=600000)
    clock_resolution_ms: float | None = Field(gt=0, le=1000, allow_inf_nan=False, strict=True)
    interruption_flags: list[
        Literal["hidden", "reload", "clock_gap", "storage_failure", "event_limit"]
    ] = Field(max_length=4)
    transitions: list[Transition] = Field(max_length=10000)

    @field_serializer("started_at", "ended_at")
    def utc(self, value):
        return value.astimezone(UTC).isoformat().replace("+00:00", "Z") if value else None


class TemporalCreate(StrictModel):
    client_event_id: UUID
    study_test_id: UUID
    step_id: UUID
    occurrence_id: str = Field(min_length=1, max_length=100)
    sample_id: UUID | None = None
    value: TemporalValue
    recorded_at: AwareDatetime

    @field_serializer("recorded_at")
    def utc(self, value):
        return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


class TemporalBatch(StrictModel):
    events: list[TemporalCreate] = Field(min_length=1, max_length=20)


def validate_trace(config, value):
    if value.state == "skipped":
        if not config.allow_skips:
            raise ValueError("Skipping is disabled for this test")
        if (
            value.started_at is not None
            or value.transitions
            or value.elapsed_ms
            or value.interruption_flags
        ):
            raise ValueError("A skip has no acquisition or transitions")
        return
    wall_gap = value.state == "interrupted" and "clock_gap" in value.interruption_flags
    if value.started_at is None or (value.ended_at < value.started_at and not wall_gap):
        raise ValueError("A run needs ordered UTC start/end timestamps")
    if value.elapsed_ms > config.duration_ms:
        raise ValueError("Run exceeds configured duration")
    if value.state == "complete" and (
        value.elapsed_ms != config.duration_ms or value.interruption_flags
    ):
        raise ValueError("Complete run needs the full duration and no interruption")
    if value.state == "interrupted" and not value.interruption_flags:
        raise ValueError("Interrupted runs need a quality flag")
    active, ids, elapsed = set(), set(), 0
    for i, event in enumerate(value.transitions):
        if event.seq != i + 1 or event.elapsed_ms < elapsed or event.elapsed_ms > value.elapsed_ms:
            raise ValueError("Transition sequence/timing is invalid")
        if event.attribute_id not in {a.id for a in config.attributes}:
            raise ValueError("Unknown temporal attribute")
        if event.client_event_id in ids or (event.attribute_id in active) == event.selected:
            raise ValueError("Duplicate ID or redundant transition")
        if not wall_gap and not value.started_at <= event.recorded_at <= value.ended_at:
            raise ValueError("Transition UTC time is outside the run")
        ids.add(event.client_event_id)
        if event.selected:
            active.add(event.attribute_id)
        else:
            active.remove(event.attribute_id)
        elapsed = event.elapsed_ms


def ingest(db, session, batch):
    acknowledgements = []
    for event in batch.events:
        data = event.model_dump(mode="json")
        existing = db.scalar(
            select(TemporalRun).where(TemporalRun.client_event_id == str(event.client_event_id))
        )
        if existing:
            if existing.session_id != session.id or existing.payload != data:
                raise HTTPException(409, "Event ID already exists with different data")
            acknowledgements.append(
                dict(
                    client_event_id=existing.client_event_id,
                    response_id=existing.id,
                    status="duplicate",
                )
            )
            continue
        all_ids = [
            str(event.client_event_id),
            *[str(t.client_event_id) for t in event.value.transitions],
        ]
        if len(set(all_ids)) != len(all_ids) or any(
            db.scalar(select(model.client_event_id).where(model.client_event_id.in_(all_ids)))
            for model in (Observation, FormEvent, PathEvent, TemporalRun, TemporalEvent)
        ):
            raise HTTPException(409, "Event ID already exists with different data")
        test = db.get(StudyTest, str(event.study_test_id))
        version = db.get(StudyVersion, session.study_version_id)
        if (
            not test
            or test.study_version_id != session.study_version_id
            or test.test_type_id != "tcata-v1"
            or not is_v2(version.form)
        ):
            raise HTTPException(422, "Temporal run requires the assigned v2 TCATA test")
        state = current_for_write(
            db,
            session,
            str(event.step_id),
            event.occurrence_id,
            str(event.sample_id) if event.sample_id else None,
        )
        node = state["node"]
        if node.kind != "embedded_method" or str(node.data.study_test_id) != test.id:
            raise HTTPException(422, "Temporal run does not match the current method")
        if db.scalar(
            select(TemporalRun.id).where(
                TemporalRun.session_id == session.id,
                TemporalRun.step_id == str(event.step_id),
                TemporalRun.occurrence_id == event.occurrence_id,
            )
        ):
            raise HTTPException(409, "Temporal occurrence is immutable")
        try:
            validate_trace(TCATAConfiguration.model_validate(test.configuration), event.value)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        run = TemporalRun(
            session_id=session.id,
            study_test_id=test.id,
            step_id=str(event.step_id),
            occurrence_id=event.occurrence_id,
            sample_id=str(event.sample_id) if event.sample_id else None,
            client_event_id=str(event.client_event_id),
            payload=data,
            recorded_at=data["recorded_at"],
        )
        db.add(run)
        db.flush()
        for transition in event.value.transitions:
            db.add(TemporalEvent(run_id=run.id, **transition.model_dump(mode="json")))
        db.flush()
        acknowledgements.append(
            dict(client_event_id=run.client_event_id, response_id=run.id, status="accepted")
        )
    return acknowledgements
