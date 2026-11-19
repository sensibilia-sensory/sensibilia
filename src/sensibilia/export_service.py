"""CSV encoders shared by live exports and immutable snapshots."""

import csv
import io
import json

from sensibilia.method_exports import EXPORT_COLUMNS
from sensibilia.schemas import DataRowRead, ObservationRead


def long_csv(records, history="all"):
    columns = list(ObservationRead.model_fields)
    columns[columns.index("value")] = "value_json"
    columns[columns.index("sample_id")] = "sample_id_json"
    columns += [
        c
        for c in ["step_id", "block_kind", "form_schema_version", "option_label", "score_json"]
        if c not in columns
    ]
    columns += EXPORT_COLUMNS
    columns += [c for c in DataRowRead.model_fields if c not in columns]
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=columns)
    writer.writeheader()
    for record in records:
        if history == "all" or record.is_current is not False:
            writer.writerow(record.model_dump())
    return output.getvalue()


def wide_csv(dictionary, rows):
    output = io.StringIO(newline="")
    writer = csv.DictWriter(
        output, fieldnames=dictionary.row_keys + [c.column for c in dictionary.columns]
    )
    writer.writeheader()
    writer.writerows(rows)
    return output.getvalue()


R_COLUMNS = [
    "study_id",
    "version_number",
    "session_id",
    "assessor_code",
    "row_kind",
    "step_id",
    "occurrence_id",
    "method",
    "question_id",
    "question",
    "sample_code",
    "sample_position",
    "state",
    "value",
    "value_label",
    "score",
    "descriptor",
    "rank",
    "x",
    "y",
    "selected_code",
    "correct",
    "is_current",
    "recorded_at",
    "received_at",
    "client_event_id",
]
R_ROW_KINDS = {"answer", "form_answer", "expected_missing"}
R_SKIPPED_STATES = {"continue", "code", "delivery"}


def r_values(value):
    """Plain scalars for one record: a list answer gives one entry per chosen option.

    Nothing is invented: an absent value is `None` (an empty cell, NA in R) and the `state`
    column says why (skipped, missing, unselected, or a state such as "selected" with no value).
    """
    if not isinstance(value, dict):
        return [None]
    if value.get("rating") is not None:
        return [value["rating"]]
    if value.get("state") == "answered":
        answer = value.get("value")
        if isinstance(answer, list):
            return answer or [None]
        return [answer]
    return [value.get("option_id")]


def r_csv(records, history="current"):
    """One plain value per cell, for `read.csv` or `readr::read_csv`.

    Lossless history stays in the long export; this view drops the JSON columns, answers that are
    not observations (paths, timings, delivery, code entry) and writes one row per value.
    """
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=R_COLUMNS, lineterminator="\n")
    writer.writeheader()
    for record in records:
        if record.row_kind not in R_ROW_KINDS or record.state in R_SKIPPED_STATES:
            continue
        if history == "current" and record.is_current is False:
            continue
        value = json.loads(record.value_json)
        score = json.loads(record.score_json) if record.score_json else None
        base = {
            "study_id": record.study_id,
            "version_number": record.version_number,
            "session_id": record.session_id,
            "assessor_code": record.assessor_code,
            "row_kind": record.row_kind,
            "step_id": record.step_id,
            "occurrence_id": record.occurrence_id,
            "method": record.method_key,
            "question_id": record.question_id,
            "question": record.attribute_label,
            "sample_code": record.sample_code,
            "sample_position": record.sample_position,
            "state": record.state,
            "value_label": record.option_label,
            "score": score if isinstance(score, (int, float)) else None,
            "descriptor": record.descriptor,
            "rank": record.rank,
            "x": record.x,
            "y": record.y,
            "selected_code": record.selected_code,
            "correct": None if record.correct is None else str(record.correct).upper(),
            "is_current": None if record.is_current is None else str(record.is_current).upper(),
            "recorded_at": record.recorded_at,
            "received_at": record.received_at,
            "client_event_id": record.client_event_id,
        }
        for entry in r_values(value):
            if entry is None and record.rank is not None:
                entry = record.rank
            if entry is None and record.selected_code:
                entry = record.selected_code
            writer.writerow({**base, "value": entry})
    return output.getvalue()
