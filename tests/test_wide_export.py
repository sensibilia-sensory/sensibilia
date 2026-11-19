"""Keyed wide exports reuse the migrated long ledger and preserve every state."""

import csv
import io
import json

import pytest
from test_api import event, provision, submit
from test_method_library import make_study

from sensibilia.schemas import DataRowRead, ExportOptions
from sensibilia.wide_export import KEY_FIELDS, pivot


def row(**changes):
    fields = dict(
        row_id="event",
        row_kind="answer",
        study_id="study",
        study_version_id="v",
        version_number=1,
        session_id="s",
        assessor_code='Å, "quoted"\nline',
        question_id="q",
        value_json='{"state":"selected","rating":0}',
        state="selected",
        is_current=True,
    )
    return DataRowRead(**(fields | changes))


def flatten(records):
    return [
        value
        for record in records
        for column, cell in record.items()
        if column.startswith("w_") and cell
        for value in json.loads(cell)
    ]


def test_history_roundtrip_states_and_empty_cells():
    values = [
        row(row_id=str(i), is_current=i == 3, value_json=json.dumps(value), state=value["state"])
        for i, value in enumerate(
            [
                {"state": "selected", "rating": 0},
                {"state": "selected", "rating": None},
                {"state": "unselected", "rating": None},
                {"state": "skipped", "rating": None},
            ]
        )
    ]
    values += [
        row(
            row_id="missing",
            row_kind="expected_missing",
            state="missing",
            value_json="null",
            is_current=None,
        )
    ]
    dictionary, rows = pivot(values, [], "study", "v", ExportOptions(format="wide"))
    assert len(dictionary.columns) == 2
    assert sorted(flatten(rows), key=lambda r: r["row_id"]) == sorted(
        [r.model_dump(mode="json") for r in values], key=lambda r: r["row_id"]
    )
    assert dictionary.key_fields == KEY_FIELDS
    current, records = pivot(
        values, [], "study", "v", ExportOptions(format="wide", history="current")
    )
    assert {r["row_id"] for r in flatten(records)} == {"3", "missing"}
    assert current.options.history == "current"
    assert rows[0]["assessor_code"] == values[0].assessor_code


@pytest.mark.parametrize(
    "dimension",
    [
        "occurrence_id",
        "step_id",
        "sample_id_json",
        "descriptor_id",
        "temporal_seq",
        "path_seq",
        "temporal_run_id",
    ],
)
def test_repeated_occurrences_and_sequences_never_merge(dimension):
    a = row(row_id="a")
    b = row(row_id="b", **{dimension: 2 if dimension.endswith("seq") else '"other"'})
    dictionary, records = pivot([a, b], [], "study", None, ExportOptions(format="wide"))
    assert len(dictionary.columns) == 2
    assert len(flatten(records)) == 2
    assert len({c.column for c in dictionary.columns}) == 2


def test_duplicate_keys_keep_history_duplicate_rows_fail_and_bounds(monkeypatch):
    import sensibilia.wide_export as module

    a, b = row(), row(row_id="correction", is_current=False)
    dictionary, records = pivot([a, b], [], "study", None, ExportOptions(format="wide"))
    assert len(dictionary.columns) == 1 and len(flatten(records)) == 2
    with pytest.raises(ValueError, match="Duplicate ledger"):
        pivot([a, a], [], "study", None, ExportOptions(format="wide"))
    monkeypatch.setitem(module.LIMITS, "columns", 0)
    with pytest.raises(ValueError, match="column limit"):
        pivot([a], [], "study", None, ExportOptions(format="wide"))


@pytest.mark.parametrize("endpoint", ["export?format=wide", "export/dictionary"])
def test_wide_auth_scope_empty_and_query_contract(client, researcher_headers, endpoint):
    study = client.post("/studies", headers=researcher_headers, json={"title": "Empty"}).json()
    other = client.post("/studies", headers=researcher_headers, json={"title": "Other"}).json()
    url = f"/studies/{study['id']}/{endpoint}"
    assert client.get(url).status_code == 401
    assert (
        client.get(
            url, headers=researcher_headers, params={"study_version_id": other["versions"][0]["id"]}
        ).status_code
        == 404
    )
    assert (
        client.get(url, headers=researcher_headers, params={"history": "latest"}).status_code == 422
    )
    result = client.get(url, headers=researcher_headers)
    assert result.status_code == 200
    if "dictionary" in endpoint:
        assert result.json()["columns"] == []
        assert result.json()["options"] == {"format": "wide", "history": "all"}
    else:
        reader = csv.DictReader(io.StringIO(result.text))
        assert list(reader) == []
        assert "session_id" in reader.fieldnames
    assert (
        client.get(
            f"/studies/{study['id']}/export?format=unknown", headers=researcher_headers
        ).status_code
        == 422
    )


