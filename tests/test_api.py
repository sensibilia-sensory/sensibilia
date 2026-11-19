import csv
import io
import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from conftest import RESEARCHER_TOKEN
from fastapi.testclient import TestClient
from sqlalchemy import event as sqlalchemy_event
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session
from test_methods import configuration

from sensibilia.api import create_app
from sensibilia.config import Settings


def study(client, headers, **config_overrides):
    created = client.post("/studies", headers=headers, json={"title": "Acceptance"})
    assert created.status_code == 201, created.text
    data = created.json()
    test = client.post(
        f"/studies/{data['id']}/tests",
        headers=headers,
        json={"configuration": configuration(**config_overrides)},
    )
    assert test.status_code == 201, test.text
    published = client.post(f"/studies/{data['id']}/publish", headers=headers)
    assert published.status_code == 200, published.text
    return data, test.json(), published.json()


def provision(client, headers, version):
    result = client.post(
        "/sessions",
        headers=headers,
        json={"study_version_id": version["id"], "assessor_code": "A001"},
    )
    assert result.status_code == 201, result.text
    data = result.json()
    return data, {"Authorization": f"Bearer {data['session_token']}"}


def event(test, **overrides):
    return {
        "client_event_id": str(uuid4()),
        "study_test_id": test["id"],
        "question_id": "overall",
        "value": {"state": "rated", "rating": 7},
        "recorded_at": datetime.now(UTC).isoformat(),
        **overrides,
    }


def submit(client, session, headers, events):
    return client.post(
        f"/sessions/{session['id']}/responses", headers=headers, json={"events": events}
    )


def test_full_collection_export_workflow(client, researcher_headers):
    methods = client.get("/test-types", headers=researcher_headers).json()
    hedonic = next(method for method in methods if method["id"] == "hedonic-9-v1")
    assert hedonic["method_metadata"]["renderer_status"] == "implemented"
    assert client.get("/test-types/hedonic-9-v1", headers=researcher_headers).status_code == 200
    data, test, version = study(client, researcher_headers)
    session, headers = provision(client, researcher_headers, version)
    package = client.get(f"/sessions/{session['id']}/test", headers=headers)
    assert package.status_code == 200
    assert package.json()["study_version"]["id"] == version["id"]
    assert package.json()["session"]["presentation_order"] == [test["id"]]
    assert len(package.json()["tests"][0]["configuration"]["scale_labels"]) == 9
    original = event(test)
    result = submit(client, session, headers, [original])
    assert result.status_code == 200, result.text
    assert result.json()["events"][0]["status"] == "accepted"
    assert submit(client, session, headers, [original]).json()["events"][0]["status"] == "duplicate"
    complete = client.post(f"/sessions/{session['id']}/complete", headers=headers)
    assert complete.json()["status"] == "completed"
    assert submit(client, session, headers, [original]).status_code == 200
    assert submit(client, session, headers, [event(test)]).status_code == 409
    exported = client.get(f"/studies/{data['id']}/export", headers=researcher_headers)
    rows = list(csv.DictReader(io.StringIO(exported.text)))
    assert len(rows) == 1
    row = rows[0]
    assert row["study_id"] == data["id"]
    assert row["study_version_id"] == version["id"]
    assert row["version_number"] == "1"
    assert row["session_id"] == session["id"]
    assert row["study_test_id"] == test["id"]
    assert json.loads(row["sample_id_json"]) is None
    assert json.loads(row["value_json"]) == {"state": "rated", "rating": 7}
    assert row["recorded_at"] == original["recorded_at"]
    assert row["received_at"] and row["method_schema_version"] == "1"


