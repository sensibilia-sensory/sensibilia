import csv
import io
import json
from copy import deepcopy
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from test_api import event, provision, submit
from test_methods import configuration

from sensibilia.forms import StudyForm, progress


def consent():
    return {
        "id": "consent",
        "kind": "choice",
        "title": "Consent",
        "prompt": "Do you agree?",
        "options": [{"id": "yes", "label": "I agree"}, {"id": "no", "label": "I do not agree"}],
        "route": {
            "condition": {"source_step_id": "consent", "option_ids": ["yes"]},
            "then": "next",
            "otherwise": "screen_out",
        },
    }


def instructions():
    return {
        "id": "instructions",
        "kind": "instruction",
        "title": "Instructions",
        "text": "Read before continuing.",
        "acknowledgement_label": "I have read and understood.",
    }


def matrix():
    return {
        "id": "battery",
        "kind": "matrix",
        "title": "Agreement battery",
        "instructions": "Rate each statement.",
        "rows": [
            {"id": "natural", "prompt": "Contains natural ingredients"},
            {"id": "processing", "prompt": "Has minimal processing"},
            {"id": "optional", "prompt": "Optional statement", "required": False},
        ],
        "scale": [
            {"id": "disagree", "label": "Disagree", "score": 0},
            {"id": "agree", "label": "Agree", "score": 1},
        ],
        "allow_skips": True,
    }


def form_study(client, headers, with_test=True, override=None):
    data = client.post("/studies", headers=headers, json={"title": "Routed questionnaire"}).json()
    test = (
        client.post(
            f"/studies/{data['id']}/tests", headers=headers, json={"configuration": configuration()}
        ).json()
        if with_test
        else None
    )
    steps = [consent(), instructions(), matrix()]
    if test:
        steps.append(
            {
                "id": "liking",
                "kind": "test",
                "title": "Liking",
                "study_test_id": test["id"],
                "layout": "matrix",
            }
        )
    form = override or {
        "steps": steps,
        "screen_out_message": "Thank you. You will not proceed to tasting.",
    }
    result = client.put(
        f"/studies/{data['id']}/versions/{data['versions'][0]['id']}/form",
        headers=headers,
        json={"form": form},
    )
    assert result.status_code == 200, result.text
    published = client.post(f"/studies/{data['id']}/publish", headers=headers)
    assert published.status_code == 200, published.text
    return data, test, published.json()


def form_event(step_id, value, **overrides):
    return {
        "client_event_id": str(uuid4()),
        "step_id": step_id,
        "value": value,
        "recorded_at": datetime.now(UTC).isoformat(),
        **overrides,
    }


def form_submit(client, session, headers, events):
    return client.post(
        f"/sessions/{session['id']}/form-events", headers=headers, json={"events": events}
    )


def position(client, session, headers):
    return client.get(f"/sessions/{session['id']}/progress", headers=headers).json()


