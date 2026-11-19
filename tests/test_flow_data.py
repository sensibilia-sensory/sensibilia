"""Scoped, lossless researcher data from the real migrated collection API."""

import csv
import io
import json
from uuid import uuid4

import pytest
from test_api import event, submit
from test_api import provision as legacy_provision
from test_method_library import make_study
from test_offline_execution import NOW, path, provision


def data(client, h, study, version=None):
    response = client.get(
        f"/studies/{study['id']}/data",
        headers=h,
        params={"study_version_id": version["id"]} if version else {},
    )
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.parametrize(
    "endpoint", ["responses", "form-responses", "path-events", "data", "export"]
)
def test_scoped_reads_auth_ownership_pagination_and_empty(client, researcher_headers, endpoint):
    h = researcher_headers
    study, version, _, _, _, session, token = provision(client, h)
    other = client.post("/studies", headers=h, json={"title": "Other"}).json()
    url = f"/studies/{study['id']}/{endpoint}"
    assert client.get(url).status_code == 401
    assert client.get(url, headers=token).status_code == 401
    assert (
        client.get(
            url, headers=h, params={"study_version_id": other["versions"][0]["id"]}
        ).status_code
        == 404
    )
    assert client.get(url, headers=h, params={"study_version_id": str(uuid4())}).status_code == 404
    assert client.get(url, headers=h, params={"study_version_id": "bad"}).status_code == 422
    empty_url = f"/studies/{other['id']}/{endpoint}"
    response = client.get(empty_url, headers=h)
    assert response.status_code == 200
    if endpoint == "export":
        rows = csv.DictReader(io.StringIO(response.text))
        assert list(rows) == []
        assert {"row_kind", "skip_reason", "is_current", "value_json", "sample_id_json"} <= set(
            rows.fieldnames
        )
    else:
        assert response.json() == []
        assert client.get(url, headers=h, params={"limit": 0}).status_code == 422
        assert client.get(url, headers=h, params={"offset": -1}).status_code == 422


def test_v2_path_context_and_expected_missing_have_no_fabricated_events(client, researcher_headers):
    h = researcher_headers
    study, version, method, flow, _, session, token = provision(client, h, True)
    url = f"/sessions/{session['id']}"
    first = path(flow["nodes"][0]["id"], 1, "entered")
    assert (
        client.post(url + "/path-events", headers=token, json={"events": [first]}).status_code
        == 200
    )
    assert (
        client.post(url + "/path-events", headers=token, json={"events": [first]}).json()["events"][
            0
        ]["status"]
        == "duplicate"
    )
    rows = data(client, h, study, version)
    assert len({r["row_id"] for r in rows}) == len(rows)
    missing = [r for r in rows if r["row_kind"] == "expected_missing"]
    assert len(missing) == 2
    assert all(
        r["state"] == "missing"
        and r["value_json"] == "null"
        and r["recorded_at"] is None
        and r["received_at"] is None
        and r["client_event_id"] is None
        and r["is_current"] is None
        for r in missing
    )
    assert {r["step_id"] for r in missing} == {n["id"] for n in flow["nodes"][:-1]}
    paths = client.get(f"/studies/{study['id']}/path-events", headers=h).json()
    assert len(paths) == 1 and paths[0]["seq"] == 1 and paths[0]["answer_event_ids"] == []
    assert paths[0]["study_version_id"] == version["id"] and paths[0]["assessor_code"] == "A"
    pages = [
        client.get(
            f"/studies/{study['id']}/data", headers=h, params={"limit": 1, "offset": i}
        ).json()[0]
        for i in range(len(rows))
    ]
    assert pages == rows
    answer = dict(
        client_event_id=str(uuid4()),
        step_id=flow["nodes"][0]["id"],
        occurrence_id="study",
        value={"state": "answered", "value": 0},
        recorded_at=NOW,
    )
    assert (
        client.post(url + "/form-events", headers=token, json={"events": [answer]}).status_code
        == 200
    )
    rows = data(client, h, study)
    assert any(
        r["row_kind"] == "form_answer" and json.loads(r["value_json"]) == answer["value"]
        for r in rows
    )
    assert len([r for r in rows if r["row_kind"] == "expected_missing"]) == 1


