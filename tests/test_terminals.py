"""Terminal provisioning, ownership and non-destructive retirement."""

from uuid import uuid4

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError
from test_offline_execution import path, provision

STAFF = {"staff_name": "Lab technician", "reason": "Synthetic rehearsal"}


def register(client, h, name="Tablet 01"):
    result = client.post("/terminals", headers=h, json={**STAFF, "name": name})
    assert result.status_code == 201, result.text
    terminal = result.json()
    return terminal, {"Authorization": "Bearer " + terminal["terminal_token"]}


def assign(client, h, terminal, session, revision=0):
    return client.post(
        f"/terminals/{terminal['id']}/assignments",
        headers=h,
        json={**STAFF, "expected_revision": revision, "session_id": session["id"]},
    )


def test_terminal_auth_assignment_scope_audit_and_retirement(client, researcher_headers):
    h = researcher_headers
    study, version, method, flow, base, session, legacy = provision(client, h)
    terminal, token = register(client, h)
    url = f"/terminals/{terminal['id']}"
    assert client.get("/terminals").status_code == 401
    assert client.get("/terminals", headers=token).status_code == 401
    assert client.get(url + "/audit", headers=token).status_code == 401
    assert client.get(url + "/assignment", headers=legacy).status_code == 401
    assert client.get(f"/terminals/{uuid4()}/assignment", headers=token).status_code == 401
    assert client.get(url + "/assignment", headers=token).json()["session_id"] is None
    assert "token" not in str(client.get("/terminals", headers=h).json())
    assert assign(client, h, terminal, session).status_code == 200
    assert assign(client, h, terminal, session).status_code == 409
    assert client.get(url + "/assignment", headers=token).json()["session_id"] == session["id"]
    package = client.get(f"/sessions/{session['id']}/test", headers=token).json()
    assert package == client.get(f"/sessions/{session['id']}/test", headers=legacy).json()
    assert package["context"] == {"language": "en", "booth_number": 0, "returning_code_hashes": []}
    another = client.post(
        "/sessions", headers=h, json={"study_version_id": version["id"], "assessor_code": "Other"}
    ).json()
    assert client.get(f"/sessions/{another['id']}/test", headers=token).status_code == 401
    assert assign(client, h, terminal, another, 1).status_code == 409
    event = path(flow["nodes"][0]["id"], 1, "entered")
    assert (
        client.post(
            f"/sessions/{session['id']}/path-events", headers=token, json={"events": [event]}
        ).status_code
        == 200
    )
    retired = client.post(url + "/retire", headers=h, json={**STAFF, "expected_revision": 1})
    assert retired.status_code == 200
    assert client.get(url + "/assignment", headers=token).status_code == 401
    assert (
        client.post(
            f"/sessions/{session['id']}/path-events", headers=token, json={"events": [event]}
        ).status_code
        == 401
    )
    assert client.get(f"/sessions/{session['id']}/progress", headers=legacy).json()["next_seq"] == 2
    replacement, _ = register(client, h, "Replacement")
    assert assign(client, h, replacement, session).status_code == 409
    assert assign(client, h, replacement, another).status_code == 200
    history = client.get(url + "/audit", headers=h).json()
    assert [a["action"] for a in history] == ["registered", "assigned", "retired"]
    assert all(
        a["staff_name"] == STAFF["staff_name"] and a["principal"].startswith("researcher:")
        for a in history
    )
    assert history[-1]["session_id"] == session["id"]
    assert (
        client.get(f"/studies/{study['id']}/path-events", headers=h).json()[0]["client_event_id"]
        == event["client_event_id"]
    )
    with client.app.state.engine.begin() as db:
        with pytest.raises(IntegrityError):
            db.execute(text("UPDATE terminal_audit SET reason='changed'"))
        with pytest.raises(IntegrityError):
            db.execute(text("DELETE FROM terminal_assignments"))


@pytest.mark.parametrize("field,value", [("name", " "), ("staff_name", ""), ("reason", " ")])
def test_terminal_registration_validation(client, researcher_headers, field, value):
    payload = {**STAFF, "name": "Tablet", field: value}
    assert client.post("/terminals", headers=researcher_headers, json=payload).status_code == 422


