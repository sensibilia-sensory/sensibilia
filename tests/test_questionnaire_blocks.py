"""Reviewed batteries use the existing form, causal ledger and template contracts."""

import csv
import io
import json
from copy import deepcopy
from uuid import uuid4

import pytest
from test_flow_foundation import configured
from test_flow_guards import node
from test_offline_execution import NOW, path
from test_templates import publish


def battery(client, h):
    study, version, _, flow, base = configured(client, h)
    matrix = node(
        "matrix_question",
        {
            "instructions": {"en": "Synthetic frequency fixture; not a validated instrument"},
            "rows": [
                {
                    "id": f"item_{i + 1}",
                    "prompt": {"en": f"Fixture item {i + 1}"},
                    "required": False,
                }
                for i in range(17)
            ],
            "options": [
                {"id": "never", "label": {"en": "Never"}, "score": 0},
                {"id": "often", "label": {"en": "Often"}, "score": 1},
            ],
            "allow_skip": True,
        },
    )
    flow["nodes"].insert(0, matrix)
    response = client.put(
        base + "/form", headers=h, json={"form": flow, "revision_hash": version["revision_hash"]}
    )
    assert response.status_code == 200, response.text
    return study, response.json(), flow, base, matrix


def test_reviewed_template_form_auth_ids_and_frozen_source(client, researcher_headers):
    h = researcher_headers
    study, version, flow, base, matrix = battery(client, h)
    frozen = publish(client, h, study, version)
    template = client.post(
        "/study-templates",
        headers=h,
        json={
            "source_version_id": version["id"],
            "name": "Fixture battery",
            "review_notes": "Synthetic; review each use",
        },
    ).json()
    url = f"/study-templates/{template['id']}/form"
    assert client.get(url).status_code == 401
    assert client.get("/study-templates/not-a-uuid/form", headers=h).status_code == 422
    assert client.get(f"/study-templates/{uuid4()}/form", headers=h).status_code == 404
    source = client.get(url, headers=h)
    assert source.status_code == 200, source.text
    assert source.json() == frozen["form"]
    duplicate = client.post(
        "/studies/duplicate",
        headers=h,
        json={
            "source_version_id": version["id"],
            "title": "Battery copy",
            "reviewed_content": True,
        },
    ).json()
    copied = duplicate["versions"][0]["form"]["nodes"][0]
    assert copied["id"] == matrix["id"]
    assert copied["data"] == frozen["form"]["nodes"][0]["data"]
    assert (
        client.put(
            base + "/form",
            headers=h,
            json={"form": flow, "revision_hash": version["revision_hash"]},
        ).status_code
        == 409
    )
    assert client.get(url, headers=h).json() == source.json()
    assert client.get(base, headers=h).json() == frozen
    from test_method_library import make_study

    _, _, legacy, _ = make_study(client, h, "cata", routed=True)
    legacy_template = client.post(
        "/study-templates",
        headers=h,
        json={
            "source_version_id": legacy["id"],
            "name": "Legacy questionnaire",
            "review_notes": "Retain v1 whole-study behavior",
        },
    ).json()
    assert (
        client.get(f"/study-templates/{legacy_template['id']}/form", headers=h).status_code == 422
    )