def test_full_routed_session_matrix_and_export(client, researcher_headers):
    data, test, version = form_study(client, researcher_headers)
    session, headers = provision(client, researcher_headers, version)
    package = client.get(f"/sessions/{session['id']}/test", headers=headers).json()
    assert package["package_schema_version"] == 2
    assert package["study_version"]["form"] == version["form"]
    assert position(client, session, headers)["current_step_id"] == "consent"
    assert submit(client, session, headers, [event(test)]).status_code == 409
    assert client.post(f"/sessions/{session['id']}/complete", headers=headers).status_code == 422
    yes = form_event("consent", {"state": "answered", "selected": ["yes"]})
    assert form_submit(client, session, headers, [yes]).status_code == 200
    assert position(client, session, headers)["current_step_id"] == "instructions"
    missing_ack = form_event("instructions", {"state": "continued", "acknowledged": False})
    assert form_submit(client, session, headers, [missing_ack]).status_code == 422
    assert (
        form_submit(
            client,
            session,
            headers,
            [form_event("instructions", {"state": "continued", "acknowledged": True})],
        ).status_code
        == 200
    )
    assert position(client, session, headers)["current_step_id"] == "battery"
    battery = form_event(
        "battery",
        {
            "state": "matrix",
            "answers": {
                "natural": {"state": "selected", "option_id": "disagree"},
                "processing": {"state": "skipped"},
            },
        },
    )
    assert form_submit(client, session, headers, [battery]).status_code == 200
    # Instructions and routing decisions cannot be changed after advancing.
    assert (
        form_submit(
            client,
            session,
            headers,
            [form_event("consent", {"state": "answered", "selected": ["no"]})],
        ).status_code
        == 409
    )
    assert position(client, session, headers)["current_step_id"] == "liking"
    assert (
        form_submit(
            client, session, headers, [form_event("liking", {"state": "continued"})]
        ).status_code
        == 422
    )
    assert submit(client, session, headers, [event(test)]).status_code == 200
    assert (
        form_submit(
            client, session, headers, [form_event("liking", {"state": "continued"})]
        ).status_code
        == 200
    )
    final = position(client, session, headers)
    assert final["outcome"] == "completed"
    assert final["visited_step_ids"] == ["consent", "instructions", "battery", "liking"]
    assert submit(client, session, headers, [event(test)]).status_code == 409
    assert (
        client.post(f"/sessions/{session['id']}/complete", headers=headers).json()["status"]
        == "completed"
    )
    assert (
        form_submit(client, session, headers, [yes, battery]).json()["events"][0]["status"]
        == "duplicate"
    )
    exported = client.get(f"/studies/{data['id']}/export", headers=researcher_headers)
    rows = list(csv.DictReader(io.StringIO(exported.text)))
    assert len(rows) == 7  # one sensory answer, consent, ack, three matrix rows, test Continue
    natural = next(row for row in rows if row["question_id"] == "natural")
    assert natural["step_id"] == "battery" and natural["block_kind"] == "matrix"
    assert json.loads(natural["score_json"]) == 0
    assert natural["option_label"] == "Disagree"
    assert json.loads(natural["value_json"]) == {"state": "selected", "option_id": "disagree"}
    optional = next(row for row in rows if row["question_id"] == "optional")
    assert json.loads(optional["value_json"]) == {"state": "missing"}
    skipped = next(row for row in rows if row["question_id"] == "processing")
    assert json.loads(skipped["value_json"]) == {"state": "skipped", "option_id": None}
    assert all(
        row["study_version_id"] == version["id"] and row["session_id"] == session["id"]
        for row in rows
    )
    sensory = next(row for row in rows if row["question_id"] == "overall")
    assert sensory["step_id"] == "liking" and sensory["method_schema_version"] == "1"


def test_consent_decline_ends_without_requiring_tasting(client, researcher_headers):
    data, test, version = form_study(client, researcher_headers)
    session, headers = provision(client, researcher_headers, version)
    no = form_event("consent", {"state": "answered", "selected": ["no"]})
    assert form_submit(client, session, headers, [no]).status_code == 200
    assert position(client, session, headers)["outcome"] == "screened_out"
    assert submit(client, session, headers, [event(test)]).status_code == 409
    assert (
        client.post(f"/sessions/{session['id']}/complete", headers=headers).json()["status"]
        == "screened_out"
    )
    assert client.post(f"/sessions/{session['id']}/complete", headers=headers).status_code == 200
    assert form_submit(client, session, headers, [no]).json()["events"][0]["status"] == "duplicate"
    assert (
        len(client.get(f"/studies/{data['id']}/form-responses", headers=researcher_headers).json())
        == 1
    )
    assert client.get(f"/studies/{data['id']}/responses", headers=researcher_headers).json() == []


