from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from test_flow_foundation import configured
from test_offline_execution import NOW, path

from sensibilia.api import create_app
from sensibilia.config import Settings

OPERATOR = "operator-test-" + "o" * 40


def setup(client, h, require_staff=False):
    client.app.state.settings.operator_token = Settings(
        researcher_token="r" * 40, operator_token=OPERATOR
    ).operator_token
    study, version, method, flow, base = configured(client, h)
    sample = client.post(
        f"/studies/{study['id']}/samples",
        headers=h,
        json={"code": "731", "label": "Private batch", "ingredient_tags": []},
    ).json()
    gate = dict(
        id=str(uuid4()),
        kind="serve_gate",
        title={"en": "Delivery"},
        data={
            "body": {"en": "Confirm delivery"},
            "preparation": {"en": "One portion"},
            "sample_binding": "set",
            "sample_ids": [sample["id"]],
            "timeout_seconds": 120,
            "require_staff_delivery": require_staff,
        },
    )
    flow["nodes"].insert(0, gate)
    rev = client.get(base, headers=h).json()["revision_hash"]
    saved = client.put(base + "/form", headers=h, json={"form": flow, "revision_hash": rev})
    assert saved.status_code == 200, saved.text
    review = client.get(base + "/validation", headers=h).json()
    assert review["valid"], review
    assert (
        client.post(
            f"/studies/{study['id']}/publish",
            headers=h,
            json={"study_version_id": version["id"], "revision_hash": review["revision_hash"]},
        ).status_code
        == 200
    )
    session = client.post(
        "/sessions", headers=h, json={"study_version_id": version["id"], "assessor_code": "A"}
    ).json()
    token = {"Authorization": "Bearer " + session["session_token"]}
    room_payload = dict(
        name="Laboratory",
        rows=1,
        columns=2,
        booths=[dict(id=str(uuid4()), label=str(i), row=1, column=i, enabled=True) for i in (1, 2)],
    )
    room = client.post("/rooms", headers=h, json=room_payload).json()
    assignment_payload = dict(
        client_event_id=str(uuid4()),
        session_id=session["id"],
        room_version_id=room["id"],
        booth_id=room["booths"][0]["id"],
        staff_name="Staff",
        reason="Pilot",
    )
    assigned = client.post("/booth-assignments", headers=h, json=assignment_payload)
    assert assigned.status_code == 200, assigned.text
    assignment = assigned.json()["assignment"]
    url = f"/sessions/{session['id']}"
    assert (
        client.post(
            url + "/path-events", headers=token, json={"events": [path(gate["id"], 1, "entered")]}
        ).status_code
        == 200
    )
    command = dict(
        client_event_id=str(uuid4()),
        assignment_id=assignment["id"],
        step_id=gate["id"],
        occurrence_id="study",
        expected_revision=0,
        action="ready",
        actor="Tablet",
        recorded_at=NOW,
    )
    return study, version, method, flow, base, session, token, room, assignment, command


def test_role_dtos_uuid_and_two_operator_race(client, researcher_headers):
    _, _, _, _, _, session, token, _, _, command = setup(client, researcher_headers)
    op = {"Authorization": "Bearer " + OPERATOR}
    url = f"/sessions/{session['id']}/operations"
    assert client.post(url, headers=token, json=command).status_code == 200
    original = client.post(url, headers=token, json=command).json()
    assert original["status"] == "duplicate"
    altered = dict(command, actor="Changed")
    assert client.post(url, headers=token, json=altered).status_code == 409
    dashboard = client.get("/operator/dashboard", headers=op).json()
    assert dashboard["tasks"][0]["slots"][0]["label"] == "Private batch"
    assert all(
        x not in str(dashboard)
        for x in ("configuration", "answers", "correct_slot", "restriction_tag", "token_hash")
    )
    for endpoint in ("/rooms", "/studies", "/operations/export"):
        assert client.get(endpoint, headers=op).status_code == 401
    assert client.get("/operator/dashboard", headers=token).status_code == 401
    assert client.get("/operator/dashboard", headers=researcher_headers).status_code == 401
    ack = dict(
        command,
        client_event_id=str(uuid4()),
        action="acknowledged",
        expected_revision=1,
        actor="Operator 1",
    )
    assert client.post(url, headers=token, json=ack).status_code == 403

    def compete(i):
        return client.post(
            "/operator/operations",
            headers=op,
            json=dict(ack, client_event_id=str(uuid4()), actor=f"Operator {i}"),
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(compete, [1, 2]))
    assert sorted(r.status_code for r in results) == [200, 409]
    served = dict(ack, client_event_id=str(uuid4()), action="served", expected_revision=2)
    result = client.post("/operator/operations", headers=op, json=served)
    assert result.status_code == 200, result.text
    assert (
        client.post("/operator/operations", headers=op, json=served).json()["status"] == "duplicate"
    )
    assert (
        client.post(
            "/operator/operations", headers=op, json=dict(served, client_event_id=str(uuid4()))
        ).status_code
        == 409
    )


