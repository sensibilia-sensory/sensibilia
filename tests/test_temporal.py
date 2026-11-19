"""Temporal acquisition states, causality, frozen schemas and lossless export."""

import csv
import io
import json
from copy import deepcopy
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from test_flow_guards import node
from test_offline_execution import path

from sensibilia.methods import TCATAConfiguration
from sensibilia.temporal import TemporalValue, validate_trace

CONFIG = dict(
    kind="tcata",
    instructions="Track applicable attributes.",
    sample_ids=[],
    attributes=[dict(id="sweet", prompt="Sweet"), dict(id="bitter", prompt="Bitter")],
    start_instruction="Taste on Start.",
    duration_ms=1000,
    required_tolerance_ms=50,
    allow_skips=True,
)
NOW = "2026-10-14T12:00:00+00:00"
END = "2026-10-14T12:00:01+00:00"


def trace(state="complete"):
    return dict(
        state=state,
        started_at=NOW,
        ended_at=END,
        elapsed_ms=1000,
        clock_resolution_ms=0.1,
        interruption_flags=[],
        transitions=[
            dict(
                client_event_id=str(uuid4()),
                seq=1,
                elapsed_ms=0,
                attribute_id="sweet",
                selected=True,
                recorded_at=NOW,
            ),
            dict(
                client_event_id=str(uuid4()),
                seq=2,
                elapsed_ms=0,
                attribute_id="bitter",
                selected=True,
                recorded_at=NOW,
            ),
            dict(
                client_event_id=str(uuid4()),
                seq=3,
                elapsed_ms=500,
                attribute_id="sweet",
                selected=False,
                recorded_at=END,
            ),
        ],
    )


def setup(client, h):
    study = client.post("/studies", headers=h, json={"title": "Temporal"}).json()
    version = study["versions"][0]
    base = f"/studies/{study['id']}/versions/{version['id']}"
    test = client.post(
        f"/studies/{study['id']}/tests",
        headers=h,
        json={"test_type_id": "tcata-v1", "configuration": CONFIG},
    ).json()
    embedded = node("embedded_method", {"study_test_id": test["id"], "sample_binding": "none"})
    end = node("end", {"body": {"en": "Finished"}, "outcome": "completed"})
    form = dict(schema_version=2, languages=["en"], default_language="en", nodes=[embedded, end])
    revision = client.get(base, headers=h).json()["revision_hash"]
    assert (
        client.put(
            base + "/form", headers=h, json={"form": form, "revision_hash": revision}
        ).status_code
        == 200
    )
    report = client.get(base + "/validation", headers=h).json()
    assert report["valid"], report
    assert (
        client.post(
            f"/studies/{study['id']}/publish",
            headers=h,
            json={"study_version_id": version["id"], "revision_hash": report["revision_hash"]},
        ).status_code
        == 200
    )
    session = client.post(
        "/sessions", headers=h, json={"study_version_id": version["id"], "assessor_code": "T"}
    ).json()
    token = {"Authorization": "Bearer " + session["session_token"]}
    url = f"/sessions/{session['id']}"
    assert (
        client.post(
            url + "/path-events",
            headers=token,
            json={"events": [path(embedded["id"], 1, "entered")]},
        ).status_code
        == 200
    )
    return study, version, test, embedded, end, url, token


@pytest.mark.parametrize("state", ["complete", "interrupted", "skipped"])
def test_temporal_collection_retry_export_and_lock(client, researcher_headers, state):
    h = researcher_headers
    study, version, test, embedded, end, url, token = setup(client, h)
    value = trace(state)
    if state == "interrupted":
        value.update(interruption_flags=["reload"])
    if state == "skipped":
        value.update(started_at=None, elapsed_ms=0, transitions=[])
    event = dict(
        client_event_id=str(uuid4()),
        study_test_id=test["id"],
        step_id=embedded["id"],
        occurrence_id="study",
        sample_id=None,
        value=value,
        recorded_at=END,
    )
    assert client.get(url + "/test", headers=token).json()["evaluator_version"] == "temporal-v2.9"
    assert client.post(url + "/temporal-runs", json={"events": [event]}).status_code == 401
    invalid = deepcopy(event)
    invalid["occurrence_id"] = "foreign"
    assert (
        client.post(url + "/temporal-runs", headers=token, json={"events": [invalid]}).status_code
        == 409
    )
    invalid = deepcopy(event)
    invalid["study_test_id"] = str(uuid4())
    assert (
        client.post(url + "/temporal-runs", headers=token, json={"events": [invalid]}).status_code
        == 422
    )
    result = client.post(url + "/temporal-runs", headers=token, json={"events": [event]})
    assert result.status_code == 200, result.text
    assert (
        client.post(url + "/temporal-runs", headers=token, json={"events": [event]}).json()[
            "events"
        ][0]["status"]
        == "duplicate"
    )
    if value["transitions"]:
        reused = value["transitions"][0]["client_event_id"]
        collision = dict(event, client_event_id=reused)
        assert (
            client.post(
                url + "/temporal-runs", headers=token, json={"events": [collision]}
            ).status_code
            == 409
        )
        collided_path = path(embedded["id"], 2, "submitted", [event["client_event_id"]])
        collided_path["client_event_id"] = reused
        assert (
            client.post(
                url + "/path-events", headers=token, json={"events": [collided_path]}
            ).status_code
            == 409
        )
    changed = deepcopy(event)
    changed["value"]["clock_resolution_ms"] = 2
    assert (
        client.post(url + "/temporal-runs", headers=token, json={"events": [changed]}).status_code
        == 409
    )
    changed["client_event_id"] = str(uuid4())
    assert (
        client.post(url + "/temporal-runs", headers=token, json={"events": [changed]}).status_code
        == 409
    )
    events = [
        path(embedded["id"], 2, "submitted", [event["client_event_id"]]),
        path(end["id"], 3, "entered"),
        path(end["id"], 4, "ended"),
    ]
    assert (
        client.post(url + "/path-events", headers=token, json={"events": events}).status_code == 200
    )
    assert client.post(url + "/complete", headers=token).status_code == 200
    assert (
        client.post(url + "/temporal-runs", headers=token, json={"events": [event]}).status_code
        == 200
    )
    rows = list(
        csv.DictReader(io.StringIO(client.get(f"/studies/{study['id']}/export", headers=h).text))
    )
    runs = [r for r in rows if r["row_kind"] == "temporal_run"]
    assert len(runs) == 1 and json.loads(runs[0]["value_json"]) == TemporalValue.model_validate(
        value
    ).model_dump(mode="json")
    transitions = [r for r in rows if r["row_kind"] == "temporal_transition"]
    assert len(transitions) == len(value["transitions"])
    assert not any(r["row_kind"] == "expected_missing" for r in rows)
    if transitions:
        assert (
            transitions[0]["temporal_elapsed_milliseconds"] == "0"
            and transitions[-1]["state"] == "unselected"
        )
        assert [int(r["temporal_seq"]) for r in transitions] == [1, 2, 3]
    with pytest.raises(IntegrityError), client.app.state.engine.begin() as db:
        db.execute(text("UPDATE temporal_runs SET occurrence_id='changed'"))
    assert (
        client.put(
            f"/studies/{study['id']}/tests/{test['id']}",
            headers=h,
            json={"test_type_id": "tcata-v1", "configuration": CONFIG},
        ).status_code
        == 409
    )