def test_multi_choice_allergy_skip_and_exclusive_none(client, researcher_headers):
    allergies = {
        "kind": "choice",
        "id": "allergies",
        "title": "Restrictions",
        "prompt": "Select restrictions.",
        "multiple": True,
        "options": [
            {"id": "milk", "label": "Milk"},
            {"id": "soy", "label": "Soy"},
            {"id": "none", "label": "None", "exclusive": True},
        ],
        "route": {
            "condition": {"source_step_id": "allergies", "option_ids": ["milk", "soy"]},
            "then": "notice",
            "otherwise": "battery",
        },
    }
    notice = {
        "kind": "instruction",
        "id": "notice",
        "title": "Contact researcher",
        "text": "Please contact the researcher.",
        "route": {"otherwise": "screen_out"},
    }
    _, _, version = form_study(
        client,
        researcher_headers,
        with_test=False,
        override={"steps": [allergies, notice, matrix()]},
    )
    session, headers = provision(client, researcher_headers, version)
    for selection in (["none", "soy"], ["unknown"], ["soy", "soy"], []):
        assert (
            form_submit(
                client,
                session,
                headers,
                [form_event("allergies", {"state": "answered", "selected": selection})],
            ).status_code
            == 422
        )
    assert (
        form_submit(
            client,
            session,
            headers,
            [form_event("allergies", {"state": "answered", "selected": ["milk", "soy"]})],
        ).status_code
        == 200
    )
    assert position(client, session, headers)["current_step_id"] == "notice"
    assert (
        form_submit(
            client, session, headers, [form_event("notice", {"state": "continued"})]
        ).status_code
        == 200
    )
    assert position(client, session, headers)["outcome"] == "screened_out"
    other, other_headers = provision(client, researcher_headers, version)
    assert (
        form_submit(
            client,
            other,
            other_headers,
            [form_event("allergies", {"state": "answered", "selected": ["none"]})],
        ).status_code
        == 200
    )
    assert position(client, other, other_headers)["current_step_id"] == "battery"


@pytest.mark.parametrize(
    "answers",
    [
        {},
        {
            "natural": {"state": "selected", "option_id": "unknown"},
            "processing": {"state": "skipped"},
        },
        {
            "natural": {"state": "selected", "option_id": "disagree"},
            "processing": {"state": "skipped"},
            "unknown": {"state": "skipped"},
        },
        {"natural": {"state": "skipped", "option_id": "agree"}, "processing": {"state": "skipped"}},
    ],
)
def test_invalid_matrix_submission_is_atomic(client, researcher_headers, answers):
    data, _, version = form_study(
        client, researcher_headers, with_test=False, override={"steps": [matrix()]}
    )
    session, headers = provision(client, researcher_headers, version)
    assert (
        form_submit(
            client,
            session,
            headers,
            [form_event("battery", {"state": "matrix", "answers": answers})],
        ).status_code
        == 422
    )
    assert (
        client.get(f"/studies/{data['id']}/form-responses", headers=researcher_headers).json() == []
    )


def test_batch_rollback_retries_auth_and_event_id_collisions(client, researcher_headers):
    data, test, version = form_study(client, researcher_headers)
    session, headers = provision(client, researcher_headers, version)
    yes = form_event("consent", {"state": "answered", "selected": ["yes"]})
    invalid = form_event("battery", {"state": "matrix", "answers": {}})
    assert form_submit(client, session, headers, [yes, invalid]).status_code == 409
    assert position(client, session, headers)["current_step_id"] == "consent"
    assert form_submit(client, session, researcher_headers, [yes]).status_code == 401
    assert client.get(f"/studies/{data['id']}/form-responses", headers=headers).status_code == 401
    assert form_submit(client, session, headers, [yes]).status_code == 200
    assert (
        form_submit(client, session, headers, [yes, yes]).json()["events"][0]["status"]
        == "duplicate"
    )
    altered = deepcopy(yes)
    altered["value"]["selected"] = ["no"]
    assert form_submit(client, session, headers, [altered]).status_code == 409
    collision = event(test, client_event_id=yes["client_event_id"])
    assert submit(client, session, headers, [collision]).status_code == 409
    other, other_headers = provision(client, researcher_headers, version)
    assert form_submit(client, other, other_headers, [yes]).status_code == 409