def test_terminal_duplicate_name_and_progress_conflict(client, researcher_headers):
    h = researcher_headers
    _, _, _, flow, _, session, legacy = provision(client, h)
    terminal, _ = register(client, h)
    assert (
        client.post("/terminals", headers=h, json={**STAFF, "name": terminal["name"]}).status_code
        == 409
    )
    event = path(flow["nodes"][0]["id"], 1, "entered")
    assert (
        client.post(
            f"/sessions/{session['id']}/path-events", headers=legacy, json={"events": [event]}
        ).status_code
        == 200
    )
    assert assign(client, h, terminal, session).status_code == 409
    assert client.get(f"/terminals/{terminal['id']}/audit", headers=h).json()[0]["revision"] == 0


def test_terminal_migration_preserves_existing_sessions_and_refuses_history_loss(
    tmp_path, monkeypatch
):
    from pathlib import Path

    from alembic import command
    from alembic.config import Config

    from sensibilia.db import EXPECTED_REVISION, make_engine

    url = f"sqlite:///{(tmp_path / 'upgrade.db').as_posix()}"
    monkeypatch.setenv("SENSIBILIA_DATABASE_URL", url)
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    command.upgrade(config, "0006")
    engine = make_engine(url)
    with engine.begin() as db:
        db.execute(
            text(
                "INSERT INTO studies (id,title,description,status,created_at) "
                "VALUES ('s','Existing','','published','now')"
            )
        )
        db.execute(
            text(
                "INSERT INTO study_versions "
                "(id,study_id,version_number,title,description,published_at,revision) "
                "VALUES ('v','s',1,'Existing','','now',0)"
            )
        )
        db.execute(
            text(
                "INSERT INTO sessions "
                "(id,study_version_id,assessor_code,token_hash,presentation_order,started_at,status,"
                "context,loop_assignments) "
                "VALUES ('a','v','ORIGINAL','hash','[]','now','in_progress','{}','[]')"
            )
        )
        before = db.execute(text("SELECT * FROM sessions")).all()
    command.upgrade(config, "head")
    with engine.begin() as db:
        assert db.execute(text("SELECT * FROM sessions")).all() == before
        assert db.scalar(text("SELECT version_num FROM alembic_version")) == EXPECTED_REVISION
    command.downgrade(config, "0006")
    command.upgrade(config, "head")
    with engine.begin() as db:
        db.execute(
            text(
                "INSERT INTO terminals (id,name,token_hash,revision,registered_at) "
                "VALUES ('t','Tablet','terminal-hash',0,'now')"
            )
        )
    with pytest.raises(RuntimeError, match="Cannot discard terminal history"):
        command.downgrade(config, "0006")
    engine.dispose()


def pair(client, h, booth_id=None):
    issued = client.post(
        "/terminals/pairings",
        headers=h,
        json={"staff_name": "Lab technician", "booth_id": booth_id},
    )
    assert issued.status_code == 201, issued.text
    return issued.json()


def test_pairing_is_one_time_named_automatically_and_never_lists_the_key(
    client, researcher_headers
):
    h = researcher_headers
    assert client.post("/terminals/pairings", json={"staff_name": "x"}).status_code == 401
    first = pair(client, h)
    assert len(first["code"]) == 8
    status = client.get(f"/terminals/pairings/{first['id']}", headers=h).json()
    assert status["status"] == "waiting" and status["terminal"] is None
    redeemed = client.post("/terminal-pairings/redeem", json={"code": first["code"].lower()})
    assert redeemed.status_code == 200, redeemed.text
    body = redeemed.json()
    assert body["name"] == "Tablet 01"
    assert client.post("/terminal-pairings/redeem", json={"code": first["code"]}).status_code == 404
    done = client.get(f"/terminals/pairings/{first['id']}", headers=h).json()
    assert done["status"] == "paired" and done["terminal"]["id"] == body["terminal_id"]
    assert body["terminal_token"] not in str(client.get("/terminals", headers=h).json())
    token = {"Authorization": "Bearer " + body["terminal_token"]}
    task = client.get(f"/terminals/{body['terminal_id']}/assignment", headers=token)
    assert task.status_code == 200 and task.json()["session_id"] is None
    second = pair(client, h)
    other = client.post("/terminal-pairings/redeem", json={"code": second["code"]}).json()
    assert other["name"] == "Tablet 02"
    audit = client.get(f"/terminals/{body['terminal_id']}/audit", headers=h).json()
    assert audit[0]["action"] == "registered" and audit[0]["staff_name"] == "Lab technician"


