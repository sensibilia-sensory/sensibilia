"""Serving operations; never exposes research answers to operators."""

import asyncio
import csv
import io
import json
import secrets
import time
from datetime import UTC, datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import Depends, HTTPException, Request
from fastapi.responses import Response, StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import AwareDatetime, BaseModel, Field, model_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session, object_session

from sensibilia.flow_execution import current_for_write
from sensibilia.flows import DraftFlowV2, walk
from sensibilia.methods import StrictModel
from sensibilia.models import (
    AssessorSession,
    BoothAssignment,
    BoothIdentity,
    FormEvent,
    LaboratoryRoom,
    OperationalEvent,
    PathEvent,
    Presence,
    RoomVersion,
    Sample,
    ServingSignal,
    StudyVersion,
    Terminal,
    identifier,
    timestamp,
)
from sensibilia.schemas import ServingAssignmentRead as AssignmentRead
from sensibilia.terminals import assign_session, current_assignment, digest


class Booth(StrictModel):
    id: UUID
    label: str = Field(min_length=1, max_length=100)
    row: int = Field(ge=1, le=20)
    column: int = Field(ge=1, le=20)
    enabled: bool = True
    # Position on the booth board as fractions of its canvas; absent until the booth is placed.
    x: float | None = Field(default=None, ge=0, le=1)
    y: float | None = Field(default=None, ge=0, le=1)


class RoomSave(StrictModel):
    room_id: UUID | None = None
    expected_revision: int = Field(default=0, ge=0)
    name: str = Field(min_length=1, max_length=100)
    rows: int = Field(ge=1, le=20)
    columns: int = Field(ge=1, le=20)
    booths: list[Booth] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def geometry(self):
        if not self.name.strip() or any(not b.label.strip() for b in self.booths):
            raise ValueError("Room and booth labels must be nonblank")
        if len({b.label for b in self.booths}) != len(self.booths):
            raise ValueError("Booth labels must be unique within a room")
        if len({b.id for b in self.booths}) != len(self.booths) or len(
            {(b.row, b.column) for b in self.booths}
        ) != len(self.booths):
            raise ValueError("Booth identifiers and positions must be unique")
        if any(b.row > self.rows or b.column > self.columns for b in self.booths):
            raise ValueError("Booth is outside room dimensions")
        return self


class RoomRead(RoomSave):
    id: str
    revision: int
    created_at: str


class AssignBooth(StrictModel):
    session_id: UUID
    room_version_id: UUID
    booth_id: UUID
    previous_assignment_id: UUID | None = None
    client_event_id: UUID
    staff_name: str = Field(min_length=1, max_length=100)
    reason: str = Field(min_length=1, max_length=500)


class ReleaseBooth(StrictModel):
    client_event_id: UUID
    staff_name: str = Field(min_length=1, max_length=100)
    reason: str = Field(min_length=1, max_length=500)


class BoothHistoryRead(AssignmentRead):
    staff_name: str
    principal: str
    reason: str


class SignalCommand(StrictModel):
    client_event_id: UUID
    assignment_id: UUID
    step_id: UUID
    occurrence_id: str = Field(min_length=1, max_length=100)
    sample_id: UUID | None = None
    expected_revision: int = Field(ge=0)
    action: Literal["ready", "acknowledged", "served", "manual", "cancel", "help", "received"]
    actor: str = Field(min_length=1, max_length=100)
    reason: str = Field(default="", max_length=500)
    codes: list[str] = Field(default_factory=list, max_length=50)
    elapsed_ms: int = Field(default=0, ge=0)
    clock_quality: Literal["monotonic", "wall_estimate"] = "wall_estimate"
    offline: bool = False
    recorded_at: AwareDatetime


class SignalRead(BaseModel):
    id: str
    assignment_id: str
    step_id: str
    occurrence_id: str
    state: str
    revision: int
    requested_at: str
    updated_at: str
    actor: str


class OperationAck(BaseModel):
    client_event_id: str
    cursor: int
    signal: SignalRead | None = None
    assignment: AssignmentRead | None = None
    status: Literal["accepted", "duplicate"] = "accepted"


class SlotRead(BaseModel):
    sample_id: str
    code: str
    label: str
    position: int


class TaskRead(BaseModel):
    assignment_id: str
    room_version_id: str
    room_name: str
    room_revision: int
    booth_id: str
    booth_label: str
    row: int
    column: int
    session_id: str | None
    assessor_code: str
    study_version_id: str | None
    version_number: int | None
    status: str
    last_seen: str | None
    presence: Literal["online", "offline", "unknown"]
    signal: SignalRead | None
    slots: list[SlotRead]
    preparation: str


class DashboardRead(BaseModel):
    rooms: list[RoomRead] = Field(default_factory=list)
    cursor: int
    tasks: list[TaskRead]
    server_time: str