def test_published_forms_clone_references_and_database_guards(client, researcher_headers):
    data, test, version = form_study(client, researcher_headers)
    session, headers = provision(client, researcher_headers, version)
    base = f"/studies/{data['id']}"
    assert (
        client.put(
            f"{base}/versions/{version['id']}/form", headers=researcher_headers, json={"form": None}
        ).status_code
        == 409
    )
    cloned = client.post(f"{base}/drafts", headers=researcher_headers).json()
    cloned_test = next(step for step in cloned["form"]["steps"] if step["kind"] == "test")
    assert cloned_test["study_test_id"] != test["id"]
    old = client.get(f"/sessions/{session['id']}/test", headers=headers).json()["study_version"][
        "form"
    ]
    assert old == version["form"]
    assert (
        client.delete(
            f"{base}/tests/{cloned_test['study_test_id']}", headers=researcher_headers
        ).status_code
        == 409
    )
    with client.app.state.engine.begin() as connection:
        with pytest.raises(IntegrityError, match="immutable"):
            connection.execute(
                text("UPDATE study_versions SET form=NULL WHERE id=:id"), {"id": version["id"]}
            )
        with pytest.raises(IntegrityError, match="Block does not belong"):
            connection.execute(
                text(
                    "INSERT INTO form_events (id, session_id, step_id, value, recorded_at, "
                    "received_at, client_event_id) "
                    "VALUES (:id,:session,'bogus','{}','now','now',:event)"
                ),
                {"id": str(uuid4()), "session": session["id"], "event": str(uuid4())},
            )
    accepted = form_event("consent", {"state": "answered", "selected": ["yes"]})
    assert form_submit(client, session, headers, [accepted]).status_code == 200
    with client.app.state.engine.begin() as connection:
        with pytest.raises(IntegrityError, match="append-only"):
            connection.execute(
                text("DELETE FROM form_events WHERE session_id=:id"), {"id": session["id"]}
            )


@pytest.mark.parametrize(
    "modify",
    [
        lambda form: form["steps"][0].update(id="next"),
        lambda form: form["steps"][1].update(id="consent"),
        lambda form: form["steps"][0]["route"].update(then="bogus"),
        lambda form: form["steps"][1].update(route={"otherwise": "consent"}),
        lambda form: form["steps"][0]["route"]["condition"].update(option_ids=["bogus"]),
        lambda form: form["steps"][0]["route"]["condition"].update(source_step_id="instructions"),
        lambda form: form["steps"][0]["route"]["condition"].update(
            match="all", option_ids=["yes", "no"]
        ),
        lambda form: form["steps"][0].update(route={"otherwise": "complete"}),
    ],
)
def test_invalid_routes_rejected(modify):
    form = {"steps": [consent(), instructions(), matrix()]}
    modify(form)
    with pytest.raises(ValidationError):
        StudyForm.model_validate(form)


def test_route_cannot_depend_on_skipped_choice():
    first = consent()
    second = {**consent(), "id": "second", "route": {}}
    first["route"]["then"] = "battery"
    first["route"]["otherwise"] = "second"
    battery = matrix()
    battery["route"] = {
        "condition": {"source_step_id": "second", "option_ids": ["yes"]},
        "then": "complete",
        "otherwise": "screen_out",
    }
    with pytest.raises(ValidationError, match="may have been skipped"):
        StudyForm.model_validate({"steps": [first, second, battery]})


def test_pure_route_evaluation_and_unanswered_is_not_no():
    form = StudyForm.model_validate({"steps": [consent(), instructions()]})
    assert progress(form, {}) == ("consent", None, [])
    assert progress(form, {"consent": {"selected": ["no"]}}) == (None, "screened_out", ["consent"])
    assert progress(form, {"consent": {"selected": ["yes"]}}) == ("instructions", None, ["consent"])