def test_help_request_reopens_a_served_gate(client, researcher_headers):
    _, _, _, _, _, session, token, _, _, command = setup(client, researcher_headers)
    op = {"Authorization": "Bearer " + OPERATOR}
    url = f"/sessions/{session['id']}/operations"
    assert client.post(url, headers=token, json=command).status_code == 200
    ack = dict(command, client_event_id=str(uuid4()), action="acknowledged", expected_revision=1)
    assert client.post("/operator/operations", headers=op, json=ack).status_code == 200
    served = dict(ack, client_event_id=str(uuid4()), action="served", expected_revision=2)
    assert client.post("/operator/operations", headers=op, json=served).status_code == 200
    help_ = dict(command, client_event_id=str(uuid4()), action="help", expected_revision=0)
    assert client.post("/operator/operations", headers=op, json=help_).status_code == 403
    sent = client.post(url, headers=token, json=help_)
    assert sent.status_code == 200, sent.text
    assert sent.json()["signal"]["state"] == "help"
    assert client.post(url, headers=token, json=help_).json()["status"] == "duplicate"
    task = client.get("/operator/dashboard", headers=op).json()["tasks"][0]
    assert task["signal"]["state"] == "help"
    again = dict(
        ack,
        client_event_id=str(uuid4()),
        action="acknowledged",
        expected_revision=task["signal"]["revision"],
    )
    assert client.post("/operator/operations", headers=op, json=again).status_code == 200


@pytest.mark.parametrize("before", ["ready", "acknowledged", "help"])
def test_assessor_confirmation_closes_the_request_without_staff(client, researcher_headers, before):
    _, _, _, _, _, session, token, _, _, command = setup(client, researcher_headers)
    op = {"Authorization": "Bearer " + OPERATOR}
    url = f"/sessions/{session['id']}/operations"
    assert client.post(url, headers=token, json=command).status_code == 200
    if before == "acknowledged":
        ack = dict(
            command, client_event_id=str(uuid4()), action="acknowledged", expected_revision=1
        )
        assert client.post("/operator/operations", headers=op, json=ack).status_code == 200
    if before == "help":
        help_ = dict(command, client_event_id=str(uuid4()), action="help", expected_revision=0)
        assert client.post(url, headers=token, json=help_).status_code == 200
    received = dict(
        command, client_event_id=str(uuid4()), action="received", codes=["731"], expected_revision=0
    )
    # Only the tablet confirms receipt; staff cannot do it for the assessor.
    assert client.post("/operator/operations", headers=op, json=received).status_code == 403
    sent = client.post(url, headers=token, json=received)
    assert sent.status_code == 200, sent.text
    assert sent.json()["signal"]["state"] == "received"
    assert client.post(url, headers=token, json=received).json()["status"] == "duplicate"
    task = client.get("/operator/dashboard", headers=op).json()["tasks"][0]
    assert task["status"] == "received"
    stage = client.get("/booth-board", headers=researcher_headers).json()
    assert "Needs samples" not in str(stage)
    # A late help request cannot reopen a gate the assessor has confirmed.
    late = dict(command, client_event_id=str(uuid4()), action="help")
    assert client.post(url, headers=token, json=late).status_code == 409
    # Staff acting on the closed request are refused too.
    ack = dict(command, client_event_id=str(uuid4()), action="acknowledged", expected_revision=2)
    assert client.post("/operator/operations", headers=op, json=ack).status_code == 409


