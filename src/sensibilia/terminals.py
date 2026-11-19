"""Terminal access and immutable, attributable assignment history."""

import hashlib
import re
import secrets
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from sensibilia.flow_service import is_v2
from sensibilia.models import (
    AssessorSession,
    FormEvent,
    Observation,
    PathEvent,
    Study,
    StudyVersion,
    TemporalRun,
    Terminal,
    TerminalAssignment,
    TerminalAudit,
    timestamp,
)
from sensibilia.schemas import TerminalRead

# No 0/O/1/I/L: the code is read from a screen and typed on a tablet when scanning fails.
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
PAIRING_MINUTES = 10


def new_pairing_code() -> str:
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(8))


def normalise_code(code: str) -> str:
    return re.sub(r"[\s-]", "", code).upper()


def pairing_expiry() -> str:
    return (datetime.now(UTC) + timedelta(minutes=PAIRING_MINUTES)).isoformat()


REMOVED_MARK = " (removed "


def release_name(terminal: Terminal) -> None:
    """Give a removed tablet's name back: it keeps the old name plus a marker, so history still
    reads "Tablet 01 (removed ab12cd)" and the next tablet can be called Tablet 01."""
    if REMOVED_MARK not in terminal.name:
        terminal.name = f"{terminal.name}{REMOVED_MARK}{terminal.id[:6]})"


def release_removed_names(db: Session) -> None:
    """Free the names of tablets removed before names were released on removal."""
    for terminal in db.scalars(
        select(Terminal).where(
            Terminal.retired_at.is_not(None), ~Terminal.name.contains(REMOVED_MARK)
        )
    ):
        release_name(terminal)
    db.flush()


def next_terminal_name(db: Session) -> str:
    """The lowest unused number, so a removed tablet's number goes to the next new tablet."""
    release_removed_names(db)
    used = {
        int(m.group(1))
        for name in db.scalars(select(Terminal.name))
        if (m := re.fullmatch(r"Tablet (\d+)", name))
    }
    number = 1
    while number in used:
        number += 1
    return f"Tablet {number:02d}"


def digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def current_assignment(db: Session, terminal_id: str) -> TerminalAssignment | None:
    return db.scalar(
        select(TerminalAssignment).where(
            TerminalAssignment.terminal_id == terminal_id,
            TerminalAssignment.released_at.is_(None),
        )
    )


def terminal_read(db: Session, terminal: Terminal) -> TerminalRead:
    assigned = current_assignment(db, terminal.id)
    session = db.get(AssessorSession, assigned.session_id) if assigned else None
    return TerminalRead(
        id=terminal.id,
        name=terminal.name,
        revision=terminal.revision,
        booth_id=terminal.booth_id,
        registered_at=terminal.registered_at,
        retired_at=terminal.retired_at,
        session_id=session.id if session else None,
        assessor_code=session.assessor_code if session else None,
        study_version_id=session.study_version_id if session else None,
        session_status=session.status if session else None,
    )


def checked_terminal(db: Session, terminal_id: str, expected_revision: int) -> Terminal:
    terminal = db.get(Terminal, terminal_id)
    if not terminal:
        raise HTTPException(404, "Terminal not found")
    if terminal.retired_at:
        raise HTTPException(409, "Terminal is retired; register its replacement")
    if terminal.revision != expected_revision:
        raise HTTPException(409, "Terminal assignment changed; refresh before retrying")
    return terminal


def audit(
    db: Session,
    terminal: Terminal,
    action: str,
    staff_name: str,
    reason: str,
    principal: str,
    session_id: str | None = None,
):
    db.add(
        TerminalAudit(
            terminal_id=terminal.id,
            session_id=session_id,
            action=action,
            staff_name=staff_name,
            reason=reason,
            principal=principal,
            revision=terminal.revision,
        )
    )


def assign_session(
    db: Session,
    terminal: Terminal,
    session_id: str,
    staff_name: str,
    reason: str,
    principal: str,
):
    """Give a terminal its next assessment; the caller commits."""
    session = db.get(AssessorSession, session_id)
    if not session or session.status != "in_progress":
        raise HTTPException(422, "Assign a new in-progress assessment")
    version = db.get(StudyVersion, session.study_version_id)
    study = db.get(Study, version.study_id)
    if study.closed_at or study.archived_at:
        raise HTTPException(409, "This study is closed or archived")
    if not is_v2(version.form):
        raise HTTPException(422, "Terminal execution requires a supported Flow v2 publication")
    if db.scalar(select(TerminalAssignment.id).where(TerminalAssignment.session_id == session.id)):
        raise HTTPException(
            409, "Assessment already belongs to a terminal; preserve its original tablet"
        )
    if any(
        db.scalar(select(model.id).where(model.session_id == session.id).limit(1))
        for model in (Observation, FormEvent, PathEvent, TemporalRun)
    ):
        raise HTTPException(
            409, "Assessment has server progress; prepare a fresh replacement assessment"
        )
    previous = current_assignment(db, terminal.id)
    if previous:
        old = db.get(AssessorSession, previous.session_id)
        if old.status == "in_progress":
            raise HTTPException(
                409, "Finish and synchronise the previous assessment before handover"
            )
        previous.released_at = timestamp()
        db.flush()
    terminal.revision += 1
    db.add(TerminalAssignment(terminal_id=terminal.id, session_id=session.id))
    audit(db, terminal, "assigned", staff_name, reason, principal, session.id)
