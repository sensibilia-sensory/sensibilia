"""Form persistence helpers shared by session validation and raw exports."""

import json

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from sensibilia.flows import DraftFlowV2, walk
from sensibilia.forms import StudyForm, progress
from sensibilia.methods import CONFIGURATIONS, required_observations
from sensibilia.models import AssessorSession, FormEvent, Observation, StudyTest, StudyVersion
from sensibilia.schemas import ProgressRead


def assigned_form(db: Session, session: AssessorSession) -> StudyForm | None:
    version = db.get(StudyVersion, session.study_version_id)
    if version.form and version.form.get("schema_version") == 2:
        raise HTTPException(409, "Flow v2 collection is planned for the offline execution slice")
    return StudyForm.model_validate(version.form) if version.form else None


def form_values(db: Session, session_id: str) -> dict[str, dict]:
    return {
        event.step_id: event.value
        for event in db.scalars(select(FormEvent).where(FormEvent.session_id == session_id))
    }


def read_progress(db: Session, session: AssessorSession, form: StudyForm) -> ProgressRead:
    current, outcome, visited = progress(form, form_values(db, session.id))
    message = None
    if outcome:
        message = form.completion_message if outcome == "completed" else form.screen_out_message
    return ProgressRead(
        current_step_id=current, outcome=outcome, visited_step_ids=visited, message=message
    )


def test_complete(db: Session, session_id: str, test: StudyTest) -> bool:
    configuration = CONFIGURATIONS[test.test_type_id].model_validate(test.configuration)
    answered = set(
        db.execute(
            select(Observation.sample_id, Observation.question_id).where(
                Observation.session_id == session_id, Observation.study_test_id == test.id
            )
        )
    )
    return required_observations(configuration) <= answered


def form_rows(
    db: Session,
    study_id: str,
    limit: int | None = None,
    offset: int = 0,
    study_version_id: str | None = None,
):
    statement = (
        select(FormEvent, AssessorSession, StudyVersion)
        .join(AssessorSession, FormEvent.session_id == AssessorSession.id)
        .join(StudyVersion, AssessorSession.study_version_id == StudyVersion.id)
        .where(StudyVersion.study_id == study_id)
        .order_by(FormEvent.received_at, FormEvent.id)
    )
    if study_version_id is not None:
        statement = statement.where(StudyVersion.id == study_version_id)
    if limit is not None:
        statement = statement.limit(limit).offset(offset)
    return db.execute(statement)


def export_form_rows(db: Session, study_id: str, study_version_id: str | None = None):
    for event, session, version in form_rows(db, study_id, study_version_id=study_version_id):
        if version.form.get("schema_version") == 2:
            record = {
                "id": event.id,
                "session_id": session.id,
                "study_test_id": "",
                "sample_id": event.sample_id,
                "question_id": "answer",
                "value": event.value,
                "recorded_at": event.recorded_at,
                "received_at": event.received_at,
                "client_event_id": event.client_event_id,
                "supersedes_event_id": event.supersedes_event_id,
                "study_id": version.study_id,
                "study_version_id": version.id,
                "version_number": version.version_number,
                "assessor_code": session.assessor_code,
                "test_type_id": "",
                "method_key": "",
                "method_schema_version": "",
                "is_current": True,
                "step_id": event.step_id,
                "occurrence_id": event.occurrence_id,
                "form_schema_version": 2,
            }
            flow = DraftFlowV2.model_validate(version.form)
            node = next(n for n in walk(flow.nodes) if str(n.id) == event.step_id)
            record["block_kind"] = node.kind
            if node.kind == "serve_gate":
                record["value"] = {k: event.value[k] for k in ("state", "mode", "codes", "reason")}
            if node.kind == "matrix_question" and event.value["state"] == "matrix":
                for row in node.data.rows:
                    value = event.value["answers"].get(row.id, {"state": "missing"})
                    option = next(
                        (o for o in node.data.options if o.id == value.get("option_id")), None
                    )
                    yield {
                        **record,
                        "question_id": row.id,
                        "value": value,
                        "option_label": option.label.get(
                            session.context.get("language", flow.default_language)
                        )
                        if option
                        else None,
                        "score_json": json.dumps(option.score if option else None),
                    }
            else:
                yield record
            continue
        form = StudyForm.model_validate(version.form)
        step = next(step for step in form.steps if step.id == event.step_id)
        values = {"continue" if step.kind in {"test", "instruction"} else "choice": event.value}
        if step.kind == "matrix":
            values = {
                row.id: event.value["answers"].get(row.id, {"state": "missing"})
                for row in step.rows
            }
        for question_id, value in values.items():
            option = (
                next((option for option in step.scale if option.id == value.get("option_id")), None)
                if step.kind == "matrix"
                else None
            )
            yield {
                "id": event.id,
                "session_id": session.id,
                "study_test_id": step.study_test_id if step.kind == "test" else "",
                "sample_id": None,
                "question_id": question_id,
                "value": value,
                "recorded_at": event.recorded_at,
                "received_at": event.received_at,
                "client_event_id": event.client_event_id,
                "supersedes_event_id": None,
                "study_id": version.study_id,
                "study_version_id": version.id,
                "version_number": version.version_number,
                "assessor_code": session.assessor_code,
                "test_type_id": "",
                "method_key": "",
                "method_schema_version": "",
                "is_current": True,
                "step_id": step.id,
                "block_kind": step.kind,
                "form_schema_version": form.schema_version,
                "occurrence_id": event.occurrence_id,
                "option_label": option.label if option else "",
                "score_json": json.dumps(option.score if option else None),
            }
