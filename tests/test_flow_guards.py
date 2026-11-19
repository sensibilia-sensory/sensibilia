import json
from copy import deepcopy
from pathlib import Path
from uuid import uuid4

import pytest
from pydantic import TypeAdapter
from test_flow_foundation import configured
from test_forms import form_study

from sensibilia.flow_semantics import evaluate_condition
from sensibilia.flows import Condition

VECTORS = json.loads(
    (Path(__file__).resolve().parents[1] / "docs/contracts/flow-condition-vectors.json").read_text()
)


@pytest.mark.parametrize("vector", VECTORS, ids=lambda v: v["name"])
def test_predicate_vectors(vector):
    condition = TypeAdapter(Condition).validate_python(vector["condition"])
    assert evaluate_condition(condition, vector["variables"]) is vector["expected"]


def node(kind, data, **kwargs):
    return {"id": str(uuid4()), "kind": kind, "title": {"en": kind}, "data": data, **kwargs}


def question(required=True):
    return node(
        "question",
        {
            "prompt": {"en": "Restrictions"},
            "answer_type": "multiple",
            "required": required,
            "allow_skip": not required,
            "options": [
                {"id": "nuts", "label": {"en": "Nuts"}},
                {"id": "none", "label": {"en": "None"}, "exclusive": True},
            ],
        },
    )


def save(client, headers, base, flow):
    version = client.get(base, headers=headers).json()
    result = client.put(
        base + "/form",
        headers=headers,
        json={"form": flow, "revision_hash": version["revision_hash"]},
    )
    assert result.status_code == 200, result.text
    return client.get(base + "/validation", headers=headers).json()


def test_nested_guarded_publish_and_frozen_clone(client, researcher_headers):
    h = researcher_headers
    study, _, _, flow, base = configured(client, h)
    consent = node(
        "consent",
        {"body": {"en": "Agree?"}, "accept_label": {"en": "Yes"}, "decline_label": {"en": "No"}},
    )
    restrictions = question()
    confirmation = node(
        "confirm",
        {"body": {"en": "Review restrictions"}, "ack_label": {"en": "Reviewed"}},
        guard={"variable": "assessor.restrictions", "operator": "neq", "value": []},
    )
    code = node(
        "code_entry",
        {
            "prompt": {"en": "Returning code"},
            "source": "returning_codes",
            "allow_unknown": True,
            "normalization": "trim_upper_ascii",
        },
    )
    baseline = node(
        "group",
        {
            "children": [
                node(
                    "question",
                    {
                        "prompt": {"en": "Age"},
                        "answer_type": "integer",
                        "min": 0,
                        "max": 120,
                        "required": True,
                        "allow_skip": False,
                    },
                )
            ]
        },
        guard={"variable": f"answer.{code['id']}.matched", "operator": "eq", "value": False},
    )
    screened = node("end", {"body": {"en": "Ended"}, "outcome": "screened_out"})
    wrapper = node(
        "group",
        {"children": [restrictions, confirmation, code, baseline, flow["nodes"][0]]},
        guard={"variable": f"answer.{consent['id']}", "operator": "eq", "value": True},
        otherwise={"action": "end_study", "target_id": screened["id"]},
    )
    flow["nodes"] = [consent, wrapper, flow["nodes"][1], screened]
    flow["restriction_source_id"] = restrictions["id"]
    review = save(client, h, base, flow)
    assert review["valid"], review
    published = client.post(
        f"/studies/{study['id']}/publish",
        headers=h,
        json={
            "study_version_id": review["study_version_id"],
            "revision_hash": review["revision_hash"],
        },
    )
    assert published.status_code == 200, published.text
    clone = client.post(f"/studies/{study['id']}/drafts", headers=h).json()
    assert clone["form"]["nodes"][1]["data"]["children"][0]["id"] == restrictions["id"]
    assert client.get(base, headers=h).json()["form"] == published.json()["form"]


