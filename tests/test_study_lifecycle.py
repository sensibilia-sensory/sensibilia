"""Closing, ending assessments, archiving and restoring studies."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

from test_api import event, provision, study, submit


def released(client, headers):
    data, test, version = study(client, headers)
    return data, test, version


def listed(client, headers, **params):
    response = client.get("/studies", headers=headers, params=params)
    assert response.status_code == 200, response.text
    return {s["id"] for s in response.json()}


def test_closing_stops_new_assessments_but_open_ones_finish(client, researcher_headers):
    h = researcher_headers
    data, test, version = released(client, h)
    session, token = provision(client, h, version)
    closed = client.post(f"/studies/{data['id']}/close", headers=h)
    assert closed.status_code == 200, closed.text
    assert closed.json()["status"] == "closed" and closed.json()["closed_at"]
    refused = client.post(
        "/sessions", headers=h, json={"study_version_id": version["id"], "assessor_code": "A2"}
    )
    assert refused.status_code == 409
    assert submit(client, session, token, [event(test)]).status_code == 200
    assert client.post(f"/studies/{data['id']}/close", headers=h).status_code == 409
    reopened = client.post(f"/studies/{data['id']}/reopen", headers=h)
    assert reopened.json()["status"] == "active" and reopened.json()["closed_at"] is None
    assert provision(client, h, version)[0]["status"] == "in_progress"


def test_a_draft_cannot_be_closed(client, researcher_headers):
    created = client.post("/studies", headers=researcher_headers, json={"title": "Draft"}).json()
    assert (
        client.post(f"/studies/{created['id']}/close", headers=researcher_headers).status_code
        == 409
    )


def test_ending_open_assessments_keeps_answers_recorded_before_the_end(client, researcher_headers):
    h = researcher_headers
    data, test, version = released(client, h)
    session, token = provision(client, h, version)
    before = event(test, recorded_at=(datetime.now(UTC) - timedelta(minutes=1)).isoformat())
    closed = client.post(
        f"/studies/{data['id']}/close", headers=h, json={"end_open_assessments": True}
    )
    assert closed.status_code == 200, closed.text
    listing = client.get(f"/studies/{data['id']}/versions/{version['id']}/sessions", headers=h)
    assert [s["status"] for s in listing.json()] == ["ended"]
    assert listing.json()[0]["completed_at"]
    # The tablet was offline: what it recorded before the end still arrives.
    late = submit(client, session, token, [before])
    assert late.status_code == 200, late.text
    assert late.json()["events"][0]["status"] == "accepted"
    # Nothing recorded after the end is accepted.
    after = event(test, recorded_at=(datetime.now(UTC) + timedelta(minutes=5)).isoformat())
    assert submit(client, session, token, [after]).status_code == 409
    # An exact retry is still a harmless duplicate, and finishing an ended session is a no-op.
    assert submit(client, session, token, [before]).json()["events"][0]["status"] == "duplicate"
    done = client.post(f"/sessions/{session['id']}/complete", headers=token)
    assert done.status_code == 200 and done.json()["status"] == "ended"


def test_staff_can_end_one_assessment(client, researcher_headers):
    h = researcher_headers
    data, test, version = released(client, h)
    first, _ = provision(client, h, version)
    second, _ = provision(client, h, version)
    ended = client.post(f"/sessions/{first['id']}/end", headers=h)
    assert ended.status_code == 200 and ended.json()["status"] == "ended"
    assert client.post(f"/sessions/{first['id']}/end", headers=h).status_code == 409
    states = {
        s["id"]: s["status"]
        for s in client.get(
            f"/studies/{data['id']}/versions/{version['id']}/sessions", headers=h
        ).json()
    }
    assert states == {first["id"]: "ended", second["id"]: "in_progress"}
    only = client.get(
        f"/studies/{data['id']}/versions/{version['id']}/sessions?status=ended", headers=h
    )
    assert [s["id"] for s in only.json()] == [first["id"]]
    assert client.post(f"/sessions/{uuid_missing()}/end", headers=h).status_code == 404


def uuid_missing():
    return "00000000-0000-4000-8000-000000000000"


def test_archive_hides_studies_until_restored(client, researcher_headers):
    h = researcher_headers
    data, test, version = released(client, h)
    session, token = provision(client, h, version)
    assert submit(client, session, token, [event(test)]).status_code == 200
    counted = {s["id"]: s["open_assessments"] for s in client.get("/studies", headers=h).json()}
    assert counted[data["id"]] == 1
    assert client.get(f"/studies/{data['id']}", headers=h).json()["open_assessments"] == 1
    refused = client.post(f"/studies/{data['id']}/archive", headers=h)
    assert refused.status_code == 409 and "1 assessment" in refused.json()["detail"]
    assert client.post(f"/sessions/{session['id']}/end", headers=h).status_code == 200

    archived = client.post(f"/studies/{data['id']}/archive", headers=h)
    assert archived.status_code == 200 and archived.json()["archived_at"]
    assert data["id"] not in listed(client, h)
    assert data["id"] in listed(client, h, archived="only")
    assert data["id"] in listed(client, h, archived="include")
    # Results and export remain reachable.
    assert client.get(f"/studies/{data['id']}", headers=h).status_code == 200
    assert client.get(f"/studies/{data['id']}/export", headers=h).status_code == 200
    # An archived study is read-only and takes no assessments.
    assert client.post(f"/studies/{data['id']}/drafts", headers=h).status_code == 409
    blocked = client.post(
        "/sessions", headers=h, json={"study_version_id": version["id"], "assessor_code": "A9"}
    )
    assert blocked.status_code == 409
    assert client.post(f"/studies/{data['id']}/archive", headers=h).status_code == 409

    restored = client.post(f"/studies/{data['id']}/restore", headers=h)
    assert restored.status_code == 200 and restored.json()["archived_at"] is None
    assert data["id"] in listed(client, h)
    assert data["id"] not in listed(client, h, archived="only")
    assert client.post(f"/studies/{data['id']}/restore", headers=h).status_code == 409


def test_a_draft_can_be_archived_but_not_edited(client, researcher_headers):
    h = researcher_headers
    created = client.post("/studies", headers=h, json={"title": "Abandoned"}).json()
    assert client.post(f"/studies/{created['id']}/archive", headers=h).status_code == 200
    assert created["id"] not in listed(client, h)
    added = client.post(
        f"/studies/{created['id']}/samples", headers=h, json={"code": "A", "label": "A"}
    )
    assert added.status_code == 409


def test_flow_v2_events_recorded_before_the_end_still_sync(client, researcher_headers):
    from test_offline_execution import NOW, path
    from test_offline_execution import provision as provision_v2

    h = researcher_headers
    study_, version, method, flow, _, session, token = provision_v2(client, h, True)
    url = f"/sessions/{session['id']}"
    step = flow["nodes"][0]["id"]
    assert client.post(f"/sessions/{session['id']}/end", headers=h).status_code == 200
    # NOW is in the past: recorded before the end, so the tablet's offline path still arrives.
    early = client.post(
        url + "/path-events", headers=token, json={"events": [path(step, 1, "entered")]}
    )
    assert early.status_code == 200, early.text
    later = path(step, 2, "entered")
    later["recorded_at"] = (datetime.now(UTC) + timedelta(hours=1)).isoformat()
    assert (
        client.post(url + "/path-events", headers=token, json={"events": [later]}).status_code
        == 409
    )
    answer = dict(
        client_event_id=str(uuid4()),
        step_id=step,
        occurrence_id="study",
        value={"state": "answered", "value": 0},
        recorded_at=NOW,
    )
    posted = client.post(url + "/form-events", headers=token, json={"events": [answer]})
    assert posted.status_code == 200, posted.text
