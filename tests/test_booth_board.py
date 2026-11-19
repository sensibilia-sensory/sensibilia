"""Booth board: canvas positions and the live status of each tablet's assessor."""

from uuid import uuid4

from test_offline_execution import path, provision
from test_terminals import STAFF, assign, register


def room_payload(booths, **extra):
    return dict(
        name="Lab",
        rows=20,
        columns=20,
        booths=booths,
        expected_revision=0,
        **extra,
    )


def booth(i, **extra):
    return dict(id=str(uuid4()), label=str(i), row=1, column=i, enabled=True, **extra)


def test_booth_positions_are_kept_per_revision_and_bounded(client, researcher_headers):
    h = researcher_headers
    placed = booth(1, x=0.25, y=0.5)
    room = client.post("/rooms", headers=h, json=room_payload([placed, booth(2)])).json()
    assert room["booths"][0]["x"] == 0.25 and room["booths"][1]["x"] is None
    outside = room_payload([booth(1, x=1.5, y=0)])
    assert client.post("/rooms", headers=h, json=outside).status_code == 422
    moved = dict(room_payload(room["booths"]), room_id=room["room_id"], expected_revision=1)
    moved["booths"] = [dict(room["booths"][0], x=0.75), room["booths"][1]]
    second = client.post("/rooms", headers=h, json=moved).json()
    assert second["revision"] == 2 and second["booths"][0]["x"] == 0.75
    # The first revision is untouched history.
    assert client.get("/rooms", headers=h).json()[0]["revision"] == 2


def test_board_follows_tablet_through_waiting_progress_and_completion(client, researcher_headers):
    h = researcher_headers
    study, version, method, flow, base, session, legacy = provision(client, h)
    terminal, token = register(client, h)
    room = client.post("/rooms", headers=h, json=room_payload([booth(1, x=0.1, y=0.1)])).json()
    booth_id = room["booths"][0]["id"]
    assert client.get("/booth-board").status_code == 401
    assert client.get("/booth-board", headers=token).status_code == 401
    waiting = client.get("/booth-board", headers=h).json()["tablets"][0]
    assert (waiting["stage"], waiting["detail"]) == ("waiting", "Waiting for assignment")
    assert waiting["booth_id"] is None
    assert waiting["study_version_id"] is None
    link = client.put(
        f"/terminals/{terminal['id']}/booth",
        headers=h,
        json={**STAFF, "expected_revision": 0, "booth_id": booth_id},
    )
    assert link.status_code == 200, link.text
    assert assign(client, h, terminal, session, 1).status_code == 200
    tablet = client.get("/booth-board", headers=h).json()["tablets"][0]
    assert tablet["booth_id"] == booth_id and tablet["assessor_code"] == session["assessor_code"]
    assert (tablet["stage"], tablet["detail"]) == ("in_progress", "Test starting")
    assert tablet["study_version_id"] == session["study_version_id"]
    event = path(flow["nodes"][0]["id"], 1, "entered")
    posted = client.post(
        f"/sessions/{session['id']}/path-events", headers=token, json={"events": [event]}
    )
    assert posted.status_code == 200
    tablet = client.get("/booth-board", headers=h).json()["tablets"][0]
    assert tablet["detail"].startswith("Test in progress, step 1 of ")
    ended = client.post(f"/sessions/{session['id']}/end", headers=h)
    assert ended.status_code == 200
    tablet = client.get("/booth-board", headers=h).json()["tablets"][0]
    assert (tablet["stage"], tablet["detail"]) == ("ended", "Ended by staff")
    assert "token" not in str(client.get("/booth-board", headers=h).json())
    unlinked = client.put(
        f"/terminals/{terminal['id']}/booth",
        headers=h,
        json={**STAFF, "expected_revision": 2, "booth_id": None},
    )
    assert unlinked.status_code == 200
    assert client.get("/booth-board", headers=h).json()["tablets"][0]["booth_id"] is None


