from copy import deepcopy
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from test_flow_foundation import configured
from test_sample_loop import loop_study


def publish(client, h, study, version):
    result = client.get(
        f"/studies/{study['id']}/versions/{version['id']}/validation", headers=h
    ).json()
    response = client.post(
        f"/studies/{study['id']}/publish",
        headers=h,
        json={
            "study_version_id": version["id"],
            "revision_hash": result["revision_hash"],
            "acknowledged_warning_codes": [
                i["code"] for i in result["issues"] if i["severity"] == "warning"
            ],
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def body(version, test):
    return {
        "title": version["title"],
        "description": version["description"],
        "form": deepcopy(version["form"]),
        "revision_hash": version["revision_hash"],
        "tests": [
            {
                "id": test["id"],
                "test_type_id": test["test_type_id"],
                "configuration": test["configuration"],
            }
        ],
    }


def test_template_duplicate_publication_remaps_without_assessments(client, researcher_headers):
    h = researcher_headers
    study, version, test, flow, base = configured(client, h)
    frozen = publish(client, h, study, version)
    session = client.post(
        "/sessions",
        headers=h,
        json={"study_version_id": version["id"], "assessor_code": "original"},
    ).json()
    package_url = f"/sessions/{session['id']}/test"
    sh = {"Authorization": "Bearer " + session["session_token"]}
    package = client.get(package_url, headers=sh).json()
    template = client.post(
        "/study-templates",
        headers=h,
        json={
            "source_version_id": version["id"],
            "name": "Reviewed liking",
            "review_notes": "Review codes, restrictions, wording and translations for each use",
        },
    )
    assert template.status_code == 201
    assert client.get("/study-templates", headers=h).json()[0] == template.json()
    duplicate = client.post(
        "/studies/duplicate",
        headers=h,
        json={"source_version_id": version["id"], "title": "New study", "reviewed_content": True},
    )
    assert duplicate.status_code == 201, duplicate.text
    cloned = duplicate.json()
    cv = cloned["versions"][0]
    assert cv["id"] != version["id"] and cloned["id"] != study["id"]
    assert cv["form"]["nodes"][0]["data"]["study_test_id"] != test["id"]
    assert (
        client.get(f"/studies/{cloned['id']}/versions/{cv['id']}/sessions", headers=h).json() == []
    )
    assert client.get(package_url, headers=sh).json() == package
    assert client.get(base, headers=h).json() == frozen
    assert client.get(f"/studies/{cloned['id']}/versions/{cv['id']}/validation", headers=h).json()[
        "valid"
    ]
    assert client.get("/study-templates").status_code == 401
    assert (
        client.post(
            "/studies/duplicate",
            headers=h,
            json={"source_version_id": version["id"], "title": "Bad", "reviewed_content": False},
        ).status_code
        == 422
    )


def test_atomic_draft_save_stale_release_and_delete_undo(client, researcher_headers):
    h = researcher_headers
    study, version, test, flow, base = configured(client, h)
    original = body(version, test)
    deleted = deepcopy(original)
    deleted["form"]["nodes"] = [flow["nodes"][1]]
    deleted["tests"] = []
    saved = client.put(base + "/draft", headers=h, json=deleted)
    assert saved.status_code == 200, saved.text
    assert client.get(base + "/tests", headers=h).json() == []
    assert client.put(base + "/draft", headers=h, json=original).status_code == 409
    assert (
        client.post(
            f"/studies/{study['id']}/publish",
            headers=h,
            json={"study_version_id": version["id"], "revision_hash": version["revision_hash"]},
        ).status_code
        == 409
    )
    original["revision_hash"] = saved.json()["revision_hash"]
    restored = client.put(base + "/draft", headers=h, json=original)
    assert restored.status_code == 200, restored.text
    assert client.get(base + "/tests", headers=h).json()[0]["id"] == test["id"]
    assert restored.json()["form"] == version["form"]
    audit = client.get(base + "/audit", headers=h).json()
    assert len(audit) >= 4 and all(a["principal"].startswith("researcher-key:") for a in audit)
    with client.app.state.engine.begin() as db:
        with pytest.raises(IntegrityError):
            db.execute(text("DELETE FROM draft_audit"))
    frozen = publish(client, h, study, restored.json())
    original["revision_hash"] = frozen["revision_hash"]
    assert client.put(base + "/draft", headers=h, json=original).status_code == 409


def test_failed_aggregate_save_rolls_back_and_rejects_foreign_ids(client, researcher_headers):
    h = researcher_headers
    study, version, test, flow, base = configured(client, h)
    payload = body(version, test)
    payload["title"] = "Must not persist"
    payload["form"]["nodes"][0]["data"]["study_test_id"] = str(uuid4())
    before = client.get(base + "/audit", headers=h).json()
    assert client.put(base + "/draft", headers=h, json=payload).status_code == 422
    assert client.get(base, headers=h).json() == version
    assert client.get(base + "/tests", headers=h).json() == [test]
    assert client.get(base + "/audit", headers=h).json() == before
    payload = body(version, test)
    payload["tests"][0]["configuration"]["scale_labels"] = ["invalid"]
    assert client.put(base + "/draft", headers=h, json=payload).status_code == 422
    payload = body(version, test)
    payload["tests"][0]["id"] = str(uuid4())
    assert client.put(base + "/draft", headers=h, json=payload).status_code == 422
    assert (
        client.post(
            "/study-templates",
            headers=h,
            json={
                "source_version_id": version["id"],
                "name": "Unreleased",
                "review_notes": "review",
            },
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/studies/duplicate",
            headers=h,
            json={"source_version_id": version["id"], "title": "Draft", "reviewed_content": True},
        ).status_code
        == 422
    )


def test_template_sample_and_method_overlay_remapping(client, researcher_headers):
    h = researcher_headers
    study, version, flow, base, samples = loop_study(client, h)
    response = client.put(
        base + "/form",
        headers=h,
        json={"form": flow, "revision_hash": client.get(base, headers=h).json()["revision_hash"]},
    )
    assert response.status_code == 200, response.text
    version = response.json()
    publish(client, h, study, version)
    result = client.post(
        "/studies/duplicate",
        headers=h,
        json={
            "source_version_id": version["id"],
            "title": "Loop duplicate",
            "reviewed_content": True,
        },
    )
    assert result.status_code == 201, result.text
    clone = result.json()
    cv = clone["versions"][0]
    new_samples = client.get(
        f"/studies/{clone['id']}/versions/{cv['id']}/samples", headers=h
    ).json()
    assert {s["id"] for s in new_samples}.isdisjoint({s["id"] for s in samples})
    assert sorted((s["code"], s["ingredient_tags"]) for s in new_samples) == sorted(
        (s["code"], s["ingredient_tags"]) for s in samples
    )
    assert client.get(f"/studies/{clone['id']}/versions/{cv['id']}/validation", headers=h).json()[
        "valid"
    ]


def test_first_edit_of_pre_audit_draft_can_undo_method_deletion(client, researcher_headers):
    from sqlalchemy.orm import Session

    from sensibilia.methods import DEFAULT_LABELS
    from sensibilia.models import Study, StudyTest, StudyVersion

    h = researcher_headers
    with Session(client.app.state.engine, expire_on_commit=False) as db:
        study = Study(title="Pre-audit draft", description="")
        db.add(study)
        db.flush()
        version = StudyVersion(
            study_id=study.id, version_number=1, title=study.title, description=""
        )
        db.add(version)
        db.flush()
        test = StudyTest(
            study_version_id=version.id,
            test_type_id="hedonic-9-v1",
            position=0,
            configuration={
                "instructions": "Taste",
                "questions": [{"id": "liking", "prompt": "Overall liking", "required": True}],
                "scale_labels": DEFAULT_LABELS,
                "allow_skips": False,
            },
        )
        db.add(test)
        db.flush()
        version.form = {
            "schema_version": 2,
            "languages": ["en"],
            "default_language": "en",
            "nodes": [
                {
                    "id": str(uuid4()),
                    "kind": "embedded_method",
                    "title": {"en": "Liking"},
                    "data": {"study_test_id": test.id, "sample_binding": "none"},
                },
                {
                    "id": str(uuid4()),
                    "kind": "end",
                    "title": {"en": "Finish"},
                    "data": {"body": {"en": "Thanks"}, "outcome": "completed"},
                },
            ],
        }
        db.commit()
    base = f"/studies/{study.id}/versions/{version.id}"
    assert client.get(base + "/audit", headers=h).json() == []
    saved = client.get(base, headers=h).json()
    original = body(saved, client.get(base + "/tests", headers=h).json()[0])
    deleted = deepcopy(original)
    deleted["tests"] = []
    deleted["form"]["nodes"] = deleted["form"]["nodes"][1:]
    response = client.put(base + "/draft", headers=h, json=deleted)
    assert response.status_code == 200, response.text
    audit = client.get(base + "/audit", headers=h).json()
    assert any(a["action"].startswith("baseline before") for a in audit)
    original["revision_hash"] = response.json()["revision_hash"]
    restored = client.put(base + "/draft", headers=h, json=original)
    assert restored.status_code == 200, restored.text
    assert client.get(base + "/tests", headers=h).json()[0]["id"] == test.id