class BoardServing(BaseModel):
    """What staff need to serve or acknowledge an open request from the booth board."""

    assignment_id: str
    signal: SignalRead
    slots: list[SlotRead]
    preparation: str


class BoardTablet(BaseModel):
    terminal_id: str
    name: str
    revision: int
    booth_id: str | None
    session_id: str | None
    study_version_id: str | None = None
    assessor_code: str | None
    stage: Literal["waiting", "serving", "in_progress", "completed", "ended", "offline"]
    detail: str
    serving: BoardServing | None = None


class BoardRead(BaseModel):
    tablets: list[BoardTablet]
    server_time: str


class TabletOperations(BaseModel):
    assignment: AssignmentRead | None
    signals: list[SignalRead]
    server_time: str


class PresenceRead(BaseModel):
    last_seen: str


def assignment_read(a):
    db = object_session(a)
    room = db.get(RoomVersion, a.room_version_id)
    booth = next(b for b in room.booths if b["id"] == a.booth_id)
    return AssignmentRead(
        id=a.id,
        room_version_id=a.room_version_id,
        booth_id=a.booth_id,
        session_id=a.session_id,
        assigned_at=a.assigned_at,
        released_at=a.released_at,
        room_name=room.name,
        booth_label=booth["label"],
        room_revision=room.revision,
    )


def signal_read(s):
    return SignalRead(**{k: getattr(s, k) for k in SignalRead.model_fields})


def active_assignment(db, session_id):
    return db.scalar(
        select(BoothAssignment).where(
            BoothAssignment.session_id == session_id, BoothAssignment.released_at.is_(None)
        )
    )


def gate_slots(db, session, node, occurrence):
    if node.data.sample_binding == "current":
        matched = [
            (sample, len(a["samples"]))
            for a in session.loop_assignments
            for sample in a["samples"]
            if occurrence == a["loop_id"] + ":" + sample["sample_id"]
        ]
        if len(matched) != 1:
            raise HTTPException(409, "Serving occurrence is not assigned")
        samples = [matched[0][0]]
    else:
        if occurrence != "study":
            raise HTTPException(409, "Set serving must use the study occurrence")
        samples = [
            dict(sample_id=str(id), position=i + 1) for i, id in enumerate(node.data.sample_ids)
        ]
    if node.data.study_test_id:
        from sensibilia.presentation import assignment_for

        assignment = assignment_for(db, session.id, str(node.data.study_test_id))
        if not assignment:
            raise HTTPException(409, "Serving method has no frozen assignment")
        plan = assignment.plan
        ordered = ([plan["reference"]] if plan.get("reference") else []) + plan["samples"]
        return [
            SlotRead(sample_id=s["sample_id"], code=s["code"], label=s["label"], position=i + 1)
            for i, s in enumerate(ordered)
        ]
    slots = []
    for sample in samples:
        item = db.get(Sample, sample["sample_id"])
        if not item or item.study_version_id != session.study_version_id:
            raise HTTPException(409, "Serving sample does not belong to this publication")
        slots.append(
            SlotRead(
                sample_id=item.id, code=item.code, label=item.label, position=sample["position"]
            )
        )
    return slots


def room_read(room):
    return RoomRead(
        id=room.id,
        room_id=room.room_id,
        expected_revision=room.revision,
        revision=room.revision,
        name=room.name,
        rows=room.rows,
        columns=room.columns,
        booths=room.booths,
        created_at=room.created_at,
    )


def latest_rooms(db):
    rows = db.scalars(
        select(RoomVersion).order_by(RoomVersion.room_id, RoomVersion.revision.desc())
    ).all()
    result = {}
    for row in rows:
        result.setdefault(row.room_id, row)
    return list(result.values())


def record(db, event_id, assignment, action, payload, actor, principal, recorded_at, signal=None):
    db.flush()
    result = dict(
        signal=signal_read(signal).model_dump() if signal else None,
        assignment=assignment_read(assignment).model_dump() if not signal else None,
    )
    event = OperationalEvent(
        client_event_id=event_id,
        assignment_id=assignment.id,
        signal_id=signal.id if signal else None,
        action=action,
        payload=payload,
        actor=actor,
        principal=principal,
        recorded_at=recorded_at,
        result=result,
    )
    db.add(event)
    db.flush()
    return OperationAck(client_event_id=event_id, cursor=event.cursor, **result)


def duplicate(db, event_id, payload, principal):
    event = db.scalar(select(OperationalEvent).where(OperationalEvent.client_event_id == event_id))
    if not event:
        return None
    if event.payload != payload or event.principal != principal:
        raise HTTPException(409, "Operational UUID already has different data or ownership")
    return OperationAck(
        client_event_id=event_id, cursor=event.cursor, status="duplicate", **event.result
    )


