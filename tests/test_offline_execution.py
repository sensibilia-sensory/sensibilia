"""Real migrated SQLite collection contract; no operational database."""

from copy import deepcopy
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from test_flow_foundation import configured

from sensibilia.api import create_app
from sensibilia.models import FormEvent, PathEvent

NOW = "2026-10-11T12:00:00+00:00"


def provision(client, h, ordinary=False):
    study, version, method, flow, base = configured(client, h)
    if ordinary:
        flow["nodes"].insert(
            0,
            {
                "id": str(uuid4()),
                "kind": "question",
                "title": {"en": "Zero"},
                "data": {
                    "prompt": {"en": "Number"},
                    "answer_type": "integer",
                    "min": 0,
                    "max": 5,
                    "required": True,
                    "allow_skip": False,
                },
            },
        )
        version = client.put(
            base + "/form",
            headers=h,
            json={"form": flow, "revision_hash": version["revision_hash"]},
        ).json()
    review = client.get(base + "/validation", headers=h).json()
    result = client.post(
        f"/studies/{study['id']}/publish",
        headers=h,
        json={
            "study_version_id": version["id"],
            "revision_hash": review["revision_hash"],
            "acknowledged_warning_codes": [
                i["code"] for i in review["issues"] if i["severity"] == "warning"
            ],
        },
    )
    assert result.status_code == 200, result.text
    session = client.post(
        "/sessions",
        headers=h,
        json={
            "study_version_id": version["id"],
            "assessor_code": "A",
            "context": {"language": "en", "booth_number": 0},
        },
    ).json()
    return (
        study,
        version,
        method,
        flow,
        base,
        session,
        {"Authorization": "Bearer " + session["session_token"]},
    )


def path(step, seq, kind, ids=None, **extra):
    return dict(
        client_event_id=str(uuid4()),
        seq=seq,
        step_id=step,
        occurrence_id="study",
        kind=kind,
        answer_event_ids=ids or [],
        recorded_at=NOW,
        **extra,
    )


def test_session_list_scope_auth_and_token_once(client, researcher_headers):
    study, version, _, _, base, session, token = provision(client, researcher_headers)
    assert client.get(base + "/sessions").status_code == 401
    assert client.get(base + "/sessions", headers=token).status_code == 401
    rows = client.get(base + "/sessions", headers=researcher_headers).json()
    assert rows == [{k: v for k, v in session.items() if k != "session_token"}]
    assert "token" not in str(rows)
    assert client.get(base + "/sessions?status=completed", headers=researcher_headers).json() == []
    assert client.get(base + "/sessions?limit=0", headers=researcher_headers).status_code == 422
    other = client.post("/studies", headers=researcher_headers, json={"title": "Other"}).json()
    assert (
        client.get(
            f"/studies/{other['id']}/versions/{version['id']}/sessions", headers=researcher_headers
        ).status_code
        == 404
    )
    assert client.get(f"/sessions/{uuid4()}/test", headers=token).status_code == 401