def test_published_versions_are_frozen(client, researcher_headers):
    data, old_test, old_version = study(client, researcher_headers)
    session, headers = provision(client, researcher_headers, old_version)
    path = f"/studies/{data['id']}"
    assert (
        client.post(
            f"{path}/tests", headers=researcher_headers, json={"configuration": configuration()}
        ).status_code
        == 409
    )
    assert (
        client.put(
            f"{path}/tests/{old_test['id']}",
            headers=researcher_headers,
            json={"configuration": configuration()},
        ).status_code
        == 409
    )
    draft = client.post(f"{path}/drafts", headers=researcher_headers).json()
    new_tests = client.get(
        f"{path}/versions/{draft['id']}/tests", headers=researcher_headers
    ).json()
    assert new_tests[0]["id"] != old_test["id"]
    replaced = client.put(
        f"{path}/tests/{new_tests[0]['id']}",
        headers=researcher_headers,
        json={"configuration": configuration(instructions="New instruction")},
    )
    assert replaced.status_code == 200
    second = client.post(f"{path}/publish", headers=researcher_headers).json()
    assert second["version_number"] == 2
    assigned = client.get(f"/sessions/{session['id']}/test", headers=headers).json()
    assert assigned["tests"][0]["configuration"]["instructions"] == "Taste and rate the sample."
    assert assigned["study_version"]["id"] == old_version["id"]
    with pytest.raises(IntegrityError), client.app.state.engine.begin() as connection:
        connection.execute(
            text("UPDATE study_tests SET configuration='{}' WHERE id=:id"), {"id": old_test["id"]}
        )
    with pytest.raises(IntegrityError), client.app.state.engine.begin() as connection:
        connection.execute(
            text("UPDATE study_versions SET title='mutated' WHERE id=:id"),
            {"id": old_version["id"]},
        )


def test_version_and_question_validation_is_atomic(client, researcher_headers):
    data, test, version = study(client, researcher_headers)
    _, other_test, _ = study(client, researcher_headers)
    session, headers = provision(client, researcher_headers, version)
    original = event(test)
    assert submit(client, session, headers, [original, event(other_test)]).status_code == 422
    assert client.get(f"/studies/{data['id']}/responses", headers=researcher_headers).json() == []
    assert (
        submit(client, session, headers, [event(test, question_id="invented")]).status_code == 422
    )
    assert (
        submit(
            client, session, headers, [event(test, value={"state": "rated", "rating": 0})]
        ).status_code
        == 422
    )
    assert submit(client, session, headers, [original]).status_code == 200
    changed = {**original, "value": {"state": "rated", "rating": 8}}
    assert submit(client, session, headers, [changed]).status_code == 409


def test_authentication_and_session_scope(client, researcher_headers):
    assert client.post("/studies", json={"title": "Denied"}).status_code == 401
    assert client.get("/test-types").status_code == 401
    _, test, version = study(client, researcher_headers)
    session, headers = provision(client, researcher_headers, version)
    other, other_headers = provision(client, researcher_headers, version)
    assert client.get(f"/sessions/{session['id']}/test", headers=other_headers).status_code == 401
    assert (
        client.get(f"/sessions/{session['id']}/test", headers=researcher_headers).status_code == 401
    )
    assert client.post("/studies", headers=headers, json={"title": "Denied"}).status_code == 401
    saved = event(test)
    assert submit(client, session, headers, [saved]).status_code == 200
    assert submit(client, other, other_headers, [saved]).status_code == 409
    with client.app.state.engine.connect() as connection:
        stored = connection.scalar(
            text("SELECT token_hash FROM sessions WHERE id=:id"), {"id": session["id"]}
        )
        assert stored != session["session_token"]


def test_corrections_preserve_history_and_skip_semantics(client, researcher_headers):
    data, test, version = study(
        client,
        researcher_headers,
        allow_skips=True,
        questions=[
            {"id": "overall", "prompt": "Overall?"},
            {"id": "aroma", "prompt": "Aroma?", "required": False},
        ],
    )
    session, headers = provision(client, researcher_headers, version)
    assert client.post(f"/sessions/{session['id']}/complete", headers=headers).status_code == 422
    skipped = event(test, value={"state": "skipped"})
    assert submit(client, session, headers, [skipped]).status_code == 200
    correction = event(test, supersedes_event_id=skipped["client_event_id"])
    assert submit(client, session, headers, [correction]).status_code == 200
    assert submit(client, session, headers, [event(test)]).status_code == 409
    stale = event(test, supersedes_event_id=skipped["client_event_id"])
    assert submit(client, session, headers, [stale]).status_code == 409
    rows = client.get(f"/studies/{data['id']}/responses", headers=researcher_headers).json()
    assert len(rows) == 2
    assert rows[0]["value"] == {"state": "skipped", "rating": None}
    assert not rows[0]["is_current"] and rows[1]["is_current"]
    assert rows[1]["supersedes_event_id"] == skipped["client_event_id"]
    assert all(row["question_id"] != "aroma" for row in rows)  # Missing has no event.
    exported = client.get(f"/studies/{data['id']}/export", headers=researcher_headers)
    records = list(csv.DictReader(io.StringIO(exported.text)))
    assert json.loads(records[0]["value_json"]) == {"state": "skipped", "rating": None}
    assert client.post(f"/sessions/{session['id']}/complete", headers=headers).status_code == 200


