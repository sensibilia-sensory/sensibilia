"""Slice 5 extends the existing version report/freeze/clone contract."""

from copy import deepcopy
from uuid import uuid4

import pytest
from test_flow_foundation import configured


def save(client, headers, base, flow):
    version = client.get(base, headers=headers).json()
    response = client.put(
        base + "/form",
        headers=headers,
        json={"form": flow, "revision_hash": version["revision_hash"]},
    )
    assert response.status_code == 200, response.text
    return client.get(base + "/validation", headers=headers).json()


def translate(flow, test):
    flow["languages"] = ["en", "sv"]
    for node in flow["nodes"]:
        node["title"]["sv"] = "Rubrik"
        if "body" in node["data"]:
            node["data"]["body"]["sv"] = "Tack"
    from sensibilia.flow_text import method_fields

    flow["method_text"] = {
        test["id"]: {
            p: {"en": t, "sv": t + " sv"} for p, t in method_fields(test["configuration"]).items()
        }
    }


def test_translation_report_freeze_clone_and_atomic_method_write(client, researcher_headers):
    h = researcher_headers
    study, version, test, flow, base = configured(client, h)
    translate(flow, test)
    review = save(client, h, base, flow)
    assert review["valid"], review
    changed = deepcopy(test["configuration"])
    changed["instructions"] = "Updated instructions"
    overlay = deepcopy(flow["method_text"][test["id"]])
    overlay["/instructions"] = {"en": changed["instructions"], "sv": "Nya instruktioner"}
    result = client.put(
        f"/studies/{study['id']}/tests/{test['id']}",
        headers=h,
        json={
            "configuration": changed,
            "method_text": overlay,
            "revision_hash": review["revision_hash"],
        },
    )
    assert result.status_code == 200, result.text
    assert result.json()["id"] == test["id"]  # Preserve TestRead, no wrapper.
    saved = client.get(base, headers=h).json()
    assert saved["form"]["method_text"][test["id"]] == overlay
    assert saved["revision_hash"] != review["revision_hash"]
    assert (
        client.post(
            f"/studies/{study['id']}/publish",
            headers=h,
            json={"study_version_id": version["id"], "revision_hash": review["revision_hash"]},
        ).status_code
        == 409
    )
    reviewed = client.get(base + "/validation", headers=h).json()
    assert reviewed["valid"], reviewed
    assert (
        client.post(
            f"/studies/{study['id']}/publish",
            headers=h,
            json={"study_version_id": version["id"], "revision_hash": reviewed["revision_hash"]},
        ).status_code
        == 200
    )
    session = client.post(
        "/sessions",
        headers=h,
        json={
            "study_version_id": version["id"],
            "assessor_code": "SV",
            "context": {"language": "sv"},
        },
    ).json()
    credential = {"Authorization": f"Bearer {session['session_token']}"}
    package_url = f"/sessions/{session['id']}/test"
    package = client.get(package_url, headers=credential).json()
    assert package["evaluator_version"] == "text-v2.5"
    clone = client.post(f"/studies/{study['id']}/drafts", headers=h).json()
    cloned_tests = client.get(
        f"/studies/{study['id']}/versions/{clone['id']}/tests", headers=h
    ).json()
    assert cloned_tests[0]["id"] != test["id"]
    assert clone["form"]["method_text"] == {cloned_tests[0]["id"]: overlay}
    clone["form"]["nodes"][0]["title"]["sv"] = "Ändrad"
    save(client, h, f"/studies/{study['id']}/versions/{clone['id']}", clone["form"])
    assert client.get(package_url, headers=credential).json() == package
    assert (
        client.put(
            base + "/form",
            headers=h,
            json={"form": flow, "revision_hash": reviewed["revision_hash"]},
        ).status_code
        == 409
    )