def test_rata_history_zero_unrated_skipped_unselected_unicode_and_version_scope(
    client, researcher_headers
):
    h = researcher_headers
    study, test, version, samples = make_study(
        client, h, "rata", rating_min=0, require_ratings=False, allow_skips=True
    )
    session, token = legacy_provision(client, h, version)
    values = [
        {"kind": "rata", "state": "selected", "rating": 0},
        {"kind": "rata", "state": "selected", "rating": None},
        {"kind": "rata", "state": "unselected", "rating": None},
        {"kind": "rata", "state": "skipped", "rating": None},
    ]
    prior = None
    ids = []
    for value in values:
        answer = event(test, sample_id=samples[0]["id"], question_id="sweet", value=value)
        if prior:
            answer["supersedes_event_id"] = prior
        result = submit(client, session, token, [answer])
        assert result.status_code == 200, result.text
        assert submit(client, session, token, [answer]).json()["events"][0]["status"] == "duplicate"
        prior = answer["client_event_id"]
        ids.append(prior)
    rows = data(client, h, study, version)
    history = [r for r in rows if r["row_kind"] == "answer"]
    assert [json.loads(r["value_json"]) for r in history] == values
    assert [r["is_current"] for r in history] == [False, False, False, True]
    assert [r["supersedes_event_id"] for r in history] == [None, *ids[:-1]]
    assert len([r for r in rows if r["row_kind"] == "expected_missing"]) == 1
    draft = client.post(f"/studies/{study['id']}/drafts", headers=h).json()
    # Clone has new test/sample IDs and no sessions; publication is untouched.
    assert data(client, h, study, draft) == []
    assert (
        client.get(
            f"/studies/{study['id']}/responses", headers=h, params={"study_version_id": draft["id"]}
        ).json()
        == []
    )
    assert (
        len(
            client.get(
                f"/studies/{study['id']}/responses",
                headers=h,
                params={"study_version_id": version["id"]},
            ).json()
        )
        == 4
    )
    assert data(client, h, study) == rows
    exported = client.get(
        f"/studies/{study['id']}/export", headers=h, params={"study_version_id": version["id"]}
    )
    records = list(csv.DictReader(io.StringIO(exported.text)))
    assert [json.loads(r["value_json"]) for r in records if r["row_kind"] == "answer"] == values
    assert {r["study_version_id"] for r in records} == {version["id"]}
    assert json.loads(records[-1]["sample_id_json"]) == samples[1]["id"]


def test_unicode_quotes_newlines_and_json_are_lossless(client, researcher_headers):
    from test_flow_foundation import configured
    from test_flow_guards import node, save

    h = researcher_headers
    study, version, _, flow, base = configured(client, h)
    question = node(
        "question",
        {"prompt": {"en": "Text"}, "answer_type": "text", "required": True, "allow_skip": False},
    )
    flow["nodes"].insert(0, question)
    review = save(client, h, base, flow)
    assert (
        client.post(
            f"/studies/{study['id']}/publish",
            headers=h,
            json={"study_version_id": version["id"], "revision_hash": review["revision_hash"]},
        ).status_code
        == 200
    )
    session = client.post(
        "/sessions",
        headers=h,
        json={"study_version_id": version["id"], "assessor_code": 'Å, "quoted"\nline'},
    ).json()
    token = {"Authorization": "Bearer " + session["session_token"]}
    url = f"/sessions/{session['id']}"
    assert (
        client.post(
            url + "/path-events",
            headers=token,
            json={"events": [path(question["id"], 1, "entered")]},
        ).status_code
        == 200
    )
    value = {"state": "answered", "value": 'Smör, "香り"\nnext line'}
    answer = dict(
        client_event_id=str(uuid4()),
        step_id=question["id"],
        occurrence_id="study",
        value=value,
        recorded_at=NOW,
    )
    assert (
        client.post(url + "/form-events", headers=token, json={"events": [answer]}).status_code
        == 200
    )
    rows = list(
        csv.DictReader(io.StringIO(client.get(f"/studies/{study['id']}/export", headers=h).text))
    )
    row = next(r for r in rows if r["row_kind"] == "form_answer")
    assert json.loads(row["value_json"]) == value
    assert row["assessor_code"] == session["assessor_code"]
    assert row["sample_id_json"] == "null"
    assert (
        row["recorded_at"]
        and row["received_at"]
        and row["client_event_id"] == answer["client_event_id"]
    )


def test_v2_matrix_optional_rows_keep_missing_and_zero_option_context(client, researcher_headers):
    from test_flow_foundation import configured
    from test_flow_guards import node, save

    h = researcher_headers
    study, version, _, flow, base = configured(client, h)
    matrix = node(
        "matrix_question",
        {
            "instructions": {"en": "Matrix"},
            "rows": [
                {"id": "a", "prompt": {"en": "A"}, "required": False},
                {"id": "b", "prompt": {"en": "B"}, "required": False},
            ],
            "options": [
                {"id": "zero", "label": {"en": "Zero"}, "score": 0},
                {"id": "one", "label": {"en": "One"}, "score": 1},
            ],
            "allow_skip": True,
        },
    )
    flow["nodes"].insert(0, matrix)
    review = save(client, h, base, flow)
    assert (
        client.post(
            f"/studies/{study['id']}/publish",
            headers=h,
            json={"study_version_id": version["id"], "revision_hash": review["revision_hash"]},
        ).status_code
        == 200
    )
    session = client.post(
        "/sessions", headers=h, json={"study_version_id": version["id"], "assessor_code": "MATRIX"}
    ).json()
    token = {"Authorization": "Bearer " + session["session_token"]}
    url = f"/sessions/{session['id']}"
    assert (
        client.post(
            url + "/path-events", headers=token, json={"events": [path(matrix["id"], 1, "entered")]}
        ).status_code
        == 200
    )
    event_id = str(uuid4())
    answer = dict(
        client_event_id=event_id,
        step_id=matrix["id"],
        occurrence_id="study",
        value={"state": "matrix", "answers": {"a": {"state": "selected", "option_id": "zero"}}},
        recorded_at=NOW,
    )
    assert (
        client.post(url + "/form-events", headers=token, json={"events": [answer]}).status_code
        == 200
    )
    rows = [r for r in data(client, h, study) if r["row_kind"] == "form_answer"]
    assert [r["question_id"] for r in rows] == ["a", "b"]
    assert [r["state"] for r in rows] == ["selected", "missing"]
    assert all(r["client_event_id"] == event_id for r in rows)
    assert json.loads(rows[1]["value_json"]) == {"state": "missing"}