@pytest.mark.parametrize(
    "case,code",
    [
        ("backward", "illegal_target"),
        ("interior", "illegal_target"),
        ("undefined", "undefined_variable"),
        ("self", "prior_definition"),
        ("type", "predicate_type"),
        ("previous", "previous_missing"),
        ("unknown", "unknown_variable"),
        ("end", "illegal_end"),
    ],
)
def test_semantic_errors_block_publish_without_changing_saved_buffer(
    client, researcher_headers, case, code
):
    h = researcher_headers
    study, _, _, flow, base = configured(client, h)
    source = question(required=False)
    target = node("info", {"body": {"en": "Info"}, "continue_label": {"en": "Continue"}})
    flow["nodes"] = [source, target, *flow["nodes"]]
    target["guard"] = {"variable": f"answer.{source['id']}", "operator": "neq", "value": []}
    if case == "backward":
        target["otherwise"] = {"action": "skip_to", "target_id": source["id"]}
    elif case == "interior":
        child = deepcopy(flow["nodes"][2])
        flow["nodes"][2] = node("group", {"children": [child]})
        target["otherwise"] = {"action": "skip_to", "target_id": child["id"]}
    elif case == "self":
        source["guard"] = {"variable": f"answer.{source['id']}", "operator": "is_defined"}
    elif case == "type":
        target["guard"] = {"variable": "context.language", "operator": "gt", "value": 0}
    elif case == "previous":
        source["otherwise"] = {"action": "previous_question"}
    elif case == "unknown":
        target["guard"] = {"variable": "context.invented", "operator": "eq", "value": True}
    elif case == "end":
        target["otherwise"] = {"action": "end_study", "target_id": flow["nodes"][-1]["id"]}
    review = save(client, h, base, flow)
    assert code in {i["code"] for i in review["issues"]}, review
    assert (
        client.post(
            f"/studies/{study['id']}/publish",
            headers=h,
            json={
                "study_version_id": review["study_version_id"],
                "revision_hash": review["revision_hash"],
            },
        ).status_code
        == 422
    )
    assert client.get(base, headers=h).json()["revision_hash"] == review["revision_hash"]


def test_optional_value_requires_ordered_defined_gate(client, researcher_headers):
    h = researcher_headers
    _, _, _, flow, base = configured(client, h)
    source = question(False)
    target = node("confirm", {"body": {"en": "Review"}, "ack_label": {"en": "Yes"}})
    target["guard"] = {
        "all": [
            {"variable": f"answer.{source['id']}", "operator": "is_defined"},
            {"variable": f"answer.{source['id']}", "operator": "contains", "value": "nuts"},
        ]
    }
    flow["nodes"] = [source, target, *flow["nodes"]]
    assert save(client, h, base, flow)["valid"]
    target["guard"]["all"].reverse()
    assert not save(client, h, base, flow)["valid"]


def test_explicit_legacy_conversion_preserves_original_publication(client, researcher_headers):
    h = researcher_headers
    study, _, published = form_study(client, h)
    base = f"/studies/{study['id']}/versions/{published['id']}"
    original = client.get(base, headers=h).json()
    converted = client.post(
        f"/studies/{study['id']}/drafts", headers=h, json={"convert_legacy_flow": True}
    )
    assert converted.status_code == 201, converted.text
    clone = converted.json()
    assert clone["form"]["schema_version"] == 2
    assert clone["form"]["nodes"][0]["guard"] is None
    assert (
        clone["form"]["nodes"][1]["guard"]["all"][0]["variable"]
        == f"answer.{clone['form']['nodes'][0]['id']}"
    )
    assert client.get(base, headers=h).json() == original
    review = client.get(
        f"/studies/{study['id']}/versions/{clone['id']}/validation", headers=h
    ).json()
    assert review["valid"], review


def test_explicit_linear_conversion_and_zero_frozen_context(client, researcher_headers):
    from test_api import study as linear_study

    h = researcher_headers
    study, _, published = linear_study(client, h)
    converted = client.post(
        f"/studies/{study['id']}/drafts", headers=h, json={"convert_legacy_flow": True}
    )
    assert converted.status_code == 201, converted.text
    flow = converted.json()["form"]
    assert flow["schema_version"] == 2
    assert [n["kind"] for n in flow["nodes"]] == ["embedded_method", "end"]
    assert (
        client.get(f"/studies/{study['id']}/versions/{published['id']}", headers=h).json()["form"]
        is None
    )


def test_optional_context_is_absent_and_guarded_package_is_frozen(client, researcher_headers):
    h = researcher_headers
    study, version, _, flow, base = configured(client, h)
    flow["nodes"][0]["guard"] = {"variable": "context.language", "operator": "eq", "value": "en"}
    review = save(client, h, base, flow)
    assert review["valid"]
    assert (
        client.post(
            f"/studies/{study['id']}/publish",
            headers=h,
            json={"study_version_id": version["id"], "revision_hash": review["revision_hash"]},
        ).status_code
        == 200
    )
    created = client.post(
        "/sessions",
        headers=h,
        json={
            "study_version_id": version["id"],
            "assessor_code": "A",
            "context": {"language": "en", "booth_number": 0},
        },
    ).json()
    credential = {"Authorization": "Bearer " + created["session_token"]}
    url = f"/sessions/{created['id']}/test"
    package = client.get(url, headers=credential).json()
    assert package["context"]["booth_number"] == 0
    assert "table_number" not in package["context"]
    assert package["evaluator_version"] == "guards-v2.2"
    assert client.post(f"/studies/{study['id']}/drafts", headers=h).status_code == 201
    assert client.get(url, headers=credential).json() == package


