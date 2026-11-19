import csv
import io
import json
from copy import deepcopy
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from test_api import event, provision, submit

from sensibilia.methods import CONFIGURATIONS, validate_observation

METHODS = ["cata", "rata", "jar", "triangle", "duo_trio", "two_afc", "flash_profile", "napping"]
DISCRIMINATION = {"triangle", "duo_trio", "two_afc"}


def method_id(kind):
    return kind.replace("_", "-") + "-v1"


def configuration(kind, ids):
    config = {"kind": kind, "instructions": "Evaluate the coded samples.", "sample_ids": ids}
    if kind in {"cata", "rata", "jar"}:
        config["questions"] = [{"id": "sweet", "prompt": "Sweetness"}]
    if kind == "two_afc":
        config.update(
            question="Which sample is sweeter?", expected_sample_id=ids[0] if ids else None
        )
    if kind == "rata":
        config["scale_labels"] = ["Low", "Medium", "High"]
    if kind == "flash_profile":
        config.update(
            descriptor_instructions="Generate your own sensory terms.",
            ranking_instructions="Rank all samples from low to high intensity.",
        )
    return config


def make_study(client, headers, kind, routed=False, **overrides):
    data = client.post("/studies", headers=headers, json={"title": kind}).json()
    samples = []
    for code, label in [("317", "Private product A"), ("582", "Private product B")]:
        response = client.post(
            f"/studies/{data['id']}/samples", headers=headers, json={"code": code, "label": label}
        )
        assert response.status_code == 201, response.text
        samples.append(response.json())
    config = configuration(kind, [s["id"] for s in samples]) | overrides
    response = client.post(
        f"/studies/{data['id']}/tests",
        headers=headers,
        json={"test_type_id": method_id(kind), "configuration": config},
    )
    assert response.status_code == 201, response.text
    if routed:
        draft_id = data["versions"][0]["id"]
        form = {
            "steps": [
                {
                    "id": "sensory",
                    "kind": "test",
                    "title": kind,
                    "study_test_id": response.json()["id"],
                }
            ]
        }
        saved = client.put(
            f"/studies/{data['id']}/versions/{draft_id}/form", headers=headers, json={"form": form}
        )
        assert saved.status_code == 200, saved.text
    version = client.post(f"/studies/{data['id']}/publish", headers=headers)
    assert version.status_code == 200, version.text
    return data, response.json(), version.json(), samples


def observations(test, samples, plan):
    kind = test["configuration"]["kind"]
    if kind in {"cata", "rata", "jar"}:
        value = {"kind": kind, "state": "unselected"}
        if kind == "rata":
            value.update(state="selected", rating=1)
        if kind == "jar":
            value.update(state="rated", rating=3)
        return [event(test, sample_id=s["id"], question_id="sweet", value=value) for s in samples]
    if kind in DISCRIMINATION:
        value = {"kind": kind, "state": "chosen", "selected_slot_id": plan["correct_slot_id"]}
        question = "choice"
    elif kind == "flash_profile":
        value = {
            "kind": kind,
            "state": "profile",
            "attributes": [
                {
                    "id": "own-term",
                    "term": "Toasted cereal",
                    "ranks": {s["id"]: i + 1 for i, s in enumerate(samples)},
                }
            ],
        }
        question = "profile"
    else:
        value = {
            "kind": kind,
            "state": "mapped",
            "points": {s["id"]: {"x": i * 60, "y": i * 40} for i, s in enumerate(samples)},
        }
        question = "map"
    return [event(test, question_id=question, value=value)]