@pytest.mark.parametrize(
    "change",
    ["sequence", "elapsed", "foreign", "redundant", "id", "duration", "flags", "utc", "boolean"],
)
def test_invalid_temporal_trace(change):
    value = trace()
    if change == "sequence":
        value["transitions"][1]["seq"] = 4
    if change == "elapsed":
        value["transitions"][2]["elapsed_ms"] = -1
    if change == "foreign":
        value["transitions"][0]["attribute_id"] = "unknown"
    if change == "redundant":
        value["transitions"][2]["selected"] = True
    if change == "id":
        value["transitions"][1]["client_event_id"] = value["transitions"][0]["client_event_id"]
    if change == "duration":
        value["elapsed_ms"] = 999
    if change == "flags":
        value["interruption_flags"] = ["hidden"]
    if change == "utc":
        value["ended_at"] = "2026-10-14T11:00:00+00:00"
    if change == "boolean":
        value["transitions"][0]["selected"] = 1
    with pytest.raises(ValueError):
        validate_trace(
            TCATAConfiguration.model_validate(CONFIG), TemporalValue.model_validate(value)
        )


@pytest.mark.parametrize("change", ["duplicates", "duration", "single_active"])
def test_invalid_temporal_configuration(change):
    config = deepcopy(CONFIG)
    if change == "duplicates":
        config["attributes"][1]["id"] = "sweet"
    if change == "duration":
        config["duration_ms"] = True
    if change == "single_active":
        config["multi_active"] = False
    with pytest.raises(ValueError):
        TCATAConfiguration.model_validate(config)


def test_temporal_batch_rollback_and_missing(client, researcher_headers):
    study, version, test, embedded, end, url, token = setup(client, researcher_headers)
    event = dict(
        client_event_id=str(uuid4()),
        study_test_id=test["id"],
        step_id=embedded["id"],
        occurrence_id="study",
        value=trace(),
        recorded_at=END,
    )
    bad = deepcopy(event)
    bad["client_event_id"] = str(uuid4())
    bad["value"]["transitions"][0]["attribute_id"] = "unknown"
    assert (
        client.post(
            url + "/temporal-runs", headers=token, json={"events": [event, bad]}
        ).status_code
        == 409
    )
    with client.app.state.engine.connect() as db:
        assert db.scalar(text("SELECT count(*) FROM temporal_runs")) == 0
    rows = client.get(f"/studies/{study['id']}/data", headers=researcher_headers).json()
    assert any(r["row_kind"] == "expected_missing" and r["question_id"] == "temporal" for r in rows)


@pytest.mark.parametrize("case", ["inactive", "clock_gap", "skip_policy", "resolution"])
def test_temporal_quality_and_initial_inactivity(case):
    config = TCATAConfiguration.model_validate(CONFIG)
    value = trace()
    if case == "inactive":
        value["transitions"] = []
        value["clock_resolution_ms"] = None
        value["started_at"] = "2026-10-14T12:00:00.123456Z"
        parsed = TemporalValue.model_validate(value)
        validate_trace(config, parsed)
        assert parsed.model_dump(mode="json")["started_at"].endswith(".123456Z")
    elif case == "clock_gap":
        value.update(
            state="interrupted", interruption_flags=["clock_gap"], ended_at="2026-10-14T11:00:00Z"
        )
        validate_trace(config, TemporalValue.model_validate(value))
    elif case == "skip_policy":
        config.allow_skips = False
        value.update(state="skipped", started_at=None, elapsed_ms=0, transitions=[])
        with pytest.raises(ValueError):
            validate_trace(config, TemporalValue.model_validate(value))
    else:
        value["clock_resolution_ms"] = True
        with pytest.raises(ValueError):
            TemporalValue.model_validate(value)