def test_retry_after_server_restart(client, researcher_headers, database_url):
    data, test, version = study(client, researcher_headers)
    session, headers = provision(client, researcher_headers, version)
    queued = event(test)
    assert submit(client, session, headers, [queued]).status_code == 200
    # Represents a client that did not receive the acknowledgement. Reopen the same database.
    settings = Settings(database_url=database_url, researcher_token=RESEARCHER_TOKEN)
    with TestClient(create_app(settings)) as reopened:
        assert (
            submit(reopened, session, headers, [queued]).json()["events"][0]["status"]
            == "duplicate"
        )
        assert (
            len(reopened.get(f"/studies/{data['id']}/responses", headers=researcher_headers).json())
            == 1
        )


def test_concurrent_retries_create_one_observation(client, researcher_headers):
    data, test, version = study(client, researcher_headers)
    session, headers = provision(client, researcher_headers, version)
    queued = event(test)
    with ThreadPoolExecutor(max_workers=2) as pool:
        replies = list(pool.map(lambda _: submit(client, session, headers, [queued]), range(2)))
    assert all(reply.status_code == 200 for reply in replies)
    assert {reply.json()["events"][0]["status"] for reply in replies} == {"accepted", "duplicate"}
    assert (
        len(client.get(f"/studies/{data['id']}/responses", headers=researcher_headers).json()) == 1
    )


def test_draft_and_configuration_rejections(client, researcher_headers):
    data = client.post("/studies", headers=researcher_headers, json={"title": "Empty"}).json()
    path = f"/studies/{data['id']}"
    assert client.post(f"{path}/publish", headers=researcher_headers).status_code == 422
    assert client.post(f"{path}/drafts", headers=researcher_headers).status_code == 409
    assert (
        client.post(
            "/sessions",
            headers=researcher_headers,
            json={"study_version_id": data["versions"][0]["id"], "assessor_code": "A"},
        ).status_code
        == 422
    )
    assert (
        client.post(
            f"{path}/tests",
            headers=researcher_headers,
            json={"configuration": configuration(questions=[])},
        ).status_code
        == 422
    )
    assert (
        client.post(
            f"{path}/tests",
            headers=researcher_headers,
            json={"test_type_id": "invented", "configuration": configuration()},
        ).status_code
        == 422
    )


def test_skipping_requires_researcher_configuration(client, researcher_headers):
    _, test, version = study(client, researcher_headers)
    session, headers = provision(client, researcher_headers, version)
    assert (
        submit(client, session, headers, [event(test, value={"state": "skipped"})]).status_code
        == 422
    )


def test_sqlite_pragmas(client):
    with client.app.state.engine.connect() as connection:
        assert connection.scalar(text("PRAGMA foreign_keys")) == 1
        assert connection.scalar(text("PRAGMA journal_mode")) == "wal"
        assert connection.scalar(text("PRAGMA busy_timeout")) == 5000


def test_openapi_separates_credentials(client):
    schema = client.get("/openapi.json").json()
    assert schema["paths"]["/studies"]["post"]["security"] == [{"ResearcherToken": []}]
    assert schema["paths"]["/sessions/{session_id}/responses"]["post"]["security"] == [
        {"SessionToken": []}
    ]


def test_failed_commit_has_no_acknowledgement_or_observation(client, researcher_headers):
    data, test, version = study(client, researcher_headers)
    session, headers = provision(client, researcher_headers, version)
    queued = event(test)

    def unavailable_commit(_session):
        raise OperationalError("COMMIT", {}, sqlite3.OperationalError("database is locked"))

    sqlalchemy_event.listen(Session, "before_commit", unavailable_commit)
    try:
        result = submit(client, session, headers, [queued])
    finally:
        sqlalchemy_event.remove(Session, "before_commit", unavailable_commit)
    assert result.status_code == 503
    assert result.headers["Retry-After"] == "1"
    assert "events" not in result.json()
    assert client.get(f"/studies/{data['id']}/responses", headers=researcher_headers).json() == []
    assert submit(client, session, headers, [queued]).json()["events"][0]["status"] == "accepted"