@pytest.mark.parametrize(
    "problem,code",
    [
        ("node", "missing_translation"),
        ("overlay", "missing_translation"),
        ("pointer", "invalid_pointer"),
        ("default", "default_overlay"),
        ("length", "invalid_method_translation"),
        ("unknown", "unknown_token"),
        ("scope", "token_scope"),
        ("shorthand_scope", "token_scope"),
        ("malformed", "unknown_token"),
    ],
)
def test_precise_text_issues(client, researcher_headers, problem, code):
    h = researcher_headers
    study, version, test, flow, base = configured(client, h)
    translate(flow, test)
    overlays = flow["method_text"][test["id"]]
    if problem == "node":
        del flow["nodes"][1]["data"]["body"]["sv"]
    elif problem == "overlay":
        del overlays["/scale_labels/0"]["sv"]
    elif problem == "pointer":
        overlays["/allow_skips"] = {"en": "false", "sv": "false"}
    elif problem == "default":
        overlays["/instructions"]["en"] = "Different"
    elif problem == "length":
        overlays["/scale_labels/0"]["sv"] = "x" * 201
    else:
        flow["nodes"][1]["data"]["body"]["sv"] = {
            "unknown": "{{other}}",
            "scope": "{{sample_code}}",
            "shorthand_scope": "Taste $SAMPLE now",
            "malformed": "{{broken",
        }[problem]
    report = save(client, h, base, flow)
    assert not report["valid"]
    issue = next(i for i in report["issues"] if i["code"] == code)
    assert issue["node_id"]
    assert issue["path"]
    assert (
        client.post(
            f"/studies/{study['id']}/publish",
            headers=h,
            json={"study_version_id": version["id"], "revision_hash": report["revision_hash"]},
        ).status_code
        == 422
    )


def test_warnings_acknowledged_against_exact_snapshot(client, researcher_headers):
    h = researcher_headers
    study, version, test, flow, base = configured(client, h)
    flow["nodes"].append(
        {
            "id": str(uuid4()),
            "kind": "info",
            "title": {"en": "Unreachable"},
            "data": {"body": {"en": "After terminal"}, "continue_label": {"en": "Continue"}},
        }
    )
    review = save(client, h, base, flow)
    assert review["valid"]
    assert {i["code"] for i in review["issues"]} == {"unreachable_node"}
    body = {"study_version_id": version["id"], "revision_hash": review["revision_hash"]}
    assert client.post(f"/studies/{study['id']}/publish", headers=h, json=body).status_code == 422
    assert client.get(base, headers=h).json()["published_at"] is None
    body["acknowledged_warning_codes"] = ["unreachable_node"]
    assert client.post(f"/studies/{study['id']}/publish", headers=h, json=body).status_code == 200


def test_contradiction_warning_but_unknown_conditions_not_solved(client, researcher_headers):
    h = researcher_headers
    _, _, _, flow, base = configured(client, h)
    flow["nodes"][0]["guard"] = {
        "all": [
            {"variable": "context.language", "operator": "eq", "value": "en"},
            {"variable": "context.language", "operator": "neq", "value": "en"},
        ]
    }
    review = save(client, h, base, flow)
    assert review["valid"]
    assert "contradictory_guard" in {i["code"] for i in review["issues"]}
    del flow["nodes"][0]["guard"]
    assert save(client, h, base, flow)["issues"] == []


def test_default_language_change_is_atomic_and_requires_reviewed_method_text(
    client, researcher_headers
):
    h = researcher_headers
    _, _, test, flow, base = configured(client, h)
    translate(flow, test)
    flow["default_language"] = "sv"
    incomplete = deepcopy(flow)
    del incomplete["method_text"][test["id"]]["/scale_labels/0"]["sv"]
    previous = client.get(base, headers=h).json()
    rejected = client.put(
        base + "/form",
        headers=h,
        json={"form": incomplete, "revision_hash": previous["revision_hash"]},
    )
    assert rejected.status_code == 422
    assert client.get(base, headers=h).json() == previous
    review = save(client, h, base, flow)
    assert review["valid"], review
    changed = client.get(
        f"/studies/{previous['study_id']}/versions/{previous['id']}/tests", headers=h
    ).json()[0]
    assert changed["configuration"]["instructions"].endswith(" sv")
    saved = client.get(base, headers=h).json()
    assert (
        saved["form"]["method_text"][test["id"]]["/instructions"]["en"]
        == test["configuration"]["instructions"]
    )