def cancel_assignment(db, assignment, principal, reason):
    for signal in db.scalars(
        select(ServingSignal).where(
            ServingSignal.assignment_id == assignment.id,
            ServingSignal.state.in_(["ready", "acknowledged", "help"]),
        )
    ):
        signal.state, signal.revision = "cancel", signal.revision + 1
        signal.updated_at, signal.actor = timestamp(), "system"
        record(
            db,
            identifier(),
            assignment,
            "cancel",
            {"reason": reason},
            "system",
            principal,
            timestamp(),
            signal,
        )


def release_assignment(db, assignment, staff_name, principal, reason):
    """Free a booth: cancel its open serving requests and record the release; the caller commits."""
    cancel_assignment(db, assignment, principal, reason)
    assignment.released_at = timestamp()
    record(
        db,
        identifier(),
        assignment,
        "release",
        {"reason": reason},
        staff_name,
        principal,
        timestamp(),
    )
    db.flush()


def follow_booth(db, terminal, old_session, new_session, staff_name, reason, principal):
    """Carry a tablet's booth to its next assessment; the caller commits."""
    prior = active_assignment(db, old_session.id) if old_session else None
    booth_id = terminal.booth_id or (prior.booth_id if prior else None)
    if not booth_id:
        return
    room = next(
        (
            r
            for r in latest_rooms(db)
            if any(b["id"] == booth_id and b["enabled"] for b in r.booths)
        ),
        None,
    )
    if not room:
        raise HTTPException(
            409, "The tablet's booth is no longer enabled in the latest room layout"
        )
    if prior:
        release_assignment(db, prior, staff_name, principal, reason)
    # A booth can still hold an earlier assessment whose tablet was removed or moved away.
    # A finished one no longer needs the booth; one still in progress must be ended first.
    held = db.scalar(
        select(BoothAssignment).where(
            BoothAssignment.booth_id == booth_id, BoothAssignment.released_at.is_(None)
        )
    )
    if held:
        holder = db.get(AssessorSession, held.session_id)
        if holder and holder.status == "in_progress":
            label = next(b["label"] for b in room.booths if b["id"] == booth_id)
            # Structured so the booth board can offer to end that assessment in place.
            raise HTTPException(
                409,
                {
                    "message": f"Booth {label} still has assessor {holder.assessor_code}'s "
                    "assessment in progress. End that assessment first.",
                    "booth_label": label,
                    "session_id": holder.id,
                    "assessor_code": holder.assessor_code,
                },
            )
        release_assignment(db, held, staff_name, principal, "booth taken by the next tablet")
    assignment = BoothAssignment(
        room_version_id=room.id,
        booth_id=booth_id,
        session_id=new_session.id,
        staff_name=staff_name,
        principal=principal,
        reason=reason,
    )
    db.add(assignment)
    record(
        db,
        identifier(),
        assignment,
        "assign",
        {"reason": reason, "next_assessment": True},
        staff_name,
        principal,
        timestamp(),
    )


def dashboard(db, process_id):
    tasks = []
    now = datetime.now(UTC)
    for assignment in db.scalars(
        select(BoothAssignment).where(BoothAssignment.released_at.is_(None))
    ):
        room = db.get(RoomVersion, assignment.room_version_id)
        booth = next(b for b in room.booths if b["id"] == assignment.booth_id)
        session = db.get(AssessorSession, assignment.session_id)
        version = db.get(StudyVersion, session.study_version_id)
        signal = db.scalar(
            select(ServingSignal)
            .where(ServingSignal.assignment_id == assignment.id)
            .order_by(ServingSignal.updated_at.desc())
            .limit(1)
        )
        presence = db.get(Presence, session.id)
        online = (
            "unknown"
            if not presence or presence.process_id != process_id
            else "online"
            if (now - datetime.fromisoformat(presence.last_seen)).total_seconds() <= 45
            else "offline"
        )
        slots, preparation = [], ""
        if signal and signal.state != "cancel":
            node = next(
                n
                for n in walk(DraftFlowV2.model_validate(version.form).nodes)
                if str(n.id) == signal.step_id
            )
            slots = gate_slots(db, session, node, signal.occurrence_id)
            preparation = node.data.preparation.get(session.context.get("language", "en"), "")
        tasks.append(
            TaskRead(
                assignment_id=assignment.id,
                room_version_id=room.id,
                room_name=room.name,
                room_revision=room.revision,
                booth_id=assignment.booth_id,
                booth_label=booth["label"],
                row=booth["row"],
                column=booth["column"],
                session_id=session.id,
                assessor_code=session.assessor_code,
                study_version_id=version.id,
                version_number=version.version_number,
                status=session.status
                if session.status != "in_progress"
                else signal.state
                if signal
                else "assigned",
                last_seen=presence.last_seen if presence else None,
                presence=online,
                signal=signal_read(signal) if signal else None,
                slots=slots,
                preparation=preparation,
            )
        )
    occupied = {t.booth_id for t in tasks}
    layout_ids = {t.room_version_id for t in tasks}
    rooms = latest_rooms(db)
    for room in rooms:
        for booth in room.booths:
            if booth["id"] not in occupied:
                tasks.append(
                    TaskRead(
                        assignment_id="empty:" + booth["id"],
                        room_version_id=room.id,
                        room_name=room.name,
                        room_revision=room.revision,
                        booth_id=booth["id"],
                        booth_label=booth["label"],
                        row=booth["row"],
                        column=booth["column"],
                        session_id=None,
                        assessor_code="",
                        study_version_id=None,
                        version_number=None,
                        status="no session" if booth["enabled"] else "disabled",
                        last_seen=None,
                        presence="unknown",
                        signal=None,
                        slots=[],
                        preparation="",
                    )
                )
    tasks.sort(
        key=lambda t: (
            t.signal.requested_at
            if t.signal and t.signal.state in {"ready", "acknowledged", "help"}
            else "z",
            t.booth_label,
        )
    )
    return DashboardRead(
        rooms=[
            room_read(r)
            for r in {
                r.id: r for r in [*rooms, *[db.get(RoomVersion, id) for id in layout_ids]]
            }.values()
        ],
        cursor=db.scalar(select(func.max(OperationalEvent.cursor))) or 0,
        tasks=tasks,
        server_time=timestamp(),
    )