def test_assessor_confirmation_still_lands_after_the_assessor_moved_on_offline(
    client, researcher_headers
):
    _, _, _, flow, _, session, token, _, _, command = setup(client, researcher_headers)
    url = f"/sessions/{session['id']}"
    answer = dict(
        client_event_id=str(uuid4()),
        step_id=flow["nodes"][0]["id"],
        occurrence_id="study",
        recorded_at=NOW,
        value={
            "state": "delivery",
            "mode": "served",
            "codes": ["731"],
            "reason": "",
            "elapsed_ms": 5000,
            "offline": True,
        },
    )
    assert (
        client.post(url + "/form-events", headers=token, json={"events": [answer]}).status_code
        == 200
    )
    events = [
        path(flow["nodes"][0]["id"], 2, "submitted", [answer["client_event_id"]]),
        path(flow["nodes"][1]["id"], 3, "entered"),
    ]
    assert (
        client.post(url + "/path-events", headers=token, json={"events": events}).status_code == 200
    )
    received = dict(
        command, client_event_id=str(uuid4()), action="received", codes=["731"], offline=True
    )
    result = client.post(url + "/operations", headers=token, json=received)
    assert result.status_code == 200, result.text
    assert result.json()["signal"]["state"] == "received"


def delivery_event(flow, mode="served", reason="", elapsed_ms=5000):
    return dict(
        client_event_id=str(uuid4()),
        step_id=flow["nodes"][0]["id"],
        occurrence_id="study",
        recorded_at=NOW,
        value={
            "state": "delivery",
            "mode": mode,
            "codes": ["731"],
            "reason": reason,
            "elapsed_ms": elapsed_ms,
            "offline": False,
        },
    )


def test_assessor_may_confirm_without_staff_unless_the_item_requires_it(client, researcher_headers):
    _, _, _, flow, _, session, token, _, _, _ = setup(client, researcher_headers)
    assert flow["nodes"][0]["data"]["require_staff_delivery"] is False
    url = f"/sessions/{session['id']}/form-events"
    sent = client.post(url, headers=token, json={"events": [delivery_event(flow)]})
    assert sent.status_code == 200, sent.text


def test_required_staff_delivery_is_enforced_by_the_server(client, researcher_headers):
    _, _, _, flow, _, session, token, _, _, command = setup(
        client, researcher_headers, require_staff=True
    )
    op = {"Authorization": "Bearer " + OPERATOR}
    form = f"/sessions/{session['id']}/form-events"
    ops = f"/sessions/{session['id']}/operations"
    answer = delivery_event(flow)
    refused = client.post(form, headers=token, json={"events": [answer]})
    assert refused.status_code == 422
    assert "Staff must mark" in refused.text
    # Asking for the request and confirming receipt alone does not satisfy it either.
    assert client.post(ops, headers=token, json=command).status_code == 200
    received = dict(command, client_event_id=str(uuid4()), action="received", codes=["731"])
    assert client.post(ops, headers=token, json=received).status_code == 200
    assert client.post(form, headers=token, json={"events": [answer]}).status_code == 422
    # A fresh gate: staff acknowledge and serve, then the same answer is accepted.
    _, _, _, flow2, _, session2, token2, _, _, command2 = setup(
        client, researcher_headers, require_staff=True
    )
    ops2 = f"/sessions/{session2['id']}/operations"
    assert client.post(ops2, headers=token2, json=command2).status_code == 200
    ack = dict(command2, client_event_id=str(uuid4()), action="acknowledged", expected_revision=1)
    assert client.post("/operator/operations", headers=op, json=ack).status_code == 200
    served = dict(ack, client_event_id=str(uuid4()), action="served", expected_revision=2)
    assert client.post("/operator/operations", headers=op, json=served).status_code == 200
    accepted = client.post(
        f"/sessions/{session2['id']}/form-events",
        headers=token2,
        json={"events": [delivery_event(flow2)]},
    )
    assert accepted.status_code == 200, accepted.text
    # The staff-verified fallback after the timeout stays available.
    _, _, _, flow3, _, session3, token3, _, _, _ = setup(
        client, researcher_headers, require_staff=True
    )
    manual = delivery_event(flow3, "manual", "Staff verified delivery", 120000)
    fallback = client.post(
        f"/sessions/{session3['id']}/form-events", headers=token3, json={"events": [manual]}
    )
    assert fallback.status_code == 200, fallback.text


