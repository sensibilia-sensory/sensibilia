"""Reversible keyed pivot of the existing long ledger; no method reinterpretation."""

import hashlib

from sqlalchemy import select

from sensibilia.data_service import canonical, data_rows
from sensibilia.models import AssessorSession, StudyVersion
from sensibilia.schemas import ExportDictionaryRead, ExportOptions, WideColumnRead

ROW_KEYS = ["study_id", "study_version_id", "version_number", "session_id", "assessor_code"]
KEY_FIELDS = [
    "row_kind",
    "step_id",
    "occurrence_id",
    "study_test_id",
    "sample_id_json",
    "question_id",
    "descriptor_id",
    "path_seq",
    "temporal_run_id",
    "temporal_seq",
]
LIMITS = {"columns": 4096, "sessions": 10000, "records": 250000, "cell_bytes": 67108864}


def pivot(records, sessions, study_id, version_id, options: ExportOptions):
    """All cells hold complete source records; blank CSV cells mean no projected row.

    Corrections share a column, never overwrite one another. Current policy removes
    only explicitly superseded answers, retaining paths, temporal data and expectations.
    Duplicate source row IDs or digest collisions fail instead of silently merging.
    """
    rows = {s["session_id"]: dict(s) for s in sessions}
    if len(rows) > LIMITS["sessions"]:
        raise ValueError("Wide export exceeds session limit; use long CSV")
    keys, seen = {}, set()
    cell_bytes = 0
    for index, record in enumerate(records):
        if index >= LIMITS["records"]:
            raise ValueError("Wide export exceeds record limit; use long CSV")
        if record.row_id in seen:
            raise ValueError("Duplicate ledger row ID; wide export refused")
        seen.add(record.row_id)
        if options.history == "current" and record.is_current is False:
            continue
        value = record.model_dump(mode="json")
        cell_bytes += len(canonical(value).encode("utf-8"))
        if cell_bytes > LIMITS["cell_bytes"]:
            raise ValueError("Wide export exceeds cell byte limit; use long CSV")
        key = canonical({k: value[k] for k in KEY_FIELDS})
        column = "w_" + hashlib.sha256(key.encode("utf-8")).hexdigest()
        if column in keys and keys[column] != key:
            raise ValueError("Wide column collision; export refused")
        keys[column] = key
        if len(keys) > LIMITS["columns"]:
            raise ValueError("Wide export exceeds column limit; use long CSV")
        session_row = rows.setdefault(record.session_id, {k: value[k] for k in ROW_KEYS})
        if len(rows) > LIMITS["sessions"]:
            raise ValueError("Wide export exceeds session limit; use long CSV")
        session_row.setdefault(column, []).append(value)
    columns = sorted(keys, key=lambda column: keys[column])
    dictionary = ExportDictionaryRead(
        study_id=study_id,
        study_version_id=version_id,
        options=options,
        row_keys=ROW_KEYS,
        key_fields=KEY_FIELDS,
        cell_encoding=(
            "Nonblank cell: JSON array of complete DataRowRead records in ledger order. "
            "Blank cell: no projected record for this session/key. Flatten arrays to "
            "recover selected long records; cell nulls and JSON strings are retained."
        ),
        history_policy=(
            "All: every immutable history record. Current: omit only is_current=false "
            "records; retain paths, temporal records and expected missing slots. No "
            "averaging, scoring or latest-timestamp selection."
        ),
        state_policy=(
            "Expected missing is synthetic with null event/timestamps; submitted "
            "missing, skipped, unselected, selected/unrated and numeric zero retain "
            "original state/value_json. Path omissions remain separate records, never "
            "answers."
        ),
        limits=LIMITS,
        columns=[
            WideColumnRead(
                column=c,
                key_json=keys[c],
                description="Complete ledger records for this exact key; no scalar conversion.",
            )
            for c in columns
        ],
    )
    encoded_rows = [
        {k: canonical(v) if k not in ROW_KEYS else v for k, v in row.items()}
        for row in rows.values()
    ]
    return dictionary, encoded_rows


def wide_data(db, study_id, version_id, options):
    query = (
        select(AssessorSession, StudyVersion)
        .join(StudyVersion)
        .where(StudyVersion.study_id == study_id)
        .order_by(AssessorSession.started_at, AssessorSession.id)
    )
    if version_id:
        query = query.where(StudyVersion.id == version_id)
    query = query.limit(LIMITS["sessions"] + 1)
    sessions = [
        dict(
            study_id=study_id,
            study_version_id=v.id,
            version_number=v.version_number,
            session_id=s.id,
            assessor_code=s.assessor_code,
        )
        for s, v in db.execute(query)
    ]
    return pivot(data_rows(db, study_id, version_id), sessions, study_id, version_id, options)