def redeem(client, h):
    code = pair(client, h)["code"]
    redeemed = client.post("/terminal-pairings/redeem", json={"code": code})
    assert redeemed.status_code == 200, redeemed.text
    return redeemed.json()


def test_removing_a_tablet_frees_its_name_for_the_next_new_tablet(client, researcher_headers):
    h = researcher_headers
    first, second, third = (redeem(client, h) for _ in range(3))
    assert [first["name"], second["name"], third["name"]] == ["Tablet 01", "Tablet 02", "Tablet 03"]
    url = f"/terminals/{first['terminal_id']}/retire"
    removed = client.post(url, headers=h, json={**STAFF, "expected_revision": 0})
    assert removed.status_code == 200, removed.text
    # The removed tablet keeps its old name plus a marker, so history stays readable.
    assert removed.json()["name"].startswith("Tablet 01 (removed ")
    # The next new tablet gets the freed number, not the next one after the highest.
    assert redeem(client, h)["name"] == "Tablet 01"
    assert redeem(client, h)["name"] == "Tablet 04"
    # A manual registration may reuse a freed name too.
    gone = client.post(
        f"/terminals/{second['terminal_id']}/retire",
        headers=h,
        json={**STAFF, "expected_revision": 0},
    )
    assert gone.status_code == 200
    manual = client.post("/terminals", headers=h, json={**STAFF, "name": "Tablet 02"})
    assert manual.status_code == 201, manual.text
    assert (
        client.post("/terminals", headers=h, json={**STAFF, "name": "Tablet 02"}).status_code == 409
    )
    # Nothing is deleted: both removed tablets and their audit history are still there.
    everything = client.get("/terminals?limit=100", headers=h).json()
    assert {first["terminal_id"], second["terminal_id"]} <= {t["id"] for t in everything}
    actions = [
        a["action"]
        for a in client.get(f"/terminals/{first['terminal_id']}/audit", headers=h).json()
    ]
    assert actions == ["registered", "retired"]
    # The list can leave removed tablets out.
    active = client.get("/terminals?limit=100&retired=exclude", headers=h).json()
    assert all(t["retired_at"] is None for t in active)
    assert first["terminal_id"] not in {t["id"] for t in active}


def test_names_of_tablets_removed_before_this_change_are_freed_when_needed(
    client, researcher_headers, database_url
):
    h = researcher_headers
    old = redeem(client, h)
    assert (
        client.post(
            f"/terminals/{old['terminal_id']}/retire",
            headers=h,
            json={**STAFF, "expected_revision": 0},
        ).status_code
        == 200
    )
    # Put the row back as an older release left it: retired, but still holding its plain name.
    engine = create_engine(database_url)
    with engine.begin() as db:
        db.execute(
            text("UPDATE terminals SET name='Tablet 01' WHERE id=:id"), {"id": old["terminal_id"]}
        )
    assert redeem(client, h)["name"] == "Tablet 01"


def test_expired_unknown_and_repeated_wrong_codes_are_refused(
    client, researcher_headers, database_url
):
    h = researcher_headers
    issued = pair(client, h)
    engine = create_engine(database_url)
    with engine.begin() as db:
        db.execute(text("UPDATE terminal_pairings SET expires_at='2000-01-01T00:00:00+00:00'"))
    assert (
        client.get(f"/terminals/pairings/{issued['id']}", headers=h).json()["status"] == "expired"
    )
    assert (
        client.post("/terminal-pairings/redeem", json={"code": issued["code"]}).status_code == 404
    )
    for _ in range(9):
        assert (
            client.post("/terminal-pairings/redeem", json={"code": "WRONGCODE"}).status_code == 404
        )
    assert client.post("/terminal-pairings/redeem", json={"code": "WRONGCODE"}).status_code == 429
    assert client.get("/terminals", headers=h).json() == []