def test_real_api_corrections_long_default_and_wide_lossless(client, researcher_headers):
    h = researcher_headers
    study, test, version, samples = make_study(
        client, h, "rata", rating_min=0, require_ratings=False, allow_skips=True
    )
    session, token = provision(client, h, version)
    original = event(
        test,
        sample_id=samples[0]["id"],
        question_id="sweet",
        value={"kind": "rata", "state": "selected", "rating": 0},
    )
    assert submit(client, session, token, [original]).status_code == 200
    correction = event(
        test,
        sample_id=samples[0]["id"],
        question_id="sweet",
        value={"kind": "rata", "state": "selected", "rating": None},
    )
    correction["supersedes_event_id"] = original["client_event_id"]
    assert submit(client, session, token, [correction]).status_code == 200
    assert submit(client, session, token, [correction]).json()["events"][0]["status"] == "duplicate"
    url = f"/studies/{study['id']}"
    long = client.get(url + "/export", headers=h)
    assert long.text == client.get(url + "/export?format=long&history=all", headers=h).text
    source = client.get(url + "/data", headers=h).json()
    for policy in ["all", "current"]:
        params = {"study_version_id": version["id"], "history": policy}
        dictionary = client.get(url + "/export/dictionary", headers=h, params=params).json()
        exported = client.get(url + "/export", headers=h, params=params | {"format": "wide"})
        reader = csv.DictReader(io.StringIO(exported.text))
        records = list(reader)
        assert reader.fieldnames == dictionary["row_keys"] + [
            c["column"] for c in dictionary["columns"]
        ]
        assert len(records) == 1 and records[0]["session_id"] == session["id"]
        recovered = flatten(records)
        expected = [r for r in source if policy == "all" or r["is_current"] is not False]
        assert sorted(recovered, key=lambda r: r["row_id"]) == sorted(
            expected, key=lambda r: r["row_id"]
        )
        assert any(r["state"] == "missing" for r in recovered)
        for column in dictionary["columns"]:
            for record in json.loads(records[0][column["column"]]):
                assert json.loads(column["key_json"]) == {k: record[k] for k in KEY_FIELDS}
    draft = client.post(url + "/drafts", headers=h).json()
    assert (
        list(
            csv.DictReader(
                io.StringIO(
                    client.get(
                        url + "/export",
                        headers=h,
                        params={"format": "wide", "study_version_id": draft["id"]},
                    ).text
                )
            )
        )
        == []
    )


def test_submitted_missing_matrix_rows_and_blank_session_are_distinct():
    values = [
        row(
            row_id="a",
            row_kind="form_answer",
            question_id="a",
            state="missing",
            value_json='{"state":"missing"}',
            client_event_id="matrix-event",
        ),
        row(
            row_id="b",
            row_kind="form_answer",
            question_id="b",
            state="selected",
            value_json='{"state":"selected","option_id":"zero"}',
            score_json="0",
            client_event_id="matrix-event",
        ),
        row(
            row_id="expectation",
            row_kind="expected_missing",
            question_id="c",
            state="missing",
            value_json="null",
            is_current=None,
        ),
    ]
    empty = {
        "study_id": "study",
        "study_version_id": "v",
        "version_number": 1,
        "session_id": "empty",
        "assessor_code": "B",
    }
    dictionary, records = pivot(values, [empty], "study", "v", ExportOptions(format="wide"))
    assert len(records) == 2 and len(dictionary.columns) == 3
    assert not any(k.startswith("w_") for k in records[0])
    assert records[0]["session_id"] == "empty"
    assert sorted(flatten(records), key=lambda r: r["row_id"]) == sorted(
        [r.model_dump(mode="json") for r in values], key=lambda r: r["row_id"]
    )


def test_key_headers_are_deterministic_across_ledger_order_and_versions():
    a, b = (
        row(row_id="a"),
        row(row_id="b", question_id="other", study_version_id="v2", session_id="s2"),
    )
    first, _ = pivot([a, b], [], "study", None, ExportOptions(format="wide"))
    second, records = pivot([b, a], [], "study", None, ExportOptions(format="wide"))
    assert first.columns == second.columns
    assert {r["study_version_id"] for r in records} == {"v", "v2"}


@pytest.mark.parametrize("bound", ["sessions", "records", "cell_bytes"])
def test_resource_bounds_refuse_without_partial_output(monkeypatch, bound):
    import sensibilia.wide_export as module

    monkeypatch.setitem(module.LIMITS, bound, 0)
    with pytest.raises(ValueError, match="limit"):
        pivot([row()], [], "study", None, ExportOptions(format="wide"))