def test_room_revision_assignment_conflict_transfer_and_restart(client, researcher_headers):
    _, _, _, _, _, session, token, room, assignment, command = setup(client, researcher_headers)
    url = f"/sessions/{session['id']}/operations"
    assert client.post(url, headers=token, json=command).status_code == 200
    assert client.post(f"/sessions/{session['id']}/presence", headers=token).status_code == 200
    op = {"Authorization": "Bearer " + OPERATOR}
    before = client.get("/operator/dashboard", headers=op).json()
    assert before["tasks"][0]["presence"] == "online"
    with TestClient(create_app(client.app.state.settings)) as restart:
        dashboard = restart.get("/operator/dashboard", headers=op).json()
        assert dashboard["tasks"][0]["presence"] == "unknown"
        assert dashboard["cursor"] == before["cursor"]
        assert restart.post(url, headers=token, json=command).json()["status"] == "duplicate"
    payload = {k: room[k] for k in ("room_id", "name", "rows", "columns", "booths")}
    payload["expected_revision"] = 0
    assert client.post("/rooms", headers=researcher_headers, json=payload).status_code == 409
    payload["expected_revision"] = 1
    newer = client.post("/rooms", headers=researcher_headers, json=payload).json()
    transfer = dict(
        client_event_id=str(uuid4()),
        session_id=session["id"],
        room_version_id=newer["id"],
        booth_id=room["booths"][1]["id"],
        previous_assignment_id=assignment["id"],
        staff_name="Staff",
        reason="Move",
    )
    assert (
        client.post("/booth-assignments", headers=researcher_headers, json=transfer).status_code
        == 200
    )
    assert (
        client.post("/booth-assignments", headers=researcher_headers, json=transfer).json()[
            "status"
        ]
        == "duplicate"
    )
    assert (
        client.post(
            url, headers=token, json=dict(command, client_event_id=str(uuid4()))
        ).status_code
        == 409
    )
    assert client.get(url, headers=token).json()["signals"][0]["state"] == "cancel"
    with client.app.state.engine.begin() as db:
        with pytest.raises(IntegrityError):
            db.execute(text("UPDATE room_versions SET name='changed'"))
        with pytest.raises(IntegrityError):
            db.execute(text("DELETE FROM operational_events"))


