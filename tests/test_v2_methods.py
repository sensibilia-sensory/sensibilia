"""Registered frozen methods through the existing causal v2 collection path."""

import csv
import io
import json
from copy import deepcopy

import pytest
from test_flow_guards import node
from test_method_library import METHODS, configuration, method_id, observations
from test_offline_execution import path


def setup_method(client, h, kind, **overrides):
    study = client.post("/studies", headers=h, json={"title": kind}).json()
    version = study["versions"][0]
    base = f"/studies/{study['id']}/versions/{version['id']}"
    samples = [
        client.post(
            f"/studies/{study['id']}/samples",
            headers=h,
            json={"code": str(317 + i), "label": f"Private {i}", "ingredient_tags": []},
        ).json()
        for i in range(2)
    ]
    test = client.post(
        f"/studies/{study['id']}/tests",
        headers=h,
        json={
            "test_type_id": method_id(kind),
            "configuration": configuration(kind, [s["id"] for s in samples]) | overrides,
        },
    ).json()
    embedded = node(
        "embedded_method",
        {
            "study_test_id": test["id"],
            "sample_binding": "current" if kind in {"cata", "rata", "jar"} else "set",
        },
    )
    end = node("end", {"body": {"en": "Finished"}, "outcome": "completed"})
    nodes = (
        [node("loop_samples", {"sample_ids": [s["id"] for s in samples], "children": [embedded]})]
        if kind in {"cata", "rata", "jar"}
        else [embedded]
    )
    flow = {
        "schema_version": 2,
        "languages": ["en"],
        "default_language": "en",
        "nodes": [*nodes, end],
    }
    revision = client.get(base, headers=h).json()["revision_hash"]
    saved = client.put(base + "/form", headers=h, json={"form": flow, "revision_hash": revision})
    assert saved.status_code == 200, saved.text
    return study, version, base, samples, test, flow, embedded, end


@pytest.mark.parametrize(
    "kind,state",
    [(kind, None) for kind in METHODS]
    + [("rata", state) for state in ("unselected", "selected_null", "selected_zero", "skipped")],
)
def test_v2_method_causal_collection_retry_and_export(client, researcher_headers, kind, state):
    h = researcher_headers
    study, version, base, samples, test, flow, embedded, end = setup_method(
        client,
        h,
        kind,
        **({"rating_min": 0, "require_ratings": False, "allow_skips": True} if state else {}),
    )
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
        "/sessions", headers=h, json={"study_version_id": version["id"], "assessor_code": "V2"}
    ).json()
    token, url = (
        {"Authorization": "Bearer " + session["session_token"]},
        f"/sessions/{session['id']}",
    )
    package = client.get(url + "/test", headers=token).json()
    assert package["evaluator_version"] == "methods-v2.8"
    assert "correct_slot_id" not in json.dumps(package) and "Private" not in json.dumps(package)
    assert client.post(url + "/complete", headers=token).status_code == 422
    plan = client.get(url + "/serving-plan", headers=h).json()[0]
    events = observations(test, samples, plan)
    if state:
        for event in events:
            event["value"] = {
                "kind": "rata",
                "state": "selected" if state.startswith("selected") else state,
                "rating": 0 if state == "selected_zero" else None,
            }
    seq = 0

    def emit(step, kind, occurrence="study", sample=None, ids=None):
        nonlocal seq
        seq += 1
        event = path(step, seq, kind, ids, sample_id=sample)
        event["occurrence_id"] = occurrence
        response = client.post(url + "/path-events", headers=token, json={"events": [event]})
        assert response.status_code == 200, response.text

    attribute = kind in {"cata", "rata", "jar"}
    if attribute:
        assert [(s["sample_id"], s["code"]) for s in plan["samples"]] == [
            (s["sample_id"], s["code"]) for s in package["loop_assignments"][0]["samples"]
        ]
    if attribute:
        emit(flow["nodes"][0]["id"], "entered")
    for e in events:
        occurrence = flow["nodes"][0]["id"] + ":" + e["sample_id"] if attribute else "study"
        emit(embedded["id"], "entered", occurrence, e.get("sample_id"))
        e.update(step_id=embedded["id"], occurrence_id=occurrence)
        invalid = deepcopy(e)
        invalid["value"] = {"state": "rated", "rating": 9}
        assert (
            client.post(url + "/responses", headers=token, json={"events": [invalid]}).status_code
            == 422
        )
        invalid = deepcopy(e)
        invalid["occurrence_id"] = "foreign"
        assert (
            client.post(url + "/responses", headers=token, json={"events": [invalid]}).status_code
            == 409
        )
        response = client.post(url + "/responses", headers=token, json={"events": [e]})
        assert response.status_code == 200, response.text
        assert (
            client.post(url + "/responses", headers=token, json={"events": [e]}).json()["events"][
                0
            ]["status"]
            == "duplicate"
        )
        assert client.post(url + "/complete", headers=token).status_code == 422
        emit(embedded["id"], "submitted", occurrence, e.get("sample_id"), [e["client_event_id"]])
    emit(end["id"], "entered")
    emit(end["id"], "ended")
    assert client.post(url + "/complete", headers=token).json()["status"] == "completed"
    exported = client.get(f"/studies/{study['id']}/export", headers=h)
    rows = list(csv.DictReader(io.StringIO(exported.text)))
    method_rows = [
        r for r in rows if r["client_event_id"] in {e["client_event_id"] for e in events}
    ]
    assert method_rows and all(r["occurrence_id"] for r in method_rows)
    for row in method_rows:
        assert row["study_version_id"] == version["id"] and row["study_test_id"] == test["id"]
        value = json.loads(row["value_json"])
        assert value["kind"] == kind
        if state:
            assert value == events[0]["value"]
    assert client.get(url + "/test", headers=token).json()["tests"] == package["tests"]