def open_signal(db, session):
    """The oldest serving request of this assessment that staff have not yet resolved."""
    return db.scalar(
        select(ServingSignal)
        .where(
            ServingSignal.session_id == session.id,
            ServingSignal.state.in_(["ready", "acknowledged", "help"]),
        )
        .order_by(ServingSignal.requested_at)
        .limit(1)
    )


def board_serving(db, session):
    """The open request with its codes, product labels and preparation, or None."""
    signal = open_signal(db, session) if session.status == "in_progress" else None
    if not signal:
        return None
    flow = DraftFlowV2.model_validate(db.get(StudyVersion, session.study_version_id).form)
    node = next((n for n in walk(flow.nodes) if str(n.id) == signal.step_id), None)
    if not node:
        return None
    return BoardServing(
        assignment_id=signal.assignment_id,
        signal=signal_read(signal),
        slots=gate_slots(db, session, node, signal.occurrence_id),
        preparation=node.data.preparation.get(session.context.get("language", "en"), ""),
    )


def board_stage(db, session, process_id):
    """One stage and one plain sentence for what a tablet's assessor is doing now."""
    if session.status == "completed":
        return "completed", "Has completed the test"
    if session.status == "screened_out":
        return "completed", "Screened out; finished"
    if session.status != "in_progress":
        return "ended", "Ended by staff"
    version = db.get(StudyVersion, session.study_version_id)
    flow = DraftFlowV2.model_validate(version.form)
    signal = open_signal(db, session)
    if signal:
        node = next((n for n in walk(flow.nodes) if str(n.id) == signal.step_id), None)
        codes = (
            [s.code for s in gate_slots(db, session, node, signal.occurrence_id)] if node else []
        )
        needs = "Needs samples " + " ".join(codes) if codes else "Needs a sample"
        if signal.state == "help":
            return "serving", "Assessor is asking for help with samples " + " ".join(codes)
        return "serving", needs
    presence = db.get(Presence, session.id)
    seen = datetime.fromisoformat(presence.last_seen) if presence else None
    if seen and presence.process_id == process_id:
        silent = (datetime.now(UTC) - seen).total_seconds()
        if silent > 45:
            return "offline", f"No contact for {int(silent // 60) or 1} min"
    steps = [n for n in walk(flow.nodes) if n.kind not in {"group", "loop_samples"}]
    last = db.scalar(
        select(PathEvent).where(PathEvent.session_id == session.id).order_by(PathEvent.seq.desc())
    )
    position = next((i + 1 for i, n in enumerate(steps) if last and str(n.id) == last.step_id), 0)
    if not position:
        return "in_progress", "Test starting"
    return "in_progress", f"Test in progress, step {position} of {len(steps)}"


def board(db, process_id):
    tablets = []
    for terminal in db.scalars(
        select(Terminal).where(Terminal.retired_at.is_(None)).order_by(Terminal.name)
    ):
        assigned = current_assignment(db, terminal.id)
        session = db.get(AssessorSession, assigned.session_id) if assigned else None
        stage, detail = (
            board_stage(db, session, process_id)
            if session
            else ("waiting", "Waiting for assignment")
        )
        tablets.append(
            BoardTablet(
                terminal_id=terminal.id,
                name=terminal.name,
                revision=terminal.revision,
                booth_id=terminal.booth_id,
                session_id=session.id if session else None,
                study_version_id=session.study_version_id if session else None,
                assessor_code=session.assessor_code if session else None,
                stage=stage,
                detail=detail,
                serving=board_serving(db, session) if session and stage == "serving" else None,
            )
        )
    return BoardRead(tablets=tablets, server_time=timestamp())