@pytest.mark.parametrize("restart_cycles", [1, 2, 3])
def test_causal_collect_retry_complete_zero_export_and_immutability(
    client, researcher_headers, restart_cycles
):
    study, version, method, flow, base, session, token = provision(client, researcher_headers, True)
    terminal = None
    if restart_cycles == 3:
        terminal = client.post(
            "/terminals",
            headers=researcher_headers,
            json={"name": "Restart terminal", "staff_name": "Technician", "reason": "Rehearsal"},
        ).json()
        assert (
            client.post(
                f"/terminals/{terminal['id']}/assignments",
                headers=researcher_headers,
                json={
                    "expected_revision": 0,
                    "session_id": session["id"],
                    "staff_name": "Technician",
                    "reason": "Prepared assessment",
                },
            ).status_code
            == 200
        )
        token = {"Authorization": "Bearer " + terminal["terminal_token"]}
    url = f"/sessions/{session['id']}"
    question, embedded, end = [n["id"] for n in flow["nodes"]]
    initial = path(question, 1, "entered")
    answer = dict(
        client_event_id=str(uuid4()),
        step_id=question,
        occurrence_id="study",
        value={"state": "answered", "value": 0},
        recorded_at=NOW,
    )
    assert (
        client.post(url + "/form-events", headers=token, json={"events": [answer]}).status_code
        == 409
    )
    assert (
        client.post(url + "/path-events", headers=token, json={"events": [initial]}).status_code
        == 200
    )
    assert (
        client.post(url + "/form-events", headers=token, json={"events": [answer]}).status_code
        == 200
    )
    assert (
        client.post(url + "/form-events", headers=token, json={"events": [answer]}).json()[
            "events"
        ][0]["status"]
        == "duplicate"
    )
    assert client.post(url + "/complete", headers=token).status_code == 422
    prefix = [
        path(question, 2, "submitted", [answer["client_event_id"]]),
        path(embedded, 3, "entered"),
    ]
    assert (
        client.post(url + "/path-events", headers=token, json={"events": prefix}).status_code == 200
    )
    rating = dict(
        client_event_id=str(uuid4()),
        study_test_id=method["id"],
        step_id=embedded,
        occurrence_id="study",
        question_id="liking",
        value={"state": "rated", "rating": 9},
        recorded_at=NOW,
    )
    assert (
        client.post(url + "/responses", headers=token, json={"events": [rating]}).status_code == 200
    )
    final = [
        path(embedded, 4, "submitted", [rating["client_event_id"]]),
        path(end, 5, "entered"),
        path(end, 6, "ended"),
    ]
    assert (
        client.post(url + "/path-events", headers=token, json={"events": final}).status_code == 200
    )
    assert client.get(url + "/progress", headers=token).json()["outcome"] == "completed"
    session_completed = client.post(url + "/complete", headers=token).json()
    assert session_completed["status"] == "completed"
    assert (
        client.post(
            url + "/path-events", headers=token, json={"events": [initial, *prefix, *final]}
        ).json()["next_seq"]
        == 7
    )
    assert (
        client.post(url + "/responses", headers=token, json={"events": [rating]}).json()["events"][
            0
        ]["status"]
        == "duplicate"
    )
    exported = client.get(f"/studies/{study['id']}/export", headers=researcher_headers)
    assert exported.status_code == 200, exported.text
    assert '""value"":0' in exported.text and '""rating"":9' in exported.text
    with Session(client.app.state.engine) as db:
        assert len(list(db.scalars(select(PathEvent)))) == 6
        assert db.scalar(select(FormEvent)).value == {"state": "answered", "value": 0}
    with client.app.state.engine.begin() as db:
        with pytest.raises(IntegrityError):
            db.execute(text("UPDATE path_events SET reason='jumped'"))

    # A lost acknowledgement must remain retryable after process/engine replacement.
    # Reuse the completed causal flow and its original UUIDs, including ordinary zero.
    reads = [
        (url + "/test", token),
        (url + "/progress", token),
        *[
            (f"/studies/{study['id']}/{endpoint}", researcher_headers)
            for endpoint in ("responses", "form-responses", "path-events", "data", "export")
        ],
    ]
    before_restart = [client.get(endpoint, headers=h).content for endpoint, h in reads]
    for _ in range(restart_cycles):
        with TestClient(create_app(client.app.state.settings)) as restarted:
            for endpoint, events in (
                ("path-events", [initial, *prefix, *final]),
                ("form-events", [answer]),
                ("responses", [rating]),
            ):
                retry = restarted.post(url + "/" + endpoint, headers=token, json={"events": events})
                assert retry.status_code == 200, retry.text
                assert all(e["status"] == "duplicate" for e in retry.json()["events"])
            assert restarted.post(url + "/complete", headers=token).json() == session_completed
            assert [
                restarted.get(endpoint, headers=h).content for endpoint, h in reads
            ] == before_restart

    if terminal:
        next_session = client.post(
            "/sessions",
            headers=researcher_headers,
            json={"study_version_id": version["id"], "assessor_code": "NEXT"},
        ).json()
        handover_export = client.get(
            f"/studies/{study['id']}/export", headers=researcher_headers
        ).content
        assignment = client.post(
            f"/terminals/{terminal['id']}/assignments",
            headers=researcher_headers,
            json={
                "expected_revision": 1,
                "session_id": next_session["id"],
                "staff_name": "Technician",
                "reason": "Synchronized handover",
            },
        )
        assert assignment.status_code == 200, assignment.text
        assert client.get(url + "/test", headers=token).status_code == 401
        retry = client.post(url + "/responses", headers=token, json={"events": [rating]})
        assert retry.json()["events"][0]["status"] == "duplicate"
        changed = dict(rating, client_event_id=str(uuid4()))
        assert (
            client.post(url + "/responses", headers=token, json={"events": [changed]}).status_code
            == 409
        )
        assert (
            client.get(f"/studies/{study['id']}/export", headers=researcher_headers).content
            == handover_export
        )
        assert (
            client.get(f"/terminals/{terminal['id']}/assignment", headers=token).json()[
                "session_id"
            ]
            == next_session["id"]
        )