def test_same_event_twice_in_one_batch(client, researcher_headers):
    data, test, version = study(client, researcher_headers)
    session, headers = provision(client, researcher_headers, version)
    original = event(test)
    result = submit(client, session, headers, [original, original])
    assert result.status_code == 200
    assert [ack["status"] for ack in result.json()["events"]] == ["accepted", "duplicate"]
    assert (
        len(client.get(f"/studies/{data['id']}/responses", headers=researcher_headers).json()) == 1
    )


def test_invalid_correction_rolls_back_earlier_batch_event(client, researcher_headers):
    data, test, version = study(client, researcher_headers)
    session, headers = provision(client, researcher_headers, version)
    original = event(test)
    correction = event(test, supersedes_event_id=str(uuid4()))
    assert submit(client, session, headers, [original, correction]).status_code == 409
    assert client.get(f"/studies/{data['id']}/responses", headers=researcher_headers).json() == []


def test_another_revision_in_same_study_is_rejected(client, researcher_headers):
    data, _, version = study(client, researcher_headers)
    session, headers = provision(client, researcher_headers, version)
    draft = client.post(f"/studies/{data['id']}/drafts", headers=researcher_headers).json()
    new_test = client.get(
        f"/studies/{data['id']}/versions/{draft['id']}/tests", headers=researcher_headers
    ).json()[0]
    client.post(f"/studies/{data['id']}/publish", headers=researcher_headers)
    assert submit(client, session, headers, [event(new_test)]).status_code == 422


def test_append_only_history_and_database_version_guard(client, researcher_headers):
    _, test, version = study(client, researcher_headers)
    _, other_test, _ = study(client, researcher_headers)
    session, headers = provision(client, researcher_headers, version)
    original = event(test)
    result = submit(client, session, headers, [original])
    response_id = result.json()["events"][0]["response_id"]
    engine = client.app.state.engine
    with pytest.raises(IntegrityError), engine.begin() as connection:
        connection.execute(text("DELETE FROM responses WHERE id=:id"), {"id": response_id})
    with pytest.raises(IntegrityError), engine.begin() as connection:
        connection.execute(
            text("UPDATE responses SET question_id='changed' WHERE id=:id"), {"id": response_id}
        )
    with pytest.raises(IntegrityError), engine.begin() as connection:
        connection.execute(
            text("""INSERT INTO responses
            (id, session_id, study_test_id, question_id, value,
             recorded_at, received_at, client_event_id)
            VALUES (:id, :session, :test, 'overall', '{}', :time, :time, :event)"""),
            {
                "id": str(uuid4()),
                "session": session["id"],
                "test": other_test["id"],
                "time": original["recorded_at"],
                "event": str(uuid4()),
            },
        )


def test_repeated_method_instances_have_distinct_context(client, researcher_headers):
    data = client.post("/studies", headers=researcher_headers, json={"title": "Repeat"}).json()
    configured = []
    for _ in range(2):
        configured.append(
            client.post(
                f"/studies/{data['id']}/tests",
                headers=researcher_headers,
                json={"configuration": configuration()},
            ).json()
        )
    version = client.post(f"/studies/{data['id']}/publish", headers=researcher_headers).json()
    session, headers = provision(client, researcher_headers, version)
    assert session["presentation_order"] == [test["id"] for test in configured]
    assert submit(client, session, headers, [event(test) for test in configured]).status_code == 200
    rows = client.get(f"/studies/{data['id']}/responses", headers=researcher_headers).json()
    assert {row["study_test_id"] for row in rows} == {test["id"] for test in configured}
    assert all(row["is_current"] for row in rows)


def test_timezone_equivalent_retry_and_unsupported_sample(client, researcher_headers):
    _, test, version = study(client, researcher_headers)
    session, headers = provision(client, researcher_headers, version)
    original = event(test, recorded_at="2026-10-08T10:30:00+02:00")
    assert submit(client, session, headers, [original]).status_code == 200
    retry = {**original, "recorded_at": "2026-10-08T08:30:00Z"}
    assert submit(client, session, headers, [retry]).json()["events"][0]["status"] == "duplicate"
    assert submit(client, session, headers, [event(test, sample_id="123")]).status_code == 422
    assert (
        submit(
            client, session, headers, [event(test, recorded_at="2026-10-08T08:30:00")]
        ).status_code
        == 422
    )