@pytest.mark.parametrize(
    "multiple,match,selected",
    [
        (False, "any", ["yes"]),
        (False, "any", ["no"]),
        (True, "any", ["yes"]),
        (True, "any", ["no"]),
        (True, "any", ["yes", "no"]),
        (True, "all", ["yes"]),
        (True, "all", ["no"]),
        (True, "all", ["yes", "no"]),
    ],
)
def test_converted_post_answer_routes_match_legacy_paths(multiple, match, selected):
    from sensibilia.forms import StudyForm, progress
    from sensibilia.legacy_flow import convert_legacy

    form = StudyForm.model_validate(
        {
            "steps": [
                {
                    "id": "eligibility",
                    "kind": "choice",
                    "title": "Eligibility",
                    "prompt": "Choose",
                    "multiple": multiple,
                    "options": [{"id": "yes", "label": "Yes"}, {"id": "no", "label": "No"}],
                    "route": {
                        "condition": {
                            "source_step_id": "eligibility",
                            "option_ids": ["yes", "no"] if multiple and match == "all" else ["yes"],
                            "match": match,
                        },
                        "then": "next",
                        "otherwise": "screen_out",
                    },
                },
                {"id": "info", "kind": "instruction", "title": "Info", "text": "Continue"},
            ]
        }
    )
    legacy_values = {"eligibility": {"selected": selected}, "info": {"acknowledged": True}}
    _, expected, visited = progress(form, legacy_values)
    flow = convert_legacy(form.model_dump(mode="json"), {}, "study")
    assert flow["nodes"][0]["guard"] is None
    variables = {f"answer.{flow['nodes'][0]['id']}": selected if multiple else selected[0]}
    shown = []
    for item in flow["nodes"]:
        guard = item["guard"]
        if guard and not evaluate_condition(
            TypeAdapter(Condition).validate_python(guard), variables
        ):
            continue
        if item["kind"] == "end":
            assert item["data"]["outcome"] == expected
            break
        shown.append(item["title"]["en"])
    assert shown == [
        next(step.title for step in form.steps if step.id == step_id) for step_id in visited
    ]


def test_oversized_conversion_rejected_without_creating_partial_draft(client, researcher_headers):
    h = researcher_headers
    form = {
        "steps": [
            {
                "id": "many",
                "kind": "choice",
                "title": "Many",
                "prompt": "Select",
                "multiple": True,
                "options": [{"id": str(i), "label": str(i)} for i in range(5)],
                "route": {
                    "condition": {"source_step_id": "many", "option_ids": ["0"]},
                    "then": "next",
                    "otherwise": "screen_out",
                },
            },
            {"id": "info", "kind": "instruction", "title": "Info", "text": "Read"},
        ]
    }
    study, _, _ = form_study(client, h, with_test=False, override=form)
    response = client.post(
        f"/studies/{study['id']}/drafts", headers=h, json={"convert_legacy_flow": True}
    )
    assert response.status_code == 422
    assert "bounded conversion" in response.text
    versions = client.get(f"/studies/{study['id']}", headers=h).json()["versions"]
    assert len(versions) == 1 and versions[0]["form"]["schema_version"] == 1
    assert client.post(f"/studies/{study['id']}/drafts", headers=h).status_code == 201


def test_ordinary_config_errors_select_v2_branch_and_keep_snapshot(client, researcher_headers):
    h = researcher_headers
    _, version, _, flow, base = configured(client, h)
    invalid = node(
        "question",
        {
            "prompt": {"en": "Integer"},
            "answer_type": "integer",
            "required": True,
            "allow_skip": False,
            "min": 0.5,
        },
    )
    flow["nodes"].insert(0, invalid)
    response = client.put(
        base + "/form", headers=h, json={"form": flow, "revision_hash": version["revision_hash"]}
    )
    assert response.status_code == 422
    errors = response.json()["detail"]
    assert len(errors) == 1
    assert errors[0]["loc"][-2:] == ["data", "min"]
    assert client.get(base, headers=h).json()["revision_hash"] == version["revision_hash"]
    invalid["data"] = {
        "prompt": {"en": "Choice"},
        "answer_type": "single",
        "required": True,
        "allow_skip": False,
        "options": [
            {"id": "a", "label": {"en": "A"}, "exclusive": True},
            {"id": "b", "label": {"en": "B"}},
        ],
    }
    response = client.put(
        base + "/form", headers=h, json={"form": flow, "revision_hash": version["revision_hash"]}
    )
    assert response.status_code == 422
    assert "only to multiple choice" in response.text


def test_end_study_target_must_end_unconditionally(client, researcher_headers):
    h = researcher_headers
    _, _, _, flow, base = configured(client, h)
    ending = node(
        "end",
        {"body": {"en": "Ended"}, "outcome": "screened_out"},
        guard={"variable": "context.language", "operator": "eq", "value": "sv"},
    )
    flow["nodes"][0]["guard"] = {"variable": "context.language", "operator": "eq", "value": "en"}
    flow["nodes"][0]["otherwise"] = {"action": "end_study", "target_id": ending["id"]}
    flow["nodes"].insert(1, ending)
    review = save(client, h, base, flow)
    assert "illegal_end" in {i["code"] for i in review["issues"]}