@pytest.mark.parametrize("mutation", ["code", "timeout", "reason", "occurrence", "role"])
def test_manual_policy_invalid_and_fallback_does_not_need_operator(
    client, researcher_headers, mutation
):
    study, _, _, flow, _, session, token, _, _, command = setup(client, researcher_headers)
    url = f"/sessions/{session['id']}"
    manual = dict(
        command,
        action="manual",
        codes=["731"],
        elapsed_ms=120000,
        offline=True,
        reason="Staff verified physical delivery",
    )
    bad = deepcopy(manual)
    if mutation == "code":
        bad["codes"] = ["999"]
    if mutation == "timeout":
        bad["elapsed_ms"] = 119999
    if mutation == "reason":
        bad["reason"] = ""
    if mutation == "occurrence":
        bad["occurrence_id"] = "wrong"
    if mutation == "role":
        bad["action"] = "served"
    assert client.post(url + "/operations", headers=token, json=bad).status_code in {403, 409, 422}
    result = client.post(url + "/operations", headers=token, json=manual)
    assert result.status_code == 200, result.text
    assert result.json()["signal"]["state"] == "manual"
    answer = dict(
        client_event_id=str(uuid4()),
        step_id=flow["nodes"][0]["id"],
        occurrence_id="study",
        recorded_at=NOW,
        value={
            "state": "delivery",
            "mode": "manual",
            "codes": ["731"],
            "reason": "Staff verified physical delivery",
            "elapsed_ms": 120000,
            "offline": True,
        },
    )
    assert (
        client.post(url + "/form-events", headers=token, json={"events": [answer]}).status_code
        == 200
    )
    exported = client.get(f"/studies/{study['id']}/export", headers=researcher_headers).text
    assert "elapsed_ms" not in exported and "offline" not in exported
    operational = client.get("/operations/export", headers=researcher_headers).text
    assert "elapsed_ms" in operational and "120000" in operational


def test_late_manual_audit_after_research_advances_and_no_reopened_ready(
    client, researcher_headers
):
    _, _, _, flow, _, session, token, _, _, command = setup(client, researcher_headers)
    url = f"/sessions/{session['id']}"
    answer = dict(
        client_event_id=str(uuid4()),
        step_id=flow["nodes"][0]["id"],
        occurrence_id="study",
        recorded_at=NOW,
        value={
            "state": "delivery",
            "mode": "manual",
            "codes": ["731"],
            "reason": "Physical verification",
            "elapsed_ms": 120000,
            "offline": True,
        },
    )
    assert (
        client.post(url + "/form-events", headers=token, json={"events": [answer]}).status_code
        == 200
    )
    events = [
        path(flow["nodes"][0]["id"], 2, "submitted", [answer["client_event_id"]]),
        path(flow["nodes"][1]["id"], 3, "entered"),
    ]
    assert (
        client.post(url + "/path-events", headers=token, json={"events": events}).status_code == 200
    )
    assert client.post(url + "/operations", headers=token, json=command).status_code == 409
    manual = dict(
        command,
        client_event_id=str(uuid4()),
        action="manual",
        codes=["731"],
        reason="Physical verification",
        elapsed_ms=120000,
        offline=True,
    )
    result = client.post(url + "/operations", headers=token, json=manual)
    assert result.status_code == 200, result.text
    assert result.json()["signal"]["state"] == "manual"
    assert (
        client.post(url + "/operations", headers=token, json=manual).json()["status"] == "duplicate"
    )
    assert (
        client.post(
            url + "/operations", headers=token, json=dict(command, client_event_id=str(uuid4()))
        ).status_code
        == 409
    )


def test_booth_release_retries_and_invalid_layout(client, researcher_headers):
    _, _, _, _, _, session, token, room, assignment, command = setup(client, researcher_headers)
    assert (
        client.post(
            f"/sessions/{session['id']}/operations", headers=token, json=command
        ).status_code
        == 200
    )
    invalid = {"name": "Invalid", "rows": 1, "columns": 1, "booths": room["booths"]}
    assert client.post("/rooms", headers=researcher_headers, json=invalid).status_code == 422
    payload = {
        "client_event_id": str(uuid4()),
        "staff_name": "Staff",
        "reason": "End booth assignment",
    }
    url = f"/booth-assignments/{assignment['id']}/release"
    result = client.post(url, headers=researcher_headers, json=payload)
    assert result.status_code == 200, result.text
    assert (
        client.post(url, headers=researcher_headers, json=payload).json()["status"] == "duplicate"
    )
    assert (
        client.get(f"/sessions/{session['id']}/operations", headers=token).json()["signals"][0][
            "state"
        ]
        == "cancel"
    )