@pytest.mark.parametrize(
    "mutation", ["reason", "sequence", "step", "sample", "occurrence", "ids", "target"]
)
def test_bad_path_batch_rolls_back(client, researcher_headers, mutation):
    _, _, _, flow, _, session, token = provision(client, researcher_headers)
    step = flow["nodes"][0]["id"]
    first = path(step, 1, "entered")
    invalid = deepcopy(first)
    invalid["client_event_id"] = str(uuid4())
    invalid["seq"] = 2
    updates = {
        "reason": {"reason": "restriction"},
        "sequence": {"seq": 3},
        "step": {"step_id": str(uuid4())},
        "sample": {"sample_id": str(uuid4())},
        "occurrence": {"occurrence_id": "foreign"},
        "ids": {"answer_event_ids": [str(uuid4())]},
        "target": {"target_id": str(uuid4())},
    }
    invalid.update(updates[mutation])
    url = f"/sessions/{session['id']}"
    assert (
        client.post(
            url + "/path-events", headers=token, json={"events": [first, invalid]}
        ).status_code
        == 422
    )
    assert client.get(url + "/progress", headers=token).json()["next_seq"] == 1


@pytest.mark.parametrize(
    "value",
    [
        {"state": "answered", "value": False},
        {"state": "answered", "value": -1},
        {"state": "skipped"},
        {"state": "missing"},
        {"state": "answered", "value": "0"},
    ],
)
def test_v2_ordinary_validation(client, researcher_headers, value):
    _, _, _, flow, _, session, token = provision(client, researcher_headers, True)
    url = f"/sessions/{session['id']}"
    step = flow["nodes"][0]["id"]
    assert (
        client.post(
            url + "/path-events", headers=token, json={"events": [path(step, 1, "entered")]}
        ).status_code
        == 200
    )
    event = dict(
        client_event_id=str(uuid4()),
        step_id=step,
        occurrence_id="study",
        value=value,
        recorded_at=NOW,
    )
    assert (
        client.post(url + "/form-events", headers=token, json={"events": [event]}).status_code
        == 422
    )


def test_event_uuid_collision_and_wrong_version(client, researcher_headers):
    _, _, method, flow, _, session, token = provision(client, researcher_headers)
    _, _, other, _, _, _, _ = provision(client, researcher_headers)
    step, url = flow["nodes"][0]["id"], f"/sessions/{session['id']}"
    initial = path(step, 1, "entered")
    assert (
        client.post(url + "/path-events", headers=token, json={"events": [initial]}).status_code
        == 200
    )
    event = dict(
        client_event_id=str(uuid4()),
        study_test_id=other["id"],
        step_id=step,
        occurrence_id="study",
        question_id="liking",
        value={"state": "rated", "rating": 1},
        recorded_at=NOW,
    )
    assert (
        client.post(url + "/responses", headers=token, json={"events": [event]}).status_code == 422
    )
    event.update(study_test_id=method["id"], client_event_id=initial["client_event_id"])
    assert (
        client.post(url + "/responses", headers=token, json={"events": [event]}).status_code == 409
    )