def test_stage_is_serving_while_a_sample_is_requested_and_resumes_after(client, researcher_headers):
    from sqlalchemy.orm import Session as Db
    from test_operations import OPERATOR, setup

    from sensibilia.booths import board_stage
    from sensibilia.models import AssessorSession

    _, _, _, _, _, session, token, _, assignment, command = setup(client, researcher_headers)

    def stage():
        with Db(client.app.state.engine) as db:
            return board_stage(db, db.get(AssessorSession, session["id"]), "other-process")

    assert stage()[0] == "in_progress"
    url = f"/sessions/{session['id']}/operations"
    assert client.post(url, headers=token, json=command).status_code == 200
    assert stage() == ("serving", "Needs samples 731")
    op = {"Authorization": "Bearer " + OPERATOR}
    for action, revision in (("acknowledged", 1), ("served", 2)):
        step = dict(
            command,
            client_event_id=str(uuid4()),
            action=action,
            expected_revision=revision,
            actor="Operator 1",
        )
        assert client.post("/operator/operations", headers=op, json=step).status_code == 200
    assert stage()[0] == "in_progress"


def test_board_serves_with_the_researcher_key_and_keeps_credentials_apart(
    client, researcher_headers
):
    from sqlalchemy.orm import Session as Db
    from test_operations import OPERATOR, setup

    from sensibilia.models import TerminalAssignment

    h = researcher_headers
    _, _, _, _, _, session, token, _, assignment, command = setup(client, h)
    terminal, _ = register(client, h)
    # Link the tablet to the running assessment directly: assigning through the terminal API
    # would release the serving assignment this test needs.
    with Db(client.app.state.engine) as db:
        db.add(TerminalAssignment(terminal_id=terminal["id"], session_id=session["id"]))
        db.commit()
    ops = f"/sessions/{session['id']}/operations"

    def tablet():
        return client.get("/booth-board", headers=h).json()["tablets"][0]

    assert tablet()["serving"] is None
    assert client.post(ops, headers=token, json=command).status_code == 200
    serving = tablet()["serving"]
    assert serving["assignment_id"] == assignment["id"]
    assert serving["signal"]["state"] == "ready" and serving["signal"]["revision"] == 1
    assert [(s["code"], s["label"]) for s in serving["slots"]] == [("731", "Private batch")]
    assert serving["preparation"] == "One portion"
    assert "token" not in str(serving)

    url = "/booth-board/operations"
    ack = dict(
        command,
        client_event_id=str(uuid4()),
        action="acknowledged",
        expected_revision=1,
        actor="Anna",
    )
    # Researcher-key route only: tablets and the operator key are not researchers.
    assert client.post(url, json=ack).status_code == 401
    assert client.post(url, headers=token, json=ack).status_code == 401
    assert (
        client.post(url, headers={"Authorization": "Bearer " + OPERATOR}, json=ack).status_code
        == 401
    )
    assert client.post(url, headers=h, json=dict(ack, action="received")).status_code == 403
    assert client.post(url, headers=h, json=dict(ack, action="manual")).status_code == 403
    sent = client.post(url, headers=h, json=ack)
    assert sent.status_code == 200, sent.text
    assert client.post(url, headers=h, json=ack).json()["status"] == "duplicate"
    assert tablet()["serving"]["signal"]["state"] == "acknowledged"
    served = dict(ack, client_event_id=str(uuid4()), action="served", expected_revision=2)
    assert client.post(url, headers=h, json=served).status_code == 200
    stale = dict(served, client_event_id=str(uuid4()))
    assert client.post(url, headers=h, json=stale).status_code == 409
    assert tablet()["serving"] is None
    # The audit ledger names the credential class and the typed staff name.
    ledger = client.get("/operations/export", headers=h).text
    assert "researcher-key:" in ledger and "Anna" in ledger
    # The operator key keeps its own routes.
    op = {"Authorization": "Bearer " + OPERATOR}
    assert client.get("/operator/dashboard", headers=op).status_code == 200
    assert client.get("/operator/dashboard", headers=h).status_code == 401