@pytest.mark.parametrize("kind", METHODS)
def test_method_collection_and_lossless_export(client, researcher_headers, kind):
    data, test, version, samples = make_study(client, researcher_headers, kind)
    session, headers = provision(client, researcher_headers, version)
    path = f"/sessions/{session['id']}"
    package = client.get(path + "/test", headers=headers).json()
    assert package["package_schema_version"] == 3
    assert package == client.get(path + "/test", headers=headers).json()
    private = client.get(path + "/serving-plan", headers=researcher_headers)
    assert private.status_code == 200, private.text
    plan = private.json()[0]
    assert client.get(path + "/serving-plan", headers=headers).status_code == 401
    serialised = json.dumps(package)
    assert "Private product" not in serialised and "correct_slot_id" not in serialised
    assert "sequence_key" not in serialised
    if kind in DISCRIMINATION:
        assert package["samples"] == []
        assert all("sample_id" not in slot for slot in package["assignments"][0]["samples"])
    assert client.post(path + "/complete", headers=headers).status_code == 422
    events = observations(test, samples, plan)
    response = submit(client, session, headers, events)
    assert response.status_code == 200, response.text
    assert all(
        e["status"] == "duplicate"
        for e in submit(client, session, headers, events).json()["events"]
    )
    assert client.post(path + "/complete", headers=headers).status_code == 200
    records = client.get(f"/studies/{data['id']}/responses", headers=researcher_headers).json()
    assert len(records) == len(events)
    exported = client.get(f"/studies/{data['id']}/export", headers=researcher_headers)
    rows = list(csv.DictReader(io.StringIO(exported.text)))
    assert len(rows) == (1 if kind in DISCRIMINATION else 2)
    for row in rows:
        original = next(e for e in events if e["client_event_id"] == row["client_event_id"])
        assert row["study_version_id"] == version["id"]
        assert row["study_test_id"] == test["id"]
        assert row["method_schema_version"] == "1"
        assert json.loads(row["value_json"]) == next(
            r["value"] for r in records if r["client_event_id"] == original["client_event_id"]
        )
        assert json.loads(row["serving_plan_json"])["kind"] == kind
    if kind in DISCRIMINATION:
        assert rows[0]["correct"] == "True"
        assert rows[0]["selected_code"]
    if kind == "flash_profile":
        assert {r["rank"] for r in rows} == {"1", "2"}
        assert all(r["descriptor"] == "Toasted cereal" for r in rows)
    if kind == "napping":
        assert {r["x"] for r in rows} == {"0.0", "60.0"}
        assert all(r["coordinate_units"] == "cm_equivalent" for r in rows)


@pytest.mark.parametrize("kind", METHODS)
def test_new_method_configuration_rejects_invalid_inputs(kind):
    ids = [str(uuid4()), str(uuid4())]
    cls = CONFIGURATIONS[method_id(kind)]
    config = configuration(kind, ids)
    assert cls.model_validate(config).kind == kind
    for override in [{"instructions": " "}, {"sample_ids": [ids[0], ids[0]]}, {"invented": 1}]:
        with pytest.raises(ValueError):
            cls.model_validate(config | override)
    if kind in DISCRIMINATION | {"flash_profile", "napping"}:
        with pytest.raises(ValueError):
            cls.model_validate(config | {"sample_ids": [ids[0]]})
    if kind in {"cata", "rata"}:
        with pytest.raises(ValueError):
            cls.model_validate(
                config | {"questions": [{"id": "a", "prompt": "A", "required": False}]}
            )


def validate(kind, config, value, question="sweet", sample=None, plan=None):
    return validate_observation(method_id(kind), config, question, sample, value, plan)


def test_attribute_states_zero_and_scale_bounds():
    config = configuration("rata", []) | {
        "rating_min": 0,
        "require_ratings": False,
        "allow_skips": True,
    }
    states = [
        validate("rata", config, {"kind": "rata", "state": state, "rating": rating})
        for state, rating in [
            ("unselected", None),
            ("selected", None),
            ("selected", 0),
            ("skipped", None),
        ]
    ]
    assert len({json.dumps(v, sort_keys=True) for v in states}) == 4
    for value in [
        {"kind": "rata", "state": "unselected", "rating": 0},
        {"kind": "rata", "state": "selected", "rating": 3},
        {"kind": "rata", "state": "selected", "rating": True},
    ]:
        with pytest.raises(ValueError):
            validate("rata", config, value)
    with pytest.raises(ValueError):
        validate("rata", config | {"require_ratings": True}, states[1])
    jar = configuration("jar", []) | {"scale_labels": ["Too low", "Just about right", "Too high"]}
    assert validate("jar", jar, {"kind": "jar", "state": "rated", "rating": 2})["rating"] == 2
    with pytest.raises(ValueError):
        validate("jar", jar, {"kind": "jar", "state": "rated", "rating": 4})
    with pytest.raises(ValueError):
        CONFIGURATIONS["jar-v1"].model_validate(jar | {"scale_labels": ["Low", "High"]})
    with pytest.raises(ValueError):
        validate("cata", configuration("cata", []), {"kind": "cata", "state": "skipped"})