def test_loop_occurrences_restriction_reason_and_frozen_code(client, researcher_headers):
    import hashlib

    from test_flow_guards import save
    from test_sample_loop import loop_study

    h = researcher_headers
    study, version, flow, base, samples = loop_study(client, h)
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
        "/sessions", headers=h, json={"study_version_id": version["id"], "assessor_code": "LOOP"}
    ).json()
    token = {"Authorization": "Bearer " + session["session_token"]}
    url = f"/sessions/{session['id']}"
    restriction, loop, end = flow["nodes"]
    code, method = loop["data"]["children"]
    seq = 0

    def emit(items):
        nonlocal seq
        events = []
        for node_id, kind, occurrence, sample, reason, ids in items:
            seq += 1
            events.append(path(node_id, seq, kind, ids, sample_id=sample, reason=reason))
            events[-1]["occurrence_id"] = occurrence
        result = client.post(url + "/path-events", headers=token, json={"events": events})
        assert result.status_code == 200, result.text

    emit([(restriction["id"], "entered", "study", None, None, [])])
    answer_id = str(uuid4())
    assert (
        client.post(
            url + "/form-events",
            headers=token,
            json={
                "events": [
                    dict(
                        client_event_id=answer_id,
                        step_id=restriction["id"],
                        occurrence_id="study",
                        value={"state": "answered", "value": ["nuts"]},
                        recorded_at=NOW,
                    )
                ]
            },
        ).status_code
        == 200
    )
    first_occurrence = loop["id"] + ":" + samples[0]["id"]
    emit(
        [
            (restriction["id"], "submitted", "study", None, None, [answer_id]),
            (loop["id"], "entered", "study", None, None, []),
            (code["id"], "entered", first_occurrence, samples[0]["id"], None, []),
        ]
    )
    for i, sample in enumerate(samples):
        occurrence = loop["id"] + ":" + sample["id"]
        answer_id = str(uuid4())
        answer = dict(
            client_event_id=answer_id,
            step_id=code["id"],
            occurrence_id=occurrence,
            sample_id=sample["id"],
            value={
                "state": "code",
                "normalized_code": sample["code"],
                "code_hash": hashlib.sha256(sample["code"].encode()).hexdigest(),
            },
            recorded_at=NOW,
        )
        wrong = deepcopy(answer)
        wrong["sample_id"] = str(uuid4())
        assert (
            client.post(url + "/form-events", headers=token, json={"events": [wrong]}).status_code
            == 409
        )
        assert (
            client.post(url + "/form-events", headers=token, json={"events": [answer]}).status_code
            == 200
        )
        emit([(code["id"], "submitted", occurrence, sample["id"], None, [answer_id])])
        if i == 1:
            pending = [(method["id"], "skipped", occurrence, sample["id"], "restriction", [])]
        else:
            emit([(method["id"], "entered", occurrence, sample["id"], None, [])])
            rating_id = str(uuid4())
            rating = dict(
                client_event_id=rating_id,
                study_test_id=method["data"]["study_test_id"],
                step_id=method["id"],
                occurrence_id=occurrence,
                sample_id=sample["id"],
                question_id="liking",
                value={"state": "rated", "rating": 9},
                recorded_at=NOW,
            )
            assert (
                client.post(
                    url + "/responses", headers=token, json={"events": [rating]}
                ).status_code
                == 200
            )
            pending = [(method["id"], "submitted", occurrence, sample["id"], None, [rating_id])]
        if i < 3:
            next_sample = samples[i + 1]
            pending.append(
                (
                    code["id"],
                    "entered",
                    loop["id"] + ":" + next_sample["id"],
                    next_sample["id"],
                    None,
                    [],
                )
            )
        else:
            pending.extend(
                [
                    (end["id"], "entered", "study", None, None, []),
                    (end["id"], "ended", "study", None, None, []),
                ]
            )
        emit(pending)
    assert client.post(url + "/complete", headers=token).json()["status"] == "completed"
    assert len(client.get(f"/studies/{study['id']}/responses", headers=h).json()) == 3
    assert len(client.get(f"/studies/{study['id']}/form-responses", headers=h).json()) == 5
    ledger = client.get(f"/studies/{study['id']}/data", headers=h, params={"limit": 1000}).json()
    assert any(r["row_kind"] == "path" and r["skip_reason"] == "restriction" for r in ledger)
    omitted = [r for r in ledger if r["row_kind"] == "expected_missing" and r["study_test_id"]]
    assert len(omitted) == 1 and omitted[0]["skip_reason"] == "restriction"
    assert omitted[0]["client_event_id"] is None and omitted[0]["sample_id_json"] != "null"