@pytest.mark.parametrize(
    "invalid", ["duplicate_row", "duplicate_option", "boolean_score", "missing_translation"]
)
def test_battery_validation_atomic_rejection(client, researcher_headers, invalid):
    h = researcher_headers
    _, version, flow, base, matrix = battery(client, h)
    bad = deepcopy(flow)
    data = bad["nodes"][0]["data"]
    if invalid == "duplicate_row":
        data["rows"][1]["id"] = data["rows"][0]["id"]
    elif invalid == "duplicate_option":
        data["options"][1]["id"] = data["options"][0]["id"]
    elif invalid == "boolean_score":
        data["options"][0]["score"] = False
    else:
        # Incomplete reviewed translations are storable drafts, but cannot be released.
        bad["languages"].append("sv")
        response = client.put(
            base + "/form", headers=h, json={"form": bad, "revision_hash": version["revision_hash"]}
        )
        assert response.status_code == 200
        report = client.get(base + "/validation", headers=h).json()
        assert not report["valid"]
        assert any(
            i["code"] == "missing_translation" and "sv" in i["path"] for i in report["issues"]
        )
        return
    assert (
        client.put(
            base + "/form", headers=h, json={"form": bad, "revision_hash": version["revision_hash"]}
        ).status_code
        == 422
    )
    assert client.get(base, headers=h).json() == version
    assert len(matrix["data"]["rows"]) == 17


def test_battery_causal_guard_zero_skipped_missing_and_retry_export(client, researcher_headers):
    h = researcher_headers
    study, version, flow, base, matrix = battery(client, h)
    follow = node("info", {"body": {"en": "Never follow-up"}, "continue_label": {"en": "Continue"}})
    follow["guard"] = {
        "all": [
            {"variable": f"answer.{matrix['id']}.item_1", "operator": "is_defined"},
            {"variable": f"answer.{matrix['id']}.item_1", "operator": "eq", "value": "never"},
        ]
    }
    flow["nodes"].insert(1, follow)
    saved = client.put(
        base + "/form", headers=h, json={"form": flow, "revision_hash": version["revision_hash"]}
    )
    assert saved.status_code == 200, saved.text
    publish(client, h, study, saved.json())
    session = client.post(
        "/sessions", headers=h, json={"study_version_id": version["id"], "assessor_code": "BATTERY"}
    ).json()
    sh = {"Authorization": "Bearer " + session["session_token"]}
    url = f"/sessions/{session['id']}"
    assert client.get(f"/study-templates/{uuid4()}/form", headers=sh).status_code == 401
    assert (
        client.post(
            url + "/path-events", headers=sh, json={"events": [path(matrix["id"], 1, "entered")]}
        ).status_code
        == 200
    )
    event = {
        "client_event_id": str(uuid4()),
        "step_id": matrix["id"],
        "occurrence_id": "study",
        "value": {
            "state": "matrix",
            "answers": {
                "item_1": {"state": "selected", "option_id": "never"},
                "item_2": {"state": "skipped"},
            },
        },
        "recorded_at": NOW,
    }
    bad = deepcopy(event)
    bad["value"]["answers"]["foreign"] = {"state": "selected", "option_id": "never"}
    assert client.post(url + "/form-events", headers=sh, json={"events": [bad]}).status_code == 422
    assert (
        client.post(url + "/form-events", headers=sh, json={"events": [event]}).status_code == 200
    )
    assert (
        client.post(url + "/form-events", headers=sh, json={"events": [event]}).json()["events"][0][
            "status"
        ]
        == "duplicate"
    )
    stored = client.get(f"/studies/{study['id']}/form-responses", headers=h).json()[0]
    assert stored["value"]["answers"]["item_2"] == {"state": "skipped", "option_id": None}
    trail = [
        path(matrix["id"], 2, "submitted", [event["client_event_id"]]),
        path(follow["id"], 3, "entered"),
    ]
    result = client.post(url + "/path-events", headers=sh, json={"events": trail})
    assert result.status_code == 200, result.text
    rows = list(
        csv.DictReader(io.StringIO(client.get(f"/studies/{study['id']}/export", headers=h).text))
    )
    answers = [r for r in rows if r["step_id"] == matrix["id"] and r["row_kind"] == "form_answer"]
    assert len(answers) == 17
    assert [r["state"] for r in answers] == ["selected", "skipped", *(["missing"] * 15)]
    assert json.loads(answers[0]["score_json"]) == 0
    assert all(r["client_event_id"] == event["client_event_id"] for r in answers)
    assert all(r["study_version_id"] == version["id"] for r in answers)