def test_flash_ranks_are_complete_and_ties_explicit():
    ids = [str(uuid4()) for _ in range(3)]
    config = configuration("flash_profile", ids)
    value = {
        "kind": "flash_profile",
        "state": "profile",
        "attributes": [
            {"id": "a", "term": "Grassy", "ranks": dict(zip(ids, [1, 1, 2], strict=True))}
        ],
    }
    assert validate("flash_profile", config, value, "profile") == value
    with pytest.raises(ValueError):
        validate("flash_profile", config | {"allow_ties": False}, value, "profile")
    for ranks in [
        {ids[0]: 1, ids[1]: 2},
        dict(zip(ids, [1, 1, 3], strict=True)),
        dict(zip(ids, [0, 1, 2], strict=True)),
        dict(zip(ids, [1, 2, 2.5], strict=True)),
    ]:
        invalid = deepcopy(value)
        invalid["attributes"][0]["ranks"] = ranks
        with pytest.raises(ValueError):
            validate("flash_profile", config, invalid, "profile")
    duplicate = deepcopy(value)
    duplicate["attributes"].append(
        {"id": "b", "term": "GRASSY", "ranks": value["attributes"][0]["ranks"]}
    )
    with pytest.raises(ValueError):
        validate("flash_profile", config, duplicate, "profile")


def test_napping_complete_finite_coordinates_and_optional_descriptions():
    ids = [str(uuid4()), str(uuid4())]
    config = configuration("napping", ids)
    value = {
        "kind": "napping",
        "state": "mapped",
        "points": {ids[0]: {"x": 0, "y": 0}, ids[1]: {"x": 60, "y": 40}},
    }
    assert validate("napping", config, value, "map")["points"][ids[0]]["x"] == 0
    for x in [-1, 61, float("inf"), float("nan"), "20"]:
        invalid = deepcopy(value)
        invalid["points"][ids[0]]["x"] = x
        with pytest.raises(ValueError):
            validate("napping", config, invalid, "map")
    invalid = deepcopy(value)
    del invalid["points"][ids[1]]
    with pytest.raises(ValueError):
        validate("napping", config, invalid, "map")
    value["points"][ids[0]]["description"] = "Similar aromas"
    with pytest.raises(ValueError):
        validate("napping", config, value, "map")
    validate("napping", config | {"collect_descriptions": True}, value, "map")