def test_screen_out_requires_causal_skipped_path(client, researcher_headers):
    from test_flow_guards import node, save

    h = researcher_headers
    study, version, method, flow, base = configured(client, h)
    consent = node(
        "consent",
        {"body": {"en": "Consent"}, "accept_label": {"en": "Yes"}, "decline_label": {"en": "No"}},
    )
    end = node("end", {"body": {"en": "Ended"}, "outcome": "screened_out"})
    flow["nodes"][0]["guard"] = {
        "variable": "answer." + consent["id"],
        "operator": "eq",
        "value": True,
    }
    flow["nodes"][0]["otherwise"] = {"action": "end_study", "target_id": end["id"]}
    flow["nodes"] = [consent, *flow["nodes"], end]
    review = save(client, h, base, flow)
    assert review["valid"], review
    assert (
        client.post(
            f"/studies/{study['id']}/publish",
            headers=h,
            json={
                "study_version_id": version["id"],
                "revision_hash": review["revision_hash"],
                "acknowledged_warning_codes": [
                    i["code"] for i in review["issues"] if i["severity"] == "warning"
                ],
            },
        ).status_code
        == 200
    )
    session = client.post(
        "/sessions",
        headers=h,
        json={"study_version_id": version["id"], "assessor_code": "DECLINED"},
    ).json()
    token, url = (
        {"Authorization": "Bearer " + session["session_token"]},
        f"/sessions/{session['id']}",
    )
    assert (
        client.post(
            url + "/path-events",
            headers=token,
            json={"events": [path(consent["id"], 1, "entered")]},
        ).status_code
        == 200
    )
    answer_id = str(uuid4())
    answer = dict(
        client_event_id=answer_id,
        step_id=consent["id"],
        occurrence_id="study",
        value={"state": "answered", "value": False},
        recorded_at=NOW,
    )
    assert (
        client.post(url + "/form-events", headers=token, json={"events": [answer]}).status_code
        == 200
    )
    events = [
        path(consent["id"], 2, "submitted", [answer_id]),
        path(flow["nodes"][1]["id"], 3, "skipped", reason="guard_false", target_id=end["id"]),
        path(flow["nodes"][2]["id"], 4, "skipped", reason="jumped"),
        path(end["id"], 5, "entered"),
        path(end["id"], 6, "ended"),
    ]
    assert (
        client.post(url + "/path-events", headers=token, json={"events": events}).status_code == 200
    )
    assert client.post(url + "/complete", headers=token).json()["status"] == "screened_out"
    assert client.get(f"/studies/{study['id']}/responses", headers=h).json() == []


def test_v2_missing_skipped_unselected_and_zero_are_lossless(client, researcher_headers):
    from test_flow_guards import node, save

    h = researcher_headers
    study, version, _, flow, base = configured(client, h)
    optional = [
        node(
            "question",
            {
                "prompt": {"en": "Optional choices"},
                "answer_type": "multiple",
                "options": [{"id": "a", "label": {"en": "A"}}, {"id": "b", "label": {"en": "B"}}],
                "required": False,
                "allow_skip": True,
            },
        )
        for _ in range(3)
    ]
    zero = node(
        "question",
        {
            "prompt": {"en": "Zero"},
            "answer_type": "integer",
            "min": 0,
            "required": True,
            "allow_skip": False,
        },
    )
    flow["nodes"] = [*optional, zero, *flow["nodes"]]
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
        "/sessions", headers=h, json={"study_version_id": version["id"], "assessor_code": "STATES"}
    ).json()
    token, url = (
        {"Authorization": "Bearer " + session["session_token"]},
        f"/sessions/{session['id']}",
    )
    assert (
        client.post(
            url + "/path-events",
            headers=token,
            json={"events": [path(optional[0]["id"], 1, "entered")]},
        ).status_code
        == 200
    )
    values = [
        {"state": "missing"},
        {"state": "skipped"},
        {"state": "answered", "value": []},
        {"state": "answered", "value": 0},
    ]
    for i, value in enumerate(values):
        answer_id = str(uuid4())
        event = dict(
            client_event_id=answer_id,
            step_id=flow["nodes"][i]["id"],
            occurrence_id="study",
            value=value,
            recorded_at=NOW,
        )
        assert (
            client.post(url + "/form-events", headers=token, json={"events": [event]}).status_code
            == 200
        )
        events = [
            path(flow["nodes"][i]["id"], 2 + i * 2, "submitted", [answer_id]),
            path(flow["nodes"][i + 1]["id"], 3 + i * 2, "entered"),
        ]
        assert (
            client.post(url + "/path-events", headers=token, json={"events": events}).status_code
            == 200
        )
    rows = client.get(f"/studies/{study['id']}/form-responses", headers=h).json()
    assert [r["value"] for r in rows] == values
    import csv
    import io
    import json

    records = list(
        csv.DictReader(io.StringIO(client.get(f"/studies/{study['id']}/export", headers=h).text))
    )
    # Exports also carry path/expected-slot rows; keep this assertion on collected form answers.
    records = [r for r in records if r["row_kind"] == "form_answer"]
    assert [json.loads(r["value_json"]) for r in records] == values
    assert all(r["occurrence_id"] == "study" for r in records)