def test_sample_tokens_validate_in_loop_and_method_overlay_inputs_are_closed(
    client, researcher_headers
):
    from test_sample_loop import loop_study

    h = researcher_headers
    study, _, flow, base, _ = loop_study(client, h)
    flow["nodes"][1]["data"]["children"][0]["data"]["prompt"]["en"] = (
        "Enter {{sample_code}} at {{sample_position}}"
    )
    review = save(client, h, base, flow)
    assert review["valid"], review
    # $SAMPLE is shorthand for {{sample_code}}; $SAMPLES is ordinary text, not a token.
    flow["nodes"][1]["data"]["children"][0]["data"]["prompt"]["en"] = "Taste $SAMPLE ($SAMPLES)"
    review = save(client, h, base, flow)
    assert review["valid"], review
    test = client.get(base + "/tests", headers=h).json()[0]
    previous = client.get(base, headers=h).json()
    rejected = client.put(
        f"/studies/{study['id']}/tests/{test['id']}",
        headers=h,
        json={
            "configuration": test["configuration"],
            "method_text": {"script": {"en": "unsafe"}},
            "revision_hash": previous["revision_hash"],
        },
    )
    assert rejected.status_code == 422
    assert client.get(base, headers=h).json() == previous


def test_unnamed_scale_steps_need_no_translation_but_named_ones_still_do(
    client, researcher_headers
):
    from sensibilia.flow_text import method_fields

    h = researcher_headers
    study, _, test, flow, base = configured(client, h)
    translate(flow, test)
    review = save(client, h, base, flow)
    assert review["valid"], review
    changed = deepcopy(test["configuration"])
    changed["scale_labels"] = ["Low", "", "", "", "Neutral", "", "", "", "High"]
    overlay = {
        pointer: {"en": text, "sv": text + " sv" if text else ""}
        for pointer, text in method_fields(changed).items()
    }
    url = f"/studies/{study['id']}/tests/{test['id']}"
    result = client.put(
        url,
        headers=h,
        json={
            "configuration": changed,
            "method_text": overlay,
            "revision_hash": review["revision_hash"],
        },
    )
    assert result.status_code == 200, result.text
    report = client.get(base + "/validation", headers=h).json()
    assert report["valid"], report
    # A named step is still reviewed in every language.
    del overlay["/scale_labels/4"]["sv"]
    current = client.get(base, headers=h).json()
    client.put(
        url,
        headers=h,
        json={
            "configuration": changed,
            "method_text": overlay,
            "revision_hash": current["revision_hash"],
        },
    )
    report = client.get(base + "/validation", headers=h).json()
    paths = [i["path"] for i in report["issues"] if i["code"] == "missing_translation"]
    assert paths == [["method_text", test["id"], "/scale_labels/4", "sv"]]


def test_older_published_flow_text_keeps_literal_semantics(client, researcher_headers):
    from sqlalchemy import text

    h = researcher_headers
    study, version, _, flow, base = configured(client, h)
    # Simulate a publication from before token checks: braces were unrestricted literal text.
    flow["nodes"][-1]["data"]["body"]["en"] = "Literal {{sample_code}}"
    with client.app.state.engine.begin() as db:
        import json

        db.execute(
            text("UPDATE study_versions SET form=:form, published_at='older' WHERE id=:id"),
            {"form": json.dumps(flow), "id": version["id"]},
        )
    session = client.post(
        "/sessions", headers=h, json={"study_version_id": version["id"], "assessor_code": "old"}
    ).json()
    package = client.get(
        f"/sessions/{session['id']}/test",
        headers={"Authorization": f"Bearer {session['session_token']}"},
    ).json()
    assert package["evaluator_version"] == "linear-v2.1"
    assert package["flow"]["text_version"] is None
    assert package["flow"]["nodes"][-1]["data"]["body"]["en"] == "Literal {{sample_code}}"
    assert client.get(base + "/validation", headers=h).json()["valid"]