@pytest.mark.parametrize(
    ("kind", "overrides", "cycle"),
    [
        ("triangle", {}, 6),
        ("duo_trio", {}, 4),
        ("duo_trio", {"reference_mode": "constant"}, 2),
        ("two_afc", {}, 2),
    ],
)
def test_blinded_balanced_frozen_serving_plans(client, researcher_headers, kind, overrides, cycle):
    # Constant reference needs a product ID; add it to a draft before publishing.
    if overrides:
        data = client.post("/studies", headers=researcher_headers, json={"title": kind}).json()
        samples = [
            client.post(
                f"/studies/{data['id']}/samples",
                headers=researcher_headers,
                json={"code": str(300 + i), "label": str(i)},
            ).json()
            for i in range(2)
        ]
        config = (
            configuration(kind, [s["id"] for s in samples])
            | overrides
            | {"reference_sample_id": samples[0]["id"]}
        )
        response = client.post(
            f"/studies/{data['id']}/tests",
            headers=researcher_headers,
            json={"test_type_id": method_id(kind), "configuration": config},
        )
        assert response.status_code == 201, response.text
        test = response.json()
        version = client.post(f"/studies/{data['id']}/publish", headers=researcher_headers).json()
    else:
        data, test, version, samples = make_study(client, researcher_headers, kind)
    keys = []
    for _ in range(cycle * 2):
        session, headers = provision(client, researcher_headers, version)
        plan = client.get(
            f"/sessions/{session['id']}/serving-plan", headers=researcher_headers
        ).json()[0]
        keys.append(plan["sequence_key"])
        slots = plan["samples"] + ([plan["reference"]] if plan["reference"] else [])
        assert len({s["code"] for s in slots}) == len(slots)
        assert all(len(s["code"]) == 3 for s in slots)
        correct = next(s for s in plan["samples"] if s["slot_id"] == plan["correct_slot_id"])
        if kind == "duo_trio":
            assert correct["sample_id"] == plan["reference"]["sample_id"]
            bad = event(
                test,
                question_id="choice",
                value={"kind": kind, "state": "chosen", "selected_slot_id": "s3"},
            )
            assert submit(client, session, headers, [bad]).status_code == 422
        else:
            assert sum(s["sample_id"] == correct["sample_id"] for s in plan["samples"]) == 1
        with pytest.raises(IntegrityError), client.app.state.engine.begin() as connection:
            connection.execute(
                text("UPDATE session_test_assignments SET plan='{}' WHERE session_id=:id"),
                {"id": session["id"]},
            )
    assert len(set(keys[:cycle])) == cycle
    assert len(set(keys[cycle:])) == cycle
    if overrides:
        cloned_version = client.post(
            f"/studies/{data['id']}/drafts", headers=researcher_headers
        ).json()
        cloned = client.get(
            f"/studies/{data['id']}/versions/{cloned_version['id']}/tests",
            headers=researcher_headers,
        ).json()[0]["configuration"]
        assert cloned["reference_sample_id"] != samples[0]["id"]
        assert cloned["reference_sample_id"] in cloned["sample_ids"]
    if kind == "two_afc":
        cloned_version = client.post(
            f"/studies/{data['id']}/drafts", headers=researcher_headers
        ).json()
        cloned = client.get(
            f"/studies/{data['id']}/versions/{cloned_version['id']}/tests",
            headers=researcher_headers,
        ).json()[0]["configuration"]
        assert cloned["expected_sample_id"] in cloned["sample_ids"]
        assert cloned["expected_sample_id"] != samples[0]["id"]


@pytest.mark.parametrize("kind", METHODS)
def test_routed_methods_require_complete_product_responses(client, researcher_headers, kind):
    from test_forms import form_event, form_submit

    _, test, version, samples = make_study(client, researcher_headers, kind, routed=True)
    session, headers = provision(client, researcher_headers, version)
    plan = client.get(f"/sessions/{session['id']}/serving-plan", headers=researcher_headers).json()[
        0
    ]
    continued = form_event("sensory", {"state": "continued", "acknowledged": False})
    assert form_submit(client, session, headers, [continued]).status_code == 422
    events = observations(test, samples, plan)
    if len(events) > 1:
        assert submit(client, session, headers, events[:1]).status_code == 200
        assert form_submit(client, session, headers, [continued]).status_code == 422
        events = events[1:]
    assert submit(client, session, headers, events).status_code == 200
    result = form_submit(client, session, headers, [continued])
    assert result.status_code == 200, result.text
    assert (
        form_submit(client, session, headers, [continued]).json()["events"][0]["status"]
        == "duplicate"
    )
    assert client.post(f"/sessions/{session['id']}/complete", headers=headers).status_code == 200