def test_production_assessor_routes_and_worker_are_scoped(client):
    from pathlib import Path

    if not (Path(__file__).resolve().parents[1] / "frontend" / "dist").is_dir():
        pytest.skip("Build frontend before deployment checks")
    assert client.get(f"/assessor/sessions/{uuid4()}").status_code == 200
    assert client.get("/assessor/unknown").status_code == 404
    assert client.get("/assessor/sw.js").status_code == 200
    assert client.get("/assessor/manifest.webmanifest").status_code == 200


def test_duplicate_path_uuid_within_atomic_batch(client, researcher_headers):
    _, _, _, flow, _, session, token = provision(client, researcher_headers)
    event = path(flow["nodes"][0]["id"], 1, "entered")
    result = client.post(
        f"/sessions/{session['id']}/path-events", headers=token, json={"events": [event, event]}
    )
    assert result.status_code == 200, result.text
    assert [e["status"] for e in result.json()["events"]] == ["accepted", "duplicate"]
    assert result.json()["next_seq"] == 2


def test_guarded_previous_review_keeps_zero_locked_and_progress_cursor(client, researcher_headers):
    from test_flow_guards import node, save

    h = researcher_headers
    study, version, _, flow, base = configured(client, h)
    question = node(
        "question",
        {
            "prompt": {"en": "Zero"},
            "answer_type": "integer",
            "min": 0,
            "required": True,
            "allow_skip": False,
        },
    )
    detour = node("confirm", {"body": {"en": "Review"}, "ack_label": {"en": "Reviewed"}})
    detour["guard"] = {"variable": "context.language", "operator": "eq", "value": "xx"}
    detour["otherwise"] = {"action": "previous_question"}
    flow["nodes"] = [question, detour, *flow["nodes"]]
    review = save(client, h, base, flow)
    assert review["valid"], review
    assert (
        client.post(
            f"/studies/{study['id']}/publish",
            headers=h,
            json={
                "study_version_id": version["id"],
                "revision_hash": review["revision_hash"],
                "acknowledged_warning_codes": [
                    i["code"] for i in review["issues"] if i["severity"] == "warning"
                ],
            },
        ).status_code
        == 200
    )
    session = client.post(
        "/sessions", headers=h, json={"study_version_id": version["id"], "assessor_code": "REVIEW"}
    ).json()
    token, url = (
        {"Authorization": "Bearer " + session["session_token"]},
        f"/sessions/{session['id']}",
    )
    assert (
        client.post(
            url + "/path-events",
            headers=token,
            json={"events": [path(question["id"], 1, "entered")]},
        ).status_code
        == 200
    )
    event = dict(
        client_event_id=str(uuid4()),
        step_id=question["id"],
        occurrence_id="study",
        value={"state": "answered", "value": 0},
        recorded_at=NOW,
    )
    assert (
        client.post(url + "/form-events", headers=token, json={"events": [event]}).status_code
        == 200
    )
    events = [
        path(question["id"], 2, "submitted", [event["client_event_id"]]),
        path(detour["id"], 3, "skipped", reason="guard_false"),
    ]
    assert (
        client.post(url + "/path-events", headers=token, json={"events": events}).status_code == 200
    )
    assert client.get(url + "/progress", headers=token).json()["current_step_id"] == question["id"]
    correction = {
        **event,
        "client_event_id": str(uuid4()),
        "value": {"state": "answered", "value": 1},
    }
    assert (
        client.post(url + "/form-events", headers=token, json={"events": [correction]}).status_code
        == 409
    )
    events = [path(question["id"], 4, "reviewed"), path(flow["nodes"][2]["id"], 5, "entered")]
    assert (
        client.post(url + "/path-events", headers=token, json={"events": events}).status_code == 200
    )
    assert (
        client.get(f"/studies/{study['id']}/form-responses", headers=h).json()[0]["value"]["value"]
        == 0
    )
