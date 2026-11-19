from copy import deepcopy

import pytest
from test_flow_foundation import configured
from test_flow_guards import node, question, save


def loop_study(client, headers, tags=True):
    study, version, test, flow, base = configured(client, headers)
    samples = []
    for i in range(4):
        payload = {"code": f"S{i}", "label": f"Private product {i}"}
        if tags:
            payload["ingredient_tags"] = ["nut"] if i == 1 else []
        created = client.post(f"/studies/{study['id']}/samples", headers=headers, json=payload)
        assert created.status_code == 201, created.text
        samples.append(created.json())
    restrictions = question()
    method = flow["nodes"][0]
    method["data"]["sample_binding"] = "current"
    method["guard"] = {
        "variable": "derived.sample_conflicts_restriction",
        "operator": "eq",
        "value": False,
    }
    method["otherwise"] = {"action": "next_sample"}
    code = node(
        "code_entry",
        {
            "prompt": {"en": "Code"},
            "source": "sample_code",
            "allow_unknown": False,
            "normalization": "trim_upper_ascii",
        },
    )
    loop = node(
        "loop_samples", {"sample_ids": [s["id"] for s in samples], "children": [code, method]}
    )
    flow["nodes"] = [restrictions, loop, flow["nodes"][-1]]
    flow["restriction_source_id"] = restrictions["id"]
    flow["restriction_tag_map"] = {"nuts": ["nut"]}
    return study, version, flow, base, samples


def test_fixed_assignments_private_labels_and_clone(client, researcher_headers):
    h = researcher_headers
    study, version, flow, base, samples = loop_study(client, h)
    review = save(client, h, base, flow)
    assert review["valid"], review
    publication = client.post(
        f"/studies/{study['id']}/publish",
        headers=h,
        json={"study_version_id": version["id"], "revision_hash": review["revision_hash"]},
    )
    assert publication.status_code == 200, publication.text
    session = client.post(
        "/sessions", headers=h, json={"study_version_id": version["id"], "assessor_code": "A"}
    ).json()
    credential = {"Authorization": "Bearer " + session["session_token"]}
    url = f"/sessions/{session['id']}/test"
    package = client.get(url, headers=credential).json()
    assert package["evaluator_version"] == "samples-v2.3"
    assignment = package["loop_assignments"][0]
    assert set(assignment) == {"loop_id", "samples"}
    assert assignment["loop_id"] == flow["nodes"][1]["id"]
    assert [s["sample_id"] for s in assignment["samples"]] == [s["id"] for s in samples]
    assert [s["position"] for s in assignment["samples"]] == [1, 2, 3, 4]
    assert assignment["samples"][1]["ingredient_tags"] == ["nut"]
    assert "Private product" not in str(package)
    assert (
        client.post(
            f"/studies/{study['id']}/samples",
            headers=h,
            json={"code": "X", "label": "X", "ingredient_tags": []},
        ).status_code
        == 409
    )
    clone = client.post(f"/studies/{study['id']}/drafts", headers=h).json()
    cloned_samples = client.get(
        f"/studies/{study['id']}/versions/{clone['id']}/samples", headers=h
    ).json()
    assert {s["code"]: s["ingredient_tags"] for s in cloned_samples} == {
        s["code"]: s["ingredient_tags"] for s in samples
    }
    assert set(clone["form"]["nodes"][1]["data"]["sample_ids"]) == {s["id"] for s in cloned_samples}
    assert client.get(url, headers=credential).json() == package


@pytest.mark.parametrize(
    "case,code",
    [
        ("tags", "missing_ingredient_tags"),
        ("mapping", "restriction_tags"),
        ("scope", "sample_scope"),
        ("code", "sample_scope"),
        ("next", "sample_scope"),
        ("escape", "sample_scope"),
    ],
)
def test_loop_errors_block_publication(client, researcher_headers, case, code):
    study, version, flow, base, _ = loop_study(client, researcher_headers, tags=case != "tags")
    if case == "mapping":
        flow["restriction_tag_map"] = {}
    elif case == "scope":
        flow["nodes"][-1]["guard"] = {"variable": "sample.position", "operator": "eq", "value": 1}
    elif case == "code":
        flow["nodes"].insert(1, flow["nodes"][1]["data"]["children"].pop(0))
    elif case == "next":
        flow["nodes"][0]["otherwise"] = {"action": "next_sample"}
    elif case == "escape":
        code_node = flow["nodes"][1]["data"]["children"][0]
        flow["nodes"][-1]["guard"] = {
            "variable": f"answer.{code_node['id']}.matched",
            "operator": "eq",
            "value": True,
        }
    review = save(client, researcher_headers, base, flow)
    assert code in {i["code"] for i in review["issues"]}, review
    assert (
        client.post(
            f"/studies/{study['id']}/publish",
            headers=researcher_headers,
            json={"study_version_id": version["id"], "revision_hash": review["revision_hash"]},
        ).status_code
        == 422
    )