def test_sample_version_provenance_and_clone(client, researcher_headers):
    data, test, version, samples = make_study(client, researcher_headers, "cata")
    session, headers = provision(client, researcher_headers, version)
    first = event(
        test,
        sample_id=samples[0]["id"],
        question_id="sweet",
        value={"kind": "cata", "state": "unselected"},
    )
    assert submit(client, session, headers, [first]).status_code == 200
    assert client.post(f"/sessions/{session['id']}/complete", headers=headers).status_code == 422
    second = event(
        test,
        sample_id=samples[1]["id"],
        question_id="sweet",
        value={"kind": "cata", "state": "selected"},
    )
    assert submit(client, session, headers, [second]).status_code == 200
    correction = event(
        test,
        sample_id=samples[0]["id"],
        question_id="sweet",
        value={"kind": "cata", "state": "selected"},
        supersedes_event_id=first["client_event_id"],
    )
    assert submit(client, session, headers, [correction]).status_code == 200
    draft = client.post(f"/studies/{data['id']}/drafts", headers=researcher_headers).json()
    cloned = client.get(
        f"/studies/{data['id']}/versions/{draft['id']}/tests", headers=researcher_headers
    ).json()[0]
    new_samples = client.get(
        f"/studies/{data['id']}/versions/{draft['id']}/samples", headers=researcher_headers
    ).json()
    assert set(cloned["configuration"]["sample_ids"]) == {s["id"] for s in new_samples}
    assert set(cloned["configuration"]["sample_ids"]).isdisjoint(s["id"] for s in samples)
    assert (
        submit(
            client,
            session,
            headers,
            [
                event(
                    test,
                    sample_id=new_samples[0]["id"],
                    question_id="sweet",
                    value={"kind": "cata", "state": "selected"},
                )
            ],
        ).status_code
        == 422
    )
    for statement in [
        "UPDATE samples SET label='changed' WHERE id=:id",
        "DELETE FROM samples WHERE id=:id",
    ]:
        with pytest.raises(IntegrityError), client.app.state.engine.begin() as connection:
            connection.execute(text(statement), {"id": samples[0]["id"]})
    invalid = client.post(
        f"/studies/{data['id']}/tests",
        headers=researcher_headers,
        json={
            "test_type_id": "cata-v1",
            "configuration": configuration("cata", [samples[0]["id"]]),
        },
    )
    assert invalid.status_code == 422
    wrong_kind = client.post(
        f"/studies/{data['id']}/tests",
        headers=researcher_headers,
        json={"test_type_id": "cata-v1", "configuration": configuration("jar", [])},
    )
    assert wrong_kind.status_code == 422


def test_registry_schemas_match_frozen_migration(client, researcher_headers):
    from conftest import ROOT

    frozen = json.loads((ROOT / "migrations/versions/methods_v1.json").read_text(encoding="utf-8"))
    methods = {m["id"]: m for m in client.get("/test-types", headers=researcher_headers).json()}
    assert len(methods) == 10
    assert (
        methods["tcata-v1"]["configuration_schema"]
        == CONFIGURATIONS["tcata-v1"].model_json_schema()
    )
    for row in frozen:
        assert (
            methods[row["id"]]["configuration_schema"]
            == CONFIGURATIONS[row["id"]].model_json_schema()
            == row["configuration_schema"]
        )


def test_two_afc_task_semantics(client, researcher_headers):
    ids = [str(uuid4()), str(uuid4())]
    cls = CONFIGURATIONS["two-afc-v1"]
    base = configuration("two_afc", ids)
    with pytest.raises(ValueError):  # directional needs an expected product
        cls.model_validate(base | {"expected_sample_id": None})
    with pytest.raises(ValueError):  # expected product must be one of the pair
        cls.model_validate(base | {"expected_sample_id": str(uuid4())})
    with pytest.raises(ValueError):  # preference has no key
        cls.model_validate(base | {"task": "preference"})
    with pytest.raises(ValueError):
        cls.model_validate(base | {"question": " "})
    cls.model_validate(base | {"task": "preference", "expected_sample_id": None})

    data, test, version, samples = make_study(
        client, researcher_headers, "two_afc", task="preference", expected_sample_id=None
    )
    session, headers = provision(client, researcher_headers, version)
    plan = client.get(f"/sessions/{session['id']}/serving-plan", headers=researcher_headers).json()[
        0
    ]
    assert plan["correct_slot_id"] is None and plan["reference"] is None
    value = {"kind": "two_afc", "state": "chosen", "selected_slot_id": "s2"}
    assert submit(client, session, headers, [event(test, question_id="choice", value=value)])
    rows = list(
        csv.DictReader(
            io.StringIO(
                client.get(f"/studies/{data['id']}/export", headers=researcher_headers).text
            )
        )
    )
    assert rows[0]["correct"] == "" and rows[0]["selected_code"]
    # Only two slots exist: s3 is not assigned.
    bad = event(test, question_id="choice", value=value | {"selected_slot_id": "s3"})
    session2, headers2 = provision(client, researcher_headers, version)
    assert submit(client, session2, headers2, [bad]).status_code == 422