def test_booth_link_is_unique_and_booth_assignment_reaches_its_tablet(client, researcher_headers):
    h = researcher_headers
    study, version, method, flow, base, session, legacy = provision(client, h)
    room = client.post(
        "/rooms",
        headers=h,
        json=dict(
            name="Lab",
            rows=1,
            columns=2,
            booths=[
                dict(id=str(uuid4()), label=str(i), row=1, column=i, enabled=True) for i in (1, 2)
            ],
        ),
    ).json()
    booth = room["booths"][0]["id"]
    assert (
        client.post(
            "/terminals/pairings", headers=h, json={"staff_name": "T", "booth_id": str(uuid4())}
        ).status_code
        == 422
    )
    paired = client.post(
        "/terminal-pairings/redeem", json={"code": pair(client, h, booth)["code"]}
    ).json()
    token = {"Authorization": "Bearer " + paired["terminal_token"]}
    assert (
        client.post(
            "/terminals/pairings", headers=h, json={"staff_name": "T", "booth_id": booth}
        ).status_code
        == 409
    )
    assign = client.post(
        "/booth-assignments",
        headers=h,
        json=dict(
            client_event_id=str(uuid4()),
            session_id=session["id"],
            room_version_id=room["id"],
            booth_id=booth,
            staff_name="Staff",
            reason="Pilot",
        ),
    )
    assert assign.status_code == 200, assign.text
    task = client.get(f"/terminals/{paired['terminal_id']}/assignment", headers=token).json()
    assert task["session_id"] == session["id"]
    assert client.get(f"/sessions/{session['id']}/test", headers=token).status_code == 200
    listed = client.get("/terminals", headers=h).json()[0]
    assert listed["booth_id"] == booth
    freed = client.put(
        f"/terminals/{paired['terminal_id']}/booth",
        headers=h,
        json={**STAFF, "expected_revision": listed["revision"], "booth_id": None},
    )
    assert freed.status_code == 200 and freed.json()["booth_id"] is None


def test_next_assessment_continues_study_on_tablet_and_booth(
    client, researcher_headers, database_url
):
    h = researcher_headers
    study, version, method, flow, base, session, legacy = provision(client, h)
    room = client.post(
        "/rooms",
        headers=h,
        json=dict(
            name="Lab",
            rows=1,
            columns=1,
            booths=[dict(id=str(uuid4()), label="1", row=1, column=1, enabled=True)],
        ),
    ).json()
    booth = room["booths"][0]["id"]
    paired = client.post(
        "/terminal-pairings/redeem", json={"code": pair(client, h, booth)["code"]}
    ).json()
    token = {"Authorization": "Bearer " + paired["terminal_token"]}
    url = f"/terminals/{paired['terminal_id']}/next-assessment"

    def nxt(**extra):
        revision = client.get("/terminals", headers=h).json()[0]["revision"]
        return client.post(url, headers=h, json={**STAFF, "expected_revision": revision, **extra})

    assert nxt().status_code == 409  # nothing assigned yet
    assigned = client.post(
        "/booth-assignments",
        headers=h,
        json=dict(
            client_event_id=str(uuid4()),
            session_id=session["id"],
            room_version_id=room["id"],
            booth_id=booth,
            staff_name="Staff",
            reason="Pilot",
        ),
    )
    assert assigned.status_code == 200, assigned.text
    refused = nxt()
    assert refused.status_code == 409 and "in progress" in refused.json()["detail"]
    engine = create_engine(database_url)
    with engine.begin() as db:
        db.execute(text("UPDATE sessions SET status='completed' WHERE id=:i"), {"i": session["id"]})
    moved = nxt()
    assert moved.status_code == 200, moved.text
    second = moved.json()["session_id"]
    assert second != session["id"] and moved.json()["session_status"] == "in_progress"
    assert moved.json()["assessor_code"].startswith("A")
    assert client.get(f"/sessions/{second}/test", headers=token).status_code == 200
    assert client.get(f"/sessions/{session['id']}/test", headers=token).status_code == 401
    active = [
        a for a in client.get("/booth-assignments", headers=h).json() if a["released_at"] is None
    ]
    assert [a["session_id"] for a in active] == [second]
    with engine.begin() as db:
        db.execute(text("UPDATE sessions SET status='completed' WHERE id=:i"), {"i": second})
    custom = nxt(assessor_code="VIP7")
    assert custom.status_code == 200 and custom.json()["assessor_code"] == "VIP7"
    engine.dispose()


def test_first_assessment_for_a_tablet_needs_a_released_study(client, researcher_headers):
    h = researcher_headers
    study, version, method, flow, base, session, legacy = provision(client, h)
    paired = client.post("/terminal-pairings/redeem", json={"code": pair(client, h)["code"]}).json()
    url = f"/terminals/{paired['terminal_id']}/next-assessment"
    body = {**STAFF, "expected_revision": 0}
    assert client.post(url, headers=h, json=body).status_code == 409
    assert (
        client.post(url, headers=h, json={**body, "study_version_id": str(uuid4())}).status_code
        == 422
    )
    first = client.post(url, headers=h, json={**body, "study_version_id": version["id"]})
    assert first.status_code == 200, first.text
    assert first.json()["session_status"] == "in_progress"
    assert first.json()["study_version_id"] == version["id"]