@pytest.mark.parametrize("kind", METHODS)
def test_v2_method_wrong_binding_blocks_publication(client, researcher_headers, kind):
    _, _, base, _, _, flow, embedded, _ = setup_method(client, researcher_headers, kind)
    embedded["data"]["sample_binding"] = "none" if kind not in {"cata", "rata", "jar"} else "set"
    # Current/set scope is also checked structurally for attribute loops.
    revision = client.get(base, headers=researcher_headers).json()["revision_hash"]
    saved = client.put(
        base + "/form", headers=researcher_headers, json={"form": flow, "revision_hash": revision}
    )
    assert (
        saved.status_code == 422
        or not client.get(base + "/validation", headers=researcher_headers).json()["valid"]
    )


@pytest.mark.parametrize("rating", [None, 0])
def test_v2_rata_selected_null_zero_and_unselected(client, researcher_headers, rating):
    from sensibilia.methods import validate_observation

    _, _, _, samples, test, _, _, _ = setup_method(
        client, researcher_headers, "rata", rating_min=0, require_ratings=False, allow_skips=True
    )
    config = test["configuration"]
    values = [
        {"kind": "rata", "state": "selected", "rating": rating},
        {"kind": "rata", "state": "unselected", "rating": None},
        {"kind": "rata", "state": "skipped", "rating": None},
    ]
    assert (
        len(
            {
                json.dumps(
                    validate_observation("rata-v1", config, "sweet", samples[0]["id"], value),
                    sort_keys=True,
                )
                for value in values
            }
        )
        == 3
    )


@pytest.mark.parametrize("kind", ["triangle", "duo_trio", "flash_profile", "napping"])
def test_set_gate_uses_exact_frozen_method_slots_and_clone_reference(
    client, researcher_headers, kind
):
    from sqlalchemy.orm import Session

    from sensibilia.booths import gate_slots
    from sensibilia.flows import DraftFlowV2
    from sensibilia.models import AssessorSession

    h = researcher_headers
    study, version, base, _, test, flow, _, _ = setup_method(client, h, kind)
    gate = node(
        "serve_gate",
        {
            "body": {"en": "Verify delivered codes"},
            "preparation": {"en": "Physically verify all servings"},
            "sample_binding": "set",
            "study_test_id": test["id"],
            "sample_ids": [],
        },
    )
    flow["nodes"].insert(0, gate)
    rev = client.get(base, headers=h).json()["revision_hash"]
    assert (
        client.put(base + "/form", headers=h, json={"form": flow, "revision_hash": rev}).status_code
        == 200
    )
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
        "/sessions",
        headers=h,
        json={"study_version_id": version["id"], "assessor_code": "SET-GATE"},
    ).json()
    plan = client.get(f"/sessions/{session['id']}/serving-plan", headers=h).json()[0]
    expected = ([plan["reference"]] if plan["reference"] else []) + plan["samples"]
    with Session(client.app.state.engine) as db:
        slots = gate_slots(
            db,
            db.get(AssessorSession, session["id"]),
            DraftFlowV2.model_validate(flow).nodes[0],
            "study",
        )
        assert [(s.sample_id, s.code, s.label, s.position) for s in slots] == [
            (s["sample_id"], s["code"], s["label"], i + 1) for i, s in enumerate(expected)
        ]
    token = {"Authorization": "Bearer " + session["session_token"]}
    package = client.get(f"/sessions/{session['id']}/test", headers=token).json()
    public = package["assignments"][0]
    assert [
        s["code"]
        for s in ([public["reference"]] if public["reference"] else []) + public["samples"]
    ] == [s["code"] for s in expected]
    assert "correct_slot_id" not in json.dumps(package) and "Private" not in json.dumps(package)
    cloned = client.post(f"/studies/{study['id']}/drafts", headers=h).json()
    cloned_tests = client.get(
        f"/studies/{study['id']}/versions/{cloned['id']}/tests", headers=h
    ).json()
    assert (
        cloned["form"]["nodes"][0]["data"]["study_test_id"] == cloned_tests[0]["id"] != test["id"]
    )
    assert client.get(f"/sessions/{session['id']}/test", headers=token).json() == package
