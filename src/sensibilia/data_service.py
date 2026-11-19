"""Read-only provenance and lossless long export from existing immutable ledgers."""

import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from sensibilia.flow_semantics import outline
from sensibilia.flows import DraftFlowV2
from sensibilia.form_service import export_form_rows
from sensibilia.forms import StudyForm, TestStep
from sensibilia.method_exports import method_rows
from sensibilia.methods import CONFIGURATIONS, required_observations, sample_ids
from sensibilia.models import (
    AssessorSession,
    Observation,
    PathEvent,
    Sample,
    StudyTest,
    StudyVersion,
    TemporalEvent,
    TemporalRun,
    TestType,
)
from sensibilia.schemas import DataRowRead, ObservationRead, PathEventRead


def response_rows(
    db: Session,
    study_id: str,
    limit: int | None = None,
    offset: int = 0,
    study_version_id: str | None = None,
):
    superseded = select(Observation.supersedes_event_id).where(
        Observation.supersedes_event_id.is_not(None)
    )
    statement = (
        select(
            Observation,
            AssessorSession,
            StudyVersion,
            TestType,
            (~Observation.client_event_id.in_(superseded)).label("is_current"),
        )
        .join(AssessorSession, Observation.session_id == AssessorSession.id)
        .join(StudyVersion, AssessorSession.study_version_id == StudyVersion.id)
        .join(StudyTest, Observation.study_test_id == StudyTest.id)
        .join(TestType, StudyTest.test_type_id == TestType.id)
        .where(StudyVersion.study_id == study_id)
        .order_by(Observation.received_at, Observation.id)
    )
    if study_version_id is not None:
        statement = statement.where(StudyVersion.id == study_version_id)
    if limit is not None:
        statement = statement.limit(limit).offset(offset)
    return db.execute(statement)


def observation_read(row) -> ObservationRead:
    observation, session, version, method, current = row
    fields = {
        column.name: getattr(observation, column.name) for column in Observation.__table__.columns
    }
    return ObservationRead(
        **fields,
        study_id=version.study_id,
        study_version_id=version.id,
        version_number=version.version_number,
        assessor_code=session.assessor_code,
        test_type_id=method.id,
        method_key=method.key,
        method_schema_version=method.schema_version,
        is_current=bool(current),
    )


def path_rows(db, study_id, limit=None, offset=0, study_version_id=None):
    query = (
        select(PathEvent, AssessorSession, StudyVersion)
        .join(AssessorSession, PathEvent.session_id == AssessorSession.id)
        .join(StudyVersion, AssessorSession.study_version_id == StudyVersion.id)
        .where(StudyVersion.study_id == study_id)
        .order_by(AssessorSession.started_at, AssessorSession.id, PathEvent.seq)
    )
    if study_version_id is not None:
        query = query.where(StudyVersion.id == study_version_id)
    if limit is not None:
        query = query.limit(limit).offset(offset)
    return db.execute(query)


def path_read(row):
    event, session, version = row
    return PathEventRead(
        **{c.name: getattr(event, c.name) for c in PathEvent.__table__.columns},
        study_id=version.study_id,
        study_version_id=version.id,
        version_number=version.version_number,
        assessor_code=session.assessor_code,
    )


