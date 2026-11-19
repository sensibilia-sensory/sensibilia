"""The R-ready CSV: one plain value per cell, states kept apart."""

import csv
import io
import json

from test_api import event, provision, submit
from test_method_library import make_study

from sensibilia.export_service import R_COLUMNS, r_csv
from sensibilia.schemas import DataRowRead


def row(**changes):
    fields = dict(
        row_id="r",
        row_kind="answer",
        study_id="study",
        study_version_id="v",
        version_number=1,
        session_id="s",
        assessor_code="A1",
        question_id="q",
        value_json="null",
        state="rated",
        is_current=True,
    )
    return DataRowRead(**(fields | changes))


def parse(records, history="current"):
    return list(csv.DictReader(io.StringIO(r_csv(records, history))))


def test_values_are_plain_and_states_stay_apart():
    rows = parse(
        [
            row(row_id="1", value_json=json.dumps({"state": "rated", "rating": 0})),
            row(
                row_id="2",
                state="selected",
                value_json=json.dumps({"state": "selected", "rating": 4}),
            ),
            row(
                row_id="3",
                state="selected",
                value_json=json.dumps({"state": "selected", "rating": None}),
            ),
            row(row_id="4", state="unselected", value_json='{"state":"unselected"}'),
            row(row_id="5", state="skipped", value_json='{"state":"skipped","rating":null}'),
            row(row_id="6", row_kind="expected_missing", state="missing"),
            row(
                row_id="7",
                row_kind="form_answer",
                state="answered",
                value_json='{"state":"answered","value":"yes"}',
            ),
        ]
    )
    assert [(r["state"], r["value"]) for r in rows] == [
        ("rated", "0"),  # a real zero is a value
        ("selected", "4"),
        ("selected", ""),  # selected with no rating: no value, not zero
        ("unselected", ""),
        ("skipped", ""),
        ("missing", ""),
        ("answered", "yes"),
    ]
    assert list(rows[0]) == R_COLUMNS
    # No JSON objects anywhere in the file.
    assert not any(c.startswith(("{", "[")) for r in rows for c in r.values())


def test_lists_become_one_row_per_choice_and_empty_lists_are_unselected():
    rows = parse(
        [
            row(state="answered", value_json='{"state":"answered","value":["a","b"]}'),
            row(row_id="e", state="unselected", value_json='{"state":"answered","value":[]}'),
        ]
    )
    assert [(r["state"], r["value"]) for r in rows] == [
        ("answered", "a"),
        ("answered", "b"),
        ("unselected", ""),
    ]


def test_history_paths_and_timings_and_method_columns():
    old = row(row_id="old", is_current=False, value_json='{"state":"rated","rating":2}')
    new = row(row_id="new", value_json='{"state":"rated","rating":3}')
    path = row(row_id="p", row_kind="path", state="visited")
    assert [r["value"] for r in parse([old, new, path])] == ["3"]
    assert [r["value"] for r in parse([old, new, path], "all")] == ["2", "3"]
    flash = row(
        value_json='{"state":"profile"}',
        state="profile",
        rank=2,
        descriptor="sweet",
        sample_code="A",
    )
    choice = row(
        value_json='{"state":"chosen"}', state="chosen", selected_code="317", correct=False
    )
    got = parse([flash, choice])
    assert (got[0]["value"], got[0]["rank"], got[0]["descriptor"]) == ("2", "2", "sweet")
    assert (got[1]["value"], got[1]["correct"]) == ("317", "FALSE")


def test_endpoint_serves_r_csv_with_current_answers_by_default(client, researcher_headers):
    h = researcher_headers
    study, test, version, samples = make_study(
        client, h, "rata", rating_min=0, require_ratings=False, allow_skips=True
    )
    session, token = provision(client, h, version)
    first = event(
        test,
        sample_id=samples[0]["id"],
        question_id="sweet",
        value={"kind": "rata", "state": "selected", "rating": 0},
    )
    assert submit(client, session, token, [first]).status_code == 200
    url = f"/studies/{study['id']}/export"
    assert client.get(url, params={"format": "r"}).status_code == 401
    result = client.get(url, headers=h, params={"format": "r"})
    assert result.status_code == 200
    assert result.headers["content-type"].startswith("text/csv")
    rows = list(csv.DictReader(io.StringIO(result.text)))
    answer = next(r for r in rows if r["question_id"] == "sweet")
    assert (answer["state"], answer["value"], answer["sample_code"]) == ("selected", "0", "317")
    assert answer["assessor_code"] == "A001"
    # The long export is unchanged: it still carries the JSON column.
    assert "value_json" in client.get(url, headers=h).text.splitlines()[0]