def test_sample_creation_changes_revision_and_rejects_invalid_tags(client, researcher_headers):
    study, version, _, _, base = configured(client, researcher_headers)
    payload = {"code": "A", "label": "A", "ingredient_tags": []}
    assert (
        client.post(
            f"/studies/{study['id']}/samples", headers=researcher_headers, json=payload
        ).status_code
        == 201
    )
    assert (
        client.get(base, headers=researcher_headers).json()["revision_hash"]
        != version["revision_hash"]
    )
    for tags in [[""], [" "], [1], ["x" * 101]]:
        bad = deepcopy(payload)
        bad.update(code="B", ingredient_tags=tags)
        assert (
            client.post(
                f"/studies/{study['id']}/samples", headers=researcher_headers, json=bad
            ).status_code
            == 422
        )


def test_sample_codes_may_contain_single_spaces_between_words(client, researcher_headers):
    study, _, _, _, _ = configured(client, researcher_headers)
    url = f"/studies/{study['id']}/samples"

    def create(code):
        return client.post(url, headers=researcher_headers, json={"code": code, "label": "x"})

    for code in ["Sample 1", "Expected sweet", "a b c", "A-1 B_2"]:
        created = create(code)
        assert created.status_code == 201, (code, created.text)
        assert created.json()["code"] == code
    # Spaces around the code are trimmed (as for every text field), so they are never stored.
    trimmed = create("  Padded  ")
    assert trimmed.status_code == 201 and trimmed.json()["code"] == "Padded"
    # Only single inner spaces, and no other characters.
    for code in ["A  B", "A\tB", "A\nB", "Å B", "A,B", " ", "x" * 41]:
        assert create(code).status_code == 422, repr(code)
    assert create("Sample 1").status_code != 201  # codes stay unique within a version


@pytest.mark.parametrize("case", ["foreign", "duplicate", "nested"])
def test_invalid_loop_references_are_rejected_atomically(client, researcher_headers, case):
    from uuid import uuid4

    _, _, flow, base, samples = loop_study(client, researcher_headers)
    saved = client.get(base, headers=researcher_headers).json()
    loop = flow["nodes"][1]
    if case == "foreign":
        loop["data"]["sample_ids"][0] = str(uuid4())
    elif case == "duplicate":
        loop["data"]["sample_ids"].append(samples[0]["id"])
    else:
        loop["data"]["children"].insert(
            0, node("loop_samples", {"sample_ids": [samples[0]["id"]], "children": []})
        )
    assert (
        client.put(
            base + "/form",
            headers=researcher_headers,
            json={"form": flow, "revision_hash": saved["revision_hash"]},
        ).status_code
        == 422
    )
    assert client.get(base, headers=researcher_headers).json() == saved


def test_upgrade_0004_preserves_legacy_sample_metadata(tmp_path, monkeypatch):
    from alembic import command
    from alembic.config import Config
    from conftest import ROOT
    from sqlalchemy import create_engine, text

    from sensibilia.db import EXPECTED_REVISION

    url = f"sqlite:///{(tmp_path / 'legacy.db').as_posix()}"
    monkeypatch.setenv("SENSIBILIA_DATABASE_URL", url)
    config = Config(str(ROOT / "alembic.ini"))
    command.upgrade(config, "0004")
    engine = create_engine(url)
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO studies (id,title,description,status,created_at) "
                "VALUES ('s','Legacy','','draft','2026-10-10')"
            )
        )
        connection.execute(
            text(
                "INSERT INTO study_versions (id,study_id,version_number,title,description) "
                "VALUES ('v','s',1,'Legacy','')"
            )
        )
        connection.execute(
            text(
                "INSERT INTO samples (id,study_version_id,code,label) "
                "VALUES ('sample','v','ABC','Private legacy')"
            )
        )
    command.upgrade(config, "head")
    with engine.connect() as connection:
        sample = connection.execute(text("SELECT code,label,ingredient_tags FROM samples")).one()
        assert tuple(sample) == ("ABC", "Private legacy", None)
        assert (
            connection.scalar(text("SELECT version_num FROM alembic_version")) == EXPECTED_REVISION
        )
    engine.dispose()