def canonical(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def value_state(value):
    if value.get("state") == "answered" and value.get("value") == []:
        return "unselected"
    return value.get("state")


def encoded(record, kind):
    record = dict(record)
    if record.get("method_schema_version") == "":
        record["method_schema_version"] = None
    record.update(
        row_kind=kind,
        state=record.get("state", value_state(record.get("value") or {})),
        value_json=canonical(record.pop("value", None)),
        sample_id_json=canonical(record.pop("sample_id", None)),
    )
    record["row_id"] = ":".join(
        str(record.get(k) or "")
        for k in (
            "row_kind",
            "session_id",
            "id",
            "step_id",
            "occurrence_id",
            "study_test_id",
            "question_id",
            "descriptor_id",
            "sample_id_json",
        )
    )
    return DataRowRead.model_validate(record)


def ledger_rows(db, study_id, study_version_id=None):
    """Answers/history first, then audited paths and explicitly synthetic frozen slots.

    Missing slots are expectations, including guarded/unvisited slots; their timestamps
    and event IDs are null. They are never written back as collected observations.
    """
    present = set()
    for row in response_rows(db, study_id, study_version_id=study_version_id):
        record = observation_read(row).model_dump(mode="json")
        version = row[2]
        if version.form:
            if version.form.get("schema_version") == 2:
                record.update(block_kind="embedded_method", form_schema_version=2)
            else:
                form = StudyForm.model_validate(version.form)
                step = next(
                    s
                    for s in form.steps
                    if isinstance(s, TestStep) and s.study_test_id == record["study_test_id"]
                )
                record.update(step_id=step.id, block_kind="test", form_schema_version=1)
        present.add(
            (
                record["session_id"],
                record["study_test_id"],
                record["sample_id"],
                record["question_id"],
            )
        )
        for method_record in method_rows(db, record):
            yield encoded(method_record, "answer")
    temporal_query = (
        select(TemporalRun, AssessorSession, StudyVersion, StudyTest)
        .join(AssessorSession, TemporalRun.session_id == AssessorSession.id)
        .join(StudyVersion, AssessorSession.study_version_id == StudyVersion.id)
        .join(StudyTest, TemporalRun.study_test_id == StudyTest.id)
        .where(StudyVersion.study_id == study_id)
        .order_by(TemporalRun.received_at, TemporalRun.id)
    )
    if study_version_id:
        temporal_query = temporal_query.where(StudyVersion.id == study_version_id)
    for run, session, version, test in db.execute(temporal_query):
        value = run.payload["value"]
        base = dict(
            id=run.id,
            client_event_id=run.client_event_id,
            session_id=session.id,
            study_id=study_id,
            study_version_id=version.id,
            version_number=version.version_number,
            assessor_code=session.assessor_code,
            study_test_id=test.id,
            test_type_id="tcata-v1",
            method_key="tcata",
            method_schema_version=1,
            step_id=run.step_id,
            occurrence_id=run.occurrence_id,
            sample_id=run.sample_id,
            question_id="temporal",
            block_kind="embedded_method",
            form_schema_version=2,
            is_current=True,
            recorded_at=run.recorded_at,
            received_at=run.received_at,
            temporal_attributes_json=canonical(test.configuration["attributes"]),
            temporal_run_id=run.id,
            clock_resolution_ms=value["clock_resolution_ms"],
            interruption_flags_json=canonical(value["interruption_flags"]),
        )
        present.add((session.id, test.id, run.sample_id, "temporal"))
        yield encoded(
            dict(
                base,
                value=value,
                state=value["state"],
                temporal_elapsed_milliseconds=value["elapsed_ms"],
            ),
            "temporal_run",
        )
        for event in db.scalars(
            select(TemporalEvent).where(TemporalEvent.run_id == run.id).order_by(TemporalEvent.seq)
        ):
            transition = {c.name: getattr(event, c.name) for c in TemporalEvent.__table__.columns}
            transition["selected"] = bool(transition["selected"])
            yield encoded(
                dict(
                    base,
                    id=event.client_event_id,
                    client_event_id=event.client_event_id,
                    question_id=event.attribute_id,
                    recorded_at=event.recorded_at,
                    value=transition,
                    state="selected" if event.selected else "unselected",
                    temporal_seq=event.seq,
                    temporal_elapsed_milliseconds=event.elapsed_ms,
                    attribute_label=next(
                        a["prompt"]
                        for a in test.configuration["attributes"]
                        if a["id"] == event.attribute_id
                    ),
                ),
                "temporal_transition",
            )
    for record in export_form_rows(db, study_id, study_version_id):
        present.add(
            (
                record["session_id"],
                record["step_id"],
                record["occurrence_id"],
                record["question_id"],
            )
        )
        yield encoded(record, "form_answer")
    reasons = {}
    for row in path_rows(db, study_id, study_version_id=study_version_id):
        event = path_read(row).model_dump()
        event.update(
            value=None,
            path_seq=event.pop("seq"),
            path_kind=event.pop("kind"),
            skip_reason=event.pop("reason"),
            answer_event_ids_json=canonical(event.pop("answer_event_ids")),
        )
        event["state"] = "skipped" if event["path_kind"] == "skipped" else None
        if event["skip_reason"]:
            reasons[(event["session_id"], event["step_id"], event["occurrence_id"])] = event[
                "skip_reason"
            ]
        yield encoded(event, "path")
    query = (
        select(AssessorSession, StudyVersion)
        .join(StudyVersion)
        .where(StudyVersion.study_id == study_id)
        .order_by(AssessorSession.started_at, AssessorSession.id)
    )
    if study_version_id:
        query = query.where(StudyVersion.id == study_version_id)
    for session, version in db.execute(query):
        base = dict(
            study_id=study_id,
            study_version_id=version.id,
            version_number=version.version_number,
            session_id=session.id,
            assessor_code=session.assessor_code,
            value=None,
            state="missing",
        )
        tests = list(
            db.scalars(
                select(StudyTest)
                .where(StudyTest.study_version_id == version.id)
                .order_by(StudyTest.position)
            )
        )
        if version.form and version.form.get("schema_version") == 2:
            flow = DraftFlowV2.model_validate(version.form)
            assignments = {a["loop_id"]: a["samples"] for a in session.loop_assignments}

            # Enumerate the existing validated outline; do not evaluate a second path.
            slots = []
            for node, ancestors, _ in outline(flow.nodes):
                if node.kind in {"group", "loop_samples", "end"}:
                    continue
                loop_id = next((id for id in ancestors if id in assignments), None)
                contexts = (
                    [("study", None)]
                    if loop_id is None
                    else [
                        (loop_id + ":" + s["sample_id"], s["sample_id"])
                        for s in assignments[loop_id]
                    ]
                )
                slots.extend((node, occurrence, sample) for occurrence, sample in contexts)
            for node, occurrence, sample in slots:
                fields = dict(
                    base,
                    step_id=str(node.id),
                    occurrence_id=occurrence,
                    sample_id=sample,
                    block_kind=node.kind,
                    form_schema_version=2,
                    skip_reason=reasons.get((session.id, str(node.id), occurrence)),
                )
                if node.kind == "embedded_method":
                    test = next(t for t in tests if t.id == str(node.data.study_test_id))
                    questions = [q["id"] for q in test.configuration.get("questions", [])] or [
                        q
                        for _, q in required_observations(
                            CONFIGURATIONS[test.test_type_id].model_validate(test.configuration)
                        )
                    ]
                    for question in questions:
                        if (session.id, test.id, sample, question) not in present:
                            yield missing_method(db, fields, test, question)
                else:
                    questions = (
                        [r.id for r in node.data.rows]
                        if node.kind == "matrix_question"
                        else ["answer"]
                    )
                    for question in questions:
                        if (session.id, str(node.id), occurrence, question) not in present:
                            yield encoded(dict(fields, question_id=question), "expected_missing")
        else:
            if version.form:
                form = StudyForm.model_validate(version.form)
                for step in form.steps:
                    questions = (
                        [r.id for r in step.rows]
                        if step.kind == "matrix"
                        else ["continue" if step.kind in {"test", "instruction"} else "choice"]
                    )
                    for question in questions:
                        if (session.id, step.id, None, question) not in present:
                            yield encoded(
                                dict(
                                    base,
                                    step_id=step.id,
                                    question_id=question,
                                    block_kind=step.kind,
                                    form_schema_version=1,
                                ),
                                "expected_missing",
                            )
            for test in tests:
                config = CONFIGURATIONS[test.test_type_id].model_validate(test.configuration)
                slots = (
                    {(s, q.id) for s in sample_ids(config) or [None] for q in config.questions}
                    if hasattr(config, "questions")
                    else required_observations(config)
                )
                for sample, question in sorted(slots, key=lambda p: (p[0] or "", p[1])):
                    if (session.id, test.id, sample, question) not in present:
                        yield missing_method(db, dict(base, sample_id=sample), test, question)


def missing_method(db, fields, test, question):
    method = db.get(TestType, test.test_type_id)
    record = dict(
        fields,
        study_test_id=test.id,
        question_id=question,
        test_type_id=method.id,
        method_key=method.key,
        method_schema_version=method.schema_version,
    )
    sample = db.get(Sample, fields["sample_id"]) if fields.get("sample_id") else None
    if sample:
        record.update(sample_code=sample.code, sample_label=sample.label)
    return encoded(record, "expected_missing")


def data_rows(db, study_id, study_version_id=None):
    """Add frozen assignment provenance to the existing shared ledger projection."""
    sessions = {}
    for row in ledger_rows(db, study_id, study_version_id):
        session = sessions.setdefault(row.session_id, db.get(AssessorSession, row.session_id))
        assignment = next(
            (
                a
                for a in session.loop_assignments
                if row.occurrence_id and row.occurrence_id.startswith(a["loop_id"] + ":")
            ),
            None,
        )
        if assignment:
            sample = next(
                (
                    s
                    for s in assignment["samples"]
                    if row.occurrence_id == assignment["loop_id"] + ":" + s["sample_id"]
                ),
                None,
            )
            updates = {
                k: assignment.get(k)
                for k in (
                    "design_id",
                    "design_seed",
                    "design_algorithm",
                    "generator_version",
                    "allocation_ordinal",
                    "sequence_index",
                )
            }
            if sample:
                updates.update(
                    sample_position=sample["position"],
                    serving_slot_id=row.occurrence_id,
                    sample_code=sample["code"],
                )
            row = row.model_copy(update=updates)
        yield row