def test_sse_snapshot_and_cursor_replay_without_long_transaction(client, researcher_headers):
    import asyncio

    _, _, _, _, _, session, token, _, _, command = setup(client, researcher_headers)
    assert (
        client.post(
            f"/sessions/{session['id']}/operations", headers=token, json=command
        ).status_code
        == 200
    )
    endpoint = next(
        r.endpoint for r in client.app.routes if getattr(r, "path", None) == "/operator/events"
    )

    class Connected:
        async def is_disconnected(self):
            return False

    async def frames():
        stream = endpoint(Connected(), "operator-test", 0).body_iterator
        first = await anext(stream)
        second = await anext(stream)
        third = await anext(stream)
        await stream.aclose()
        return first, second, third

    frames = asyncio.run(frames())
    assert "event: operation" in frames[0] and "id: 1" in frames[0]
    assert "event: operation" in frames[1] and "id: 2" in frames[1]
    assert "event: snapshot" in frames[2] and "ready" in frames[2]
    assert "answers" not in str(frames)


def test_booth_identity_and_frozen_layout_survive_revision(client, researcher_headers):
    _, _, _, _, _, session, token, room, _, command = setup(client, researcher_headers)
    assert (
        client.post(
            f"/sessions/{session['id']}/operations", headers=token, json=command
        ).status_code
        == 200
    )
    payload = {k: room[k] for k in ("room_id", "name", "rows", "columns", "booths")}
    payload.update(expected_revision=1, booths=[room["booths"][1]])
    revised = client.post("/rooms", headers=researcher_headers, json=payload)
    assert revised.status_code == 200, revised.text
    other = {
        "name": "Another room",
        "rows": 1,
        "columns": 1,
        "booths": [dict(room["booths"][0], column=1)],
    }
    assert client.post("/rooms", headers=researcher_headers, json=other).status_code == 409
    dashboard = client.get(
        "/operator/dashboard", headers={"Authorization": "Bearer " + OPERATOR}
    ).json()
    task = next(t for t in dashboard["tasks"] if t["session_id"] == session["id"])
    assert task["room_revision"] == 1
    assert {r["id"] for r in dashboard["rooms"]} == {room["id"], revised.json()["id"]}
    package = client.get(f"/sessions/{session['id']}/test", headers=token).json()
    assert package["serving_assignment"]["room_revision"] == 1
    with client.app.state.engine.begin() as db:
        with pytest.raises(IntegrityError):
            db.execute(text("UPDATE booths SET room_id='foreign'"))


def test_serving_publication_requires_restriction_guard(client, researcher_headers):
    from test_flow_guards import node, save
    from test_sample_loop import loop_study

    _, _, flow, base, _ = loop_study(client, researcher_headers)
    gate = node(
        "serve_gate",
        {
            "body": {"en": "Delivery"},
            "preparation": {"en": "One portion"},
            "sample_binding": "current",
            "sample_ids": [],
            "timeout_seconds": 120,
        },
    )
    flow["nodes"][1]["data"]["children"].insert(0, gate)
    review = save(client, researcher_headers, base, flow)
    assert "unsafe_serving" in {i["code"] for i in review["issues"]}
    gate["guard"] = {
        "variable": "derived.sample_conflicts_restriction",
        "operator": "eq",
        "value": False,
    }
    gate["otherwise"] = {"action": "next_sample"}
    assert save(client, researcher_headers, base, flow)["valid"]
    children = flow["nodes"][1]["data"]["children"]
    children.append(children.pop(0))
    assert "serving_bypass" in {
        i["code"] for i in save(client, researcher_headers, base, flow)["issues"]
    }
    children.insert(0, children.pop())
    extra = deepcopy(gate)
    extra["id"] = str(uuid4())
    children.insert(1, extra)
    assert "repeated_serving" in {
        i["code"] for i in save(client, researcher_headers, base, flow)["issues"]
    }


def test_operator_secret_file_and_distinct_roles(tmp_path):
    path = tmp_path / "operator.secret"
    path.write_text(OPERATOR, encoding="utf-8")
    settings = Settings(researcher_token="r" * 40, operator_token_file=path)
    assert settings.operator_token.get_secret_value() == OPERATOR
    with pytest.raises(ValueError):
        Settings(researcher_token=OPERATOR, operator_token=OPERATOR)