def test_skipped_required_sensory_test_does_not_block_completion(client, researcher_headers):
    data = client.post("/studies", headers=researcher_headers, json={"title": "Skip route"}).json()
    test = client.post(
        f"/studies/{data['id']}/tests",
        headers=researcher_headers,
        json={"configuration": configuration()},
    ).json()
    first = consent()
    first["route"]["otherwise"] = "instructions"
    form = {
        "steps": [
            first,
            {"kind": "test", "id": "liking", "title": "Liking", "study_test_id": test["id"]},
            instructions(),
        ]
    }
    path = f"/studies/{data['id']}/versions/{data['versions'][0]['id']}/form"
    assert client.put(path, headers=researcher_headers, json={"form": form}).status_code == 200
    version = client.post(f"/studies/{data['id']}/publish", headers=researcher_headers).json()
    session, headers = provision(client, researcher_headers, version)
    events = [
        form_event("consent", {"state": "answered", "selected": ["no"]}),
        form_event("instructions", {"state": "continued", "acknowledged": True}),
    ]
    assert form_submit(client, session, headers, events).status_code == 200
    assert (
        client.post(f"/sessions/{session['id']}/complete", headers=headers).json()["status"]
        == "completed"
    )
    assert client.get(f"/studies/{data['id']}/responses", headers=researcher_headers).json() == []


def test_form_test_references_and_publish_coverage(client, researcher_headers):
    data = client.post("/studies", headers=researcher_headers, json={"title": "Coverage"}).json()
    client.post(
        f"/studies/{data['id']}/tests",
        headers=researcher_headers,
        json={"configuration": configuration()},
    )
    path = f"/studies/{data['id']}/versions/{data['versions'][0]['id']}/form"
    bad = {
        "steps": [
            {
                "kind": "test",
                "id": "outside",
                "title": "Foreign test",
                "study_test_id": str(uuid4()),
            }
        ]
    }
    assert client.put(path, headers=researcher_headers, json={"form": bad}).status_code == 422
    assert (
        client.put(
            path, headers=researcher_headers, json={"form": {"steps": [instructions()]}}
        ).status_code
        == 200
    )
    assert (
        client.post(f"/studies/{data['id']}/publish", headers=researcher_headers).status_code == 422
    )
    # Explicitly removing the form retains the legacy contract for that draft.
    assert client.put(path, headers=researcher_headers, json={"form": None}).status_code == 200
    assert (
        client.post(f"/studies/{data['id']}/publish", headers=researcher_headers).status_code == 200
    )


def test_form_acknowledgement_only_after_commit(client, researcher_headers, monkeypatch):
    from sqlalchemy.exc import OperationalError
    from sqlalchemy.orm import Session

    data, _, version = form_study(client, researcher_headers, with_test=False)
    session, headers = provision(client, researcher_headers, version)
    yes = form_event("consent", {"state": "answered", "selected": ["yes"]})
    original = Session.commit
    monkeypatch.setattr(
        Session,
        "commit",
        lambda self: (_ for _ in ()).throw(
            OperationalError("COMMIT", {}, Exception("database is locked"))
        ),
    )
    assert form_submit(client, session, headers, [yes]).status_code == 503
    monkeypatch.setattr(Session, "commit", original)
    assert (
        client.get(f"/studies/{data['id']}/form-responses", headers=researcher_headers).json() == []
    )
    assert form_submit(client, session, headers, [yes]).json()["events"][0]["status"] == "accepted"


@pytest.mark.parametrize(
    "change",
    [
        lambda block: block.update(scale=[{"id": "only", "label": "Only one"}]),
        lambda block: block["scale"][1].update(id="disagree"),
        lambda block: block["scale"][0].update(label="   "),
        lambda block: block["scale"][0].update(score=True),
        lambda block: block["rows"][1].update(id="natural"),
        lambda block: block["rows"][0].update(prompt="   "),
        lambda block: block["scale"][0].update(score=1.5),
    ],
)
def test_matrix_configuration_validation(change):
    block = matrix()
    change(block)
    with pytest.raises(ValidationError):
        StudyForm.model_validate({"steps": [block]})


def test_form_contract_snapshot_matches():
    from pathlib import Path

    snapshot = Path(__file__).resolve().parents[1] / "docs/contracts/form_v1.json"
    assert json.loads(snapshot.read_text(encoding="utf-8")) == StudyForm.model_json_schema()