def test_a_booth_left_by_a_removed_or_moved_tablet_takes_the_next_tablet(
    client, researcher_headers, database_url
):
    """Laboratory report: after tablets were set up again, every first assessment failed (500)."""
    h = researcher_headers
    study, version, method, flow, base, session, legacy = provision(client, h)
    booths = [dict(id=str(uuid4()), label=str(n), row=1, column=n, enabled=True) for n in (1, 2)]
    room = client.post(
        "/rooms", headers=h, json=dict(name="Lab", rows=1, columns=2, booths=booths)
    ).json()
    one, two = (b["id"] for b in room["booths"])
    engine = create_engine(database_url)

    def redeem(booth):
        return client.post(
            "/terminal-pairings/redeem", json={"code": pair(client, h, booth)["code"]}
        ).json()["terminal_id"]

    def revision(terminal):
        return next(t for t in client.get("/terminals", headers=h).json() if t["id"] == terminal)[
            "revision"
        ]

    def start(terminal):
        return client.post(
            f"/terminals/{terminal}/next-assessment",
            headers=h,
            json={
                **STAFF,
                "expected_revision": revision(terminal),
                "study_version_id": version["id"],
            },
        )

    def finish(response):
        with engine.begin() as db:
            db.execute(
                text("UPDATE sessions SET status='completed' WHERE id=:i"),
                {"i": response.json()["session_id"]},
            )

    # A tablet runs an assessment on booth 1 and is then removed.
    old = redeem(one)
    first = start(old)
    assert first.status_code == 200, first.text
    finish(first)
    retired = client.post(
        f"/terminals/{old}/retire", headers=h, json={**STAFF, "expected_revision": revision(old)}
    )
    assert retired.status_code == 200, retired.text
    # The tablet set up in its place starts on the same booth.
    new = redeem(one)
    second = start(new)
    assert second.status_code == 200, second.text
    # Moved to booth 2 after its assessment, it leaves booth 1 to the next tablet.
    finish(second)
    moved = client.put(
        f"/terminals/{new}/booth",
        headers=h,
        json={**STAFF, "expected_revision": revision(new), "booth_id": two},
    )
    assert moved.status_code == 200, moved.text
    third = redeem(one)
    started = start(third)
    assert started.status_code == 200, started.text
    # An assessment still in progress on the booth is refused with a reason, not a crash.
    with engine.begin() as db:
        db.execute(text("UPDATE terminals SET booth_id=NULL WHERE id=:i"), {"i": third})
    fourth = redeem(one)
    refused = start(fourth)
    assert refused.status_code == 409
    detail = refused.json()["detail"]
    assert "in progress" in detail["message"] and detail["booth_label"] == "1"
    assert detail["session_id"] == started.json()["session_id"]
    # Ending it from the error frees the booth for this tablet.
    ended = client.post(f"/sessions/{detail['session_id']}/end", headers=h)
    assert ended.status_code == 200, ended.text
    restarted = start(fourth)
    assert restarted.status_code == 200, restarted.text
    active = [
        a for a in client.get("/booth-assignments", headers=h).json() if a["released_at"] is None
    ]
    assert sorted(a["session_id"] for a in active) == [restarted.json()["session_id"]]
    engine.dispose()


@pytest.mark.parametrize(
    ("configured", "reported"),
    [("192.168.1.20", "192.168.1.20"), ("127.0.0.1", None), ("", None)],
)
def test_network_address_for_pairing_links(database_url, configured, reported):
    from fastapi.testclient import TestClient

    from sensibilia.api import create_app
    from sensibilia.config import Settings

    settings = Settings(
        database_url=database_url,
        researcher_token="r" * 40,
        analysis_runner=False,
        lan_address=configured,
    )
    with TestClient(create_app(settings)) as client:
        assert client.get("/terminals/network-address").status_code == 401
        result = client.get(
            "/terminals/network-address", headers={"Authorization": "Bearer " + "r" * 40}
        )
        assert result.status_code == 200 and result.json() == {"address": reported}