def install(app, database, researcher, assigned_session, commit):
    rates = {}

    def rate_limit(principal):
        now = time.monotonic()
        recent = [t for t in rates.get(principal, []) if now - t < 60]
        if len(recent) >= 120:
            raise HTTPException(
                429, "Operational rate limit; retry retained UUIDs", headers={"Retry-After": "5"}
            )
        rates[principal] = [*recent, now]

    DB = Annotated[Session, Depends(database)]
    Assigned = Annotated[AssessorSession, Depends(assigned_session)]
    bearer = HTTPBearer(scheme_name="OperatorToken", auto_error=False)

    def operator(
        request: Request,
        credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    ):
        token = request.app.state.settings.operator_token
        if token is not None and not token.get_secret_value():
            return "operator-key:" + digest("")[:16]
        if (
            token is None
            or not credentials
            or not secrets.compare_digest(
                token.get_secret_value().encode(), credentials.credentials.encode()
            )
        ):
            raise HTTPException(
                401, "Operator credential required", headers={"WWW-Authenticate": "Bearer"}
            )
        return "operator-key:" + digest(credentials.credentials)[:16]

    Operator = Annotated[str, Depends(operator)]

    def staff_principal(request):
        return (
            "researcher-key:"
            + digest(request.app.state.settings.researcher_token.get_secret_value())[:16]
        )

    @app.get(
        "/rooms",
        response_model=list[RoomRead],
        dependencies=[Depends(researcher)],
        tags=["researchers"],
    )
    def rooms(db: DB):
        return [room_read(r) for r in latest_rooms(db)]

    @app.post(
        "/rooms", response_model=RoomRead, dependencies=[Depends(researcher)], tags=["researchers"]
    )
    def save_room(payload: RoomSave, db: DB):
        room_id = str(payload.room_id) if payload.room_id else identifier()
        previous = db.scalar(
            select(RoomVersion)
            .where(RoomVersion.room_id == room_id)
            .order_by(RoomVersion.revision.desc())
            .limit(1)
        )
        if (previous.revision if previous else 0) != payload.expected_revision:
            raise HTTPException(409, "Room changed; reread its latest revision")
        other_ids = {
            b["id"] for room in latest_rooms(db) if room.room_id != room_id for b in room.booths
        }
        if any(str(b.id) in other_ids for b in payload.booths):
            raise HTTPException(409, "Booth ID belongs to another room")
        if not db.get(LaboratoryRoom, room_id):
            db.add(LaboratoryRoom(id=room_id))
            db.flush()
        for b in payload.booths:
            identity = db.get(BoothIdentity, str(b.id))
            if identity and identity.room_id != room_id:
                raise HTTPException(409, "Booth ID belongs to another room")
            if not identity:
                db.add(BoothIdentity(id=str(b.id), room_id=room_id))
        db.flush()
        room = RoomVersion(
            room_id=room_id,
            revision=payload.expected_revision + 1,
            name=payload.name,
            rows=payload.rows,
            columns=payload.columns,
            booths=[b.model_dump(mode="json") for b in payload.booths],
        )
        db.add(room)
        commit(db)
        return room_read(room)

    @app.get(
        "/booth-assignments",
        response_model=list[BoothHistoryRead],
        dependencies=[Depends(researcher)],
        tags=["researchers"],
    )
    def assignments(db: DB, offset: int = 0, limit: int = 100):
        if not 0 <= offset or not 1 <= limit <= 500:
            raise HTTPException(422, "Invalid page bounds")
        return [
            BoothHistoryRead(
                **assignment_read(a).model_dump(),
                staff_name=a.staff_name,
                principal=a.principal,
                reason=a.reason,
            )
            for a in db.scalars(
                select(BoothAssignment)
                .order_by(
                    BoothAssignment.released_at.is_not(None),
                    BoothAssignment.assigned_at.desc(),
                    BoothAssignment.id,
                )
                .offset(offset)
                .limit(limit)
            )
        ]

    @app.post(
        "/booth-assignments",
        response_model=OperationAck,
        dependencies=[Depends(researcher)],
        tags=["researchers"],
    )
    def assign(payload: AssignBooth, request: Request, db: DB):
        data = payload.model_dump(mode="json")
        principal = staff_principal(request)
        retry = duplicate(db, str(payload.client_event_id), data, principal)
        if retry:
            return retry
        session = db.get(AssessorSession, str(payload.session_id))
        room = db.get(RoomVersion, str(payload.room_version_id))
        booth = (
            next(
                (b for b in room.booths if b["id"] == str(payload.booth_id) and b["enabled"]), None
            )
            if room
            else None
        )
        if not session or session.status != "in_progress" or not booth:
            raise HTTPException(409, "Assign an open assessment to an enabled booth")
        if room.id not in {r.id for r in latest_rooms(db)}:
            raise HTTPException(409, "Use the latest room layout")
        prior = active_assignment(db, session.id)
        if (prior.id if prior else None) != (
            str(payload.previous_assignment_id) if payload.previous_assignment_id else None
        ):
            raise HTTPException(409, "Assignment changed; refresh before transfer")
        occupied = db.scalar(
            select(BoothAssignment).where(
                BoothAssignment.booth_id == str(payload.booth_id),
                BoothAssignment.released_at.is_(None),
            )
        )
        if occupied and occupied.id != (prior.id if prior else None):
            raise HTTPException(409, "Booth already has an active assessment")
        if prior:
            cancel_assignment(db, prior, principal, "transfer")
            prior.released_at = timestamp()
            record(
                db,
                identifier(),
                prior,
                "release",
                {"reason": payload.reason},
                payload.staff_name,
                principal,
                timestamp(),
            )
            db.flush()
        assignment = BoothAssignment(
            room_version_id=room.id,
            booth_id=str(payload.booth_id),
            session_id=session.id,
            staff_name=payload.staff_name,
            principal=principal,
            reason=payload.reason,
        )
        db.add(assignment)
        linked = db.scalar(
            select(Terminal).where(
                Terminal.booth_id == str(payload.booth_id), Terminal.retired_at.is_(None)
            )
        )
        if linked:
            # The booth's tablet receives the same assessment; a refusal rolls back both.
            assign_session(db, linked, session.id, payload.staff_name, payload.reason, principal)
        result = record(
            db,
            str(payload.client_event_id),
            assignment,
            "assign",
            data,
            payload.staff_name,
            principal,
            timestamp(),
        )
        commit(db)
        return result

    @app.post(
        "/booth-assignments/{assignment_id}/release",
        response_model=OperationAck,
        dependencies=[Depends(researcher)],
        tags=["researchers"],
    )
    def release_booth(assignment_id: UUID, payload: ReleaseBooth, request: Request, db: DB):
        data = payload.model_dump(mode="json")
        data["assignment_id"] = str(assignment_id)
        principal = staff_principal(request)
        retry = duplicate(db, str(payload.client_event_id), data, principal)
        if retry:
            return retry
        assignment = db.get(BoothAssignment, str(assignment_id))
        if not assignment or assignment.released_at:
            raise HTTPException(409, "Assignment is already released; reread history")
        cancel_assignment(db, assignment, principal, payload.reason)
        assignment.released_at = timestamp()
        result = record(
            db,
            str(payload.client_event_id),
            assignment,
            "release",
            data,
            payload.staff_name,
            principal,
            timestamp(),
        )
        commit(db)
        return result

    @app.get("/sessions/{session_id}/operations", response_model=TabletOperations, tags=["tablets"])
    def tablet_operations(session: Assigned, db: DB):
        a = active_assignment(db, session.id)
        signals = db.scalars(
            select(ServingSignal).where(ServingSignal.session_id == session.id)
        ).all()
        return TabletOperations(
            assignment=assignment_read(a) if a else None,
            signals=[signal_read(s) for s in signals],
            server_time=timestamp(),
        )

    @app.post("/sessions/{session_id}/presence", response_model=PresenceRead, tags=["tablets"])
    def heartbeat(session: Assigned, request: Request, db: DB):
        rate_limit("session:" + session.id)
        p = db.get(Presence, session.id)
        now = timestamp()
        if not p:
            db.add(
                Presence(
                    session_id=session.id, last_seen=now, process_id=app.state.operations_process
                )
            )
        elif (
            p.process_id != app.state.operations_process
            or (datetime.now(UTC) - datetime.fromisoformat(p.last_seen)).total_seconds() >= 10
        ):
            p.last_seen, p.process_id = now, app.state.operations_process
        commit(db)
        return PresenceRead(last_seen=now if not p else p.last_seen)

    def transition(payload, session, db, principal, is_operator):
        data = payload.model_dump(mode="json")
        data["recorded_at"] = payload.recorded_at.astimezone(UTC).isoformat()
        retry = duplicate(db, str(payload.client_event_id), data, principal)
        if retry:
            return retry
        rate_limit(principal)
        if is_operator != (payload.action in {"acknowledged", "served"}):
            raise HTTPException(403, "Action is outside this role")
        historical = db.scalar(
            select(FormEvent).where(
                FormEvent.session_id == session.id,
                FormEvent.step_id == str(payload.step_id),
                FormEvent.occurrence_id == payload.occurrence_id,
            )
        )
        reconciled = bool(
            payload.action == "manual"
            and historical
            and historical.value.get("state") == "delivery"
            and historical.value.get("mode") == "manual"
            and all(
                historical.value.get(k) == data[k]
                for k in ("codes", "reason", "elapsed_ms", "offline", "clock_quality")
            )
            and historical.sample_id == (str(payload.sample_id) if payload.sample_id else None)
        )
        # The assessor's own confirmation may reach the server after they moved on offline.
        late = reconciled or bool(
            payload.action == "received"
            and historical
            and historical.value.get("state") == "delivery"
        )
        assignment = db.get(BoothAssignment, str(payload.assignment_id))
        if (
            not assignment
            or assignment.session_id != session.id
            or (not late and (assignment.released_at or session.status != "in_progress"))
        ):
            raise HTTPException(409, "Serving assignment is no longer active")
        signal = db.scalar(
            select(ServingSignal).where(
                ServingSignal.assignment_id == assignment.id,
                ServingSignal.step_id == str(payload.step_id),
                ServingSignal.occurrence_id == payload.occurrence_id,
            )
        )
        if reconciled:
            if signal and signal.state == "manual":
                raise HTTPException(
                    409, "Manual delivery is already audited; retry its original UUID"
                )
            if not signal:
                signal = ServingSignal(
                    assignment_id=assignment.id,
                    session_id=session.id,
                    step_id=str(payload.step_id),
                    occurrence_id=payload.occurrence_id,
                    state="manual",
                    revision=1,
                    requested_at=timestamp(),
                    updated_at=timestamp(),
                    actor=payload.actor,
                )
                db.add(signal)
            elif signal.state not in {"served", "cancel"}:
                signal.state, signal.revision = "manual", signal.revision + 1
                signal.updated_at, signal.actor = timestamp(), payload.actor
            return record(
                db,
                str(payload.client_event_id),
                assignment,
                "manual",
                data,
                payload.actor,
                principal,
                data["recorded_at"],
                signal,
            )
        if payload.action == "help":
            # The assessor lacks the samples, even if staff already marked them served.
            if not signal or signal.state in {"manual", "cancel", "received"}:
                raise HTTPException(409, "Samples are not being served for this step")
            signal.state, signal.revision = "help", signal.revision + 1
            signal.updated_at, signal.actor = timestamp(), payload.actor
            return record(
                db,
                str(payload.client_event_id),
                assignment,
                "help",
                data,
                payload.actor,
                principal,
                data["recorded_at"],
                signal,
            )
        if payload.action == "received":
            # "Yes, I have them" is the delivery: it closes any open staff request for this gate
            # without staff marking it served. Already resolved requests keep their state and
            # still get the audit row.
            if not signal:
                signal = ServingSignal(
                    assignment_id=assignment.id,
                    session_id=session.id,
                    step_id=str(payload.step_id),
                    occurrence_id=payload.occurrence_id,
                    state="received",
                    revision=1,
                    requested_at=timestamp(),
                    updated_at=timestamp(),
                    actor=payload.actor,
                )
                db.add(signal)
            elif signal.state in {"ready", "acknowledged", "help"}:
                signal.state, signal.revision = "received", signal.revision + 1
                signal.updated_at, signal.actor = timestamp(), payload.actor
            return record(
                db,
                str(payload.client_event_id),
                assignment,
                "received",
                data,
                payload.actor,
                principal,
                data["recorded_at"],
                signal,
            )
        if signal and signal.state in {"served", "manual", "cancel"}:
            raise HTTPException(409, "Serving request is already resolved; refresh")
        if (signal.revision if signal else 0) != payload.expected_revision:
            raise HTTPException(409, "Already acknowledged or served; refresh before retrying")
        historical = db.scalar(
            select(FormEvent).where(
                FormEvent.session_id == session.id,
                FormEvent.step_id == str(payload.step_id),
                FormEvent.occurrence_id == payload.occurrence_id,
            )
        )
        if (
            payload.action == "manual"
            and historical
            and historical.value.get("state") == "delivery"
        ):
            node = next(
                n
                for n in walk(
                    DraftFlowV2.model_validate(
                        db.get(StudyVersion, session.study_version_id).form
                    ).nodes
                )
                if str(n.id) == str(payload.step_id)
            )
            state = {"node": node}
        else:
            state = current_for_write(
                db,
                session,
                str(payload.step_id),
                payload.occurrence_id,
                str(payload.sample_id) if payload.sample_id else None,
            )
        node = state["node"]
        if node.kind != "serve_gate":
            raise HTTPException(409, "Current task is not a serving gate")
        slots = gate_slots(db, session, node, payload.occurrence_id)
        if payload.action == "ready":
            if signal:
                raise HTTPException(409, "Request already exists")
            signal = ServingSignal(
                assignment_id=assignment.id,
                session_id=session.id,
                step_id=str(payload.step_id),
                occurrence_id=payload.occurrence_id,
                state="ready",
                revision=1,
                requested_at=timestamp(),
                updated_at=timestamp(),
                actor=payload.actor,
            )
            db.add(signal)
        else:
            if payload.action == "manual":
                if (
                    payload.codes != [s.code for s in slots]
                    or not payload.reason.strip()
                    or payload.elapsed_ms < node.data.timeout_seconds * 1000
                ):
                    raise HTTPException(
                        422, "Manual delivery requires verified codes, elapsed timeout and reason"
                    )
                if not signal:
                    signal = ServingSignal(
                        assignment_id=assignment.id,
                        session_id=session.id,
                        step_id=str(payload.step_id),
                        occurrence_id=payload.occurrence_id,
                        state="ready",
                        revision=0,
                        requested_at=timestamp(),
                        updated_at=timestamp(),
                        actor=payload.actor,
                    )
                    db.add(signal)
            elif (
                not signal
                or (payload.action == "acknowledged" and signal.state not in {"ready", "help"})
                or (payload.action == "served" and signal.state != "acknowledged")
            ):
                raise HTTPException(409, "Refresh the serving request before acting")
            signal.state, signal.revision = payload.action, signal.revision + 1
            signal.updated_at, signal.actor = timestamp(), payload.actor
        return record(
            db,
            str(payload.client_event_id),
            assignment,
            payload.action,
            data,
            payload.actor,
            principal,
            data["recorded_at"],
            signal,
        )

    @app.post("/sessions/{session_id}/operations", response_model=OperationAck, tags=["tablets"])
    def tablet_command(payload: SignalCommand, session: Assigned, db: DB):
        result = transition(payload, session, db, "session:" + session.id, False)
        commit(db)
        return result

    @app.post("/operator/operations", response_model=OperationAck, tags=["operators"])
    def operator_command(payload: SignalCommand, principal: Operator, db: DB):
        a = db.get(BoothAssignment, str(payload.assignment_id))
        if not a:
            raise HTTPException(404, "Assignment not found")
        result = transition(payload, db.get(AssessorSession, a.session_id), db, principal, True)
        commit(db)
        return result

    @app.get(
        "/booth-board",
        response_model=BoardRead,
        dependencies=[Depends(researcher)],
        tags=["researchers"],
    )
    def booth_board(db: DB):
        """Where each tablet is and what its assessor is doing; no answers are exposed."""
        return board(db, app.state.operations_process)

    @app.post(
        "/booth-board/operations",
        response_model=OperationAck,
        dependencies=[Depends(researcher)],
        tags=["researchers"],
    )
    def board_command(payload: SignalCommand, request: Request, db: DB):
        """Acknowledge or serve from the booth board with the researcher key."""
        a = db.get(BoothAssignment, str(payload.assignment_id))
        if not a:
            raise HTTPException(404, "Assignment not found")
        result = transition(
            payload, db.get(AssessorSession, a.session_id), db, staff_principal(request), True
        )
        commit(db)
        return result

    @app.get("/operator/dashboard", response_model=DashboardRead, tags=["operators"])
    def operator_dashboard(principal: Operator, db: DB):
        return dashboard(db, app.state.operations_process)

    @app.get("/operator/events", tags=["operators"], response_class=StreamingResponse)
    def operator_events(request: Request, principal: Operator, after: int = 0):
        if after < 0:
            raise HTTPException(422, "Cursor must be nonnegative")

        async def stream():
            cursor = after
            while not await request.is_disconnected():
                # Each snapshot/replay read releases its transaction before yielding or waiting.
                with Session(app.state.engine) as db:
                    view = dashboard(db, app.state.operations_process)
                    events = db.scalars(
                        select(OperationalEvent)
                        .where(OperationalEvent.cursor > cursor)
                        .order_by(OperationalEvent.cursor)
                        .limit(100)
                    ).all()
                    replay_rows = [
                        {
                            "cursor": e.cursor,
                            "assignment_id": e.assignment_id,
                            "action": e.action,
                            "received_at": e.received_at,
                        }
                        for e in events
                    ]
                for event in replay_rows:
                    cursor = event["cursor"]
                    yield (
                        "id: "
                        + str(cursor)
                        + "\nevent: operation\ndata: "
                        + json.dumps(event)
                        + "\n\n"
                    )
                yield "event: snapshot\ndata: " + view.model_dump_json() + "\n\n"
                await asyncio.sleep(5)

        return StreamingResponse(
            stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @app.get(
        "/operations/export",
        dependencies=[Depends(researcher)],
        tags=["researchers"],
        response_class=Response,
    )
    def operational_export(db: DB):
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(
            [
                "cursor",
                "client_event_id",
                "assignment_id",
                "signal_id",
                "action",
                "actor",
                "principal",
                "recorded_at",
                "received_at",
                "payload_json",
            ]
        )
        for e in db.scalars(select(OperationalEvent).order_by(OperationalEvent.cursor)):
            writer.writerow(
                [
                    e.cursor,
                    e.client_event_id,
                    e.assignment_id,
                    e.signal_id,
                    e.action,
                    e.actor,
                    e.principal,
                    e.recorded_at,
                    e.received_at,
                    json.dumps(e.payload, ensure_ascii=False),
                ]
            )
        return Response(
            output.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=operations.csv"},
        )
