from copy import deepcopy
from uuid import uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from sensibilia.flows import DraftFlowV2
from sensibilia.methods import DEFAULT_LABELS


def configured(client, headers):
    study = client.post("/studies", headers=headers, json={"title": "Flow study"}).json()
    version = study["versions"][0]
    test = client.post(
        f"/studies/{study['id']}/tests",
        headers=headers,
        json={
            "configuration": {
                "instructions": "Taste the sample",
                "questions": [{"id": "liking", "prompt": "Overall liking", "required": True}],
                "scale_labels": DEFAULT_LABELS,
                "allow_skips": False,
            }
        },
    ).json()
    base = f"/studies/{study['id']}/versions/{version['id']}"
    version = client.get(base, headers=headers).json()
    flow = {
        "schema_version": 2,
        "languages": ["en"],
        "default_language": "en",
        "nodes": [
            {
                "id": str(uuid4()),
                "kind": "embedded_method",
                "title": {"en": "Liking"},
                "data": {"study_test_id": test["id"], "sample_binding": "none"},
            },
            {
                "id": str(uuid4()),
                "kind": "end",
                "title": {"en": "Finish"},
                "data": {"body": {"en": "Thank you"}, "outcome": "completed"},
            },
        ],
    }
    saved = client.put(
        base + "/form",
        headers=headers,
        json={"form": flow, "revision_hash": version["revision_hash"]},
    )
    assert saved.status_code == 200, saved.text
    return study, saved.json(), test, flow, base


def test_linear_flow_publish_package_freeze_and_clone(client, researcher_headers):
    h = researcher_headers
    study, version, test, flow, base = configured(client, h)
    assert client.get(base, headers=h).json()["form"]["nodes"][0]["id"] == flow["nodes"][0]["id"]
    review = client.get(base + "/validation", headers=h).json()
    assert review["valid"], review
    published = client.post(
        f"/studies/{study['id']}/publish",
        headers=h,
        json={"study_version_id": version["id"], "revision_hash": review["revision_hash"]},
    )
    assert published.status_code == 200, published.text
    session = client.post(
        "/sessions", headers=h, json={"study_version_id": version["id"], "assessor_code": "A01"}
    ).json()
    package = client.get(
        f"/sessions/{session['id']}/test",
        headers={"Authorization": f"Bearer {session['session_token']}"},
    ).json()
    assert package["package_schema_version"] == 4
    assert package["flow"]["nodes"][0]["data"]["study_test_id"] == test["id"]
    assert package["context"] == {"language": "en"}
    assert package["evaluator_version"] == "linear-v2.1"
    assert (
        client.put(
            base + "/form",
            headers=h,
            json={"form": flow, "revision_hash": version["revision_hash"]},
        ).status_code
        == 409
    )
    with client.app.state.engine.begin() as connection:
        with pytest.raises(IntegrityError):
            connection.execute(
                text("UPDATE study_versions SET form=NULL WHERE id=:id"), {"id": version["id"]}
            )
    clone = client.post(f"/studies/{study['id']}/drafts", headers=h).json()
    assert clone["form"]["nodes"][0]["id"] == flow["nodes"][0]["id"]
    assert clone["form"]["nodes"][0]["data"]["study_test_id"] != test["id"]
    assert (
        client.get(
            f"/sessions/{session['id']}/test",
            headers={"Authorization": f"Bearer {session['session_token']}"},
        ).json()
        == package
    )


def test_revision_foreign_references_incomplete_and_unknown_guard(client, researcher_headers):
    h = researcher_headers
    study, version, test, flow, base = configured(client, h)
    # Legacy request bodies retain their v1 behavior, but cannot bypass v2 revisions.
    assert (
        client.patch(f"/studies/{study['id']}", headers=h, json={"title": "No hash"}).status_code
        == 409
    )
    assert (
        client.post(
            f"/studies/{study['id']}/tests",
            headers=h,
            json={"configuration": test["configuration"]},
        ).status_code
        == 409
    )
    assert (
        client.put(
            f"/studies/{study['id']}/tests/{test['id']}",
            headers=h,
            json={"configuration": test["configuration"]},
        ).status_code
        == 409
    )
    assert client.delete(f"/studies/{study['id']}/tests/{test['id']}", headers=h).status_code == 409
    assert (
        client.put(
            base + "/form", headers=h, json={"form": flow, "revision_hash": "stale"}
        ).status_code
        == 409
    )
    foreign = deepcopy(flow)
    foreign["nodes"][0]["data"]["study_test_id"] = str(uuid4())
    assert (
        client.put(
            base + "/form",
            headers=h,
            json={"form": foreign, "revision_hash": version["revision_hash"]},
        ).status_code
        == 422
    )
    flow["nodes"][1]["guard"] = {"variable": "sample.code", "operator": "eq", "value": "123"}
    result = client.put(
        base + "/form", headers=h, json={"form": flow, "revision_hash": version["revision_hash"]}
    )
    assert result.status_code == 200
    assert not client.get(base + "/validation", headers=h).json()["valid"]
    assert (
        client.post(
            f"/studies/{study['id']}/publish",
            headers=h,
            json={
                "study_version_id": version["id"],
                "revision_hash": result.json()["revision_hash"],
            },
        ).status_code
        == 422
    )
    flow["nodes"] = []
    saved = client.put(
        base + "/form",
        headers=h,
        json={"form": flow, "revision_hash": result.json()["revision_hash"]},
    )
    assert saved.status_code == 200
    assert not client.get(base + "/validation", headers=h).json()["valid"]
    other = client.post("/studies", headers=h, json={"title": "Other"}).json()
    assert (
        client.get(f"/studies/{other['id']}/versions/{version['id']}", headers=h).status_code == 404
    )


def test_closed_types_ids_and_kind_applicability():
    base = {"schema_version": 2, "languages": ["en"], "default_language": "en", "nodes": []}
    assert DraftFlowV2.model_validate(base).nodes == []
    for update in ({"languages": ["en", "en"]}, {"default_language": "sv"}, {"script": "eval()"}):
        with pytest.raises(ValidationError):
            DraftFlowV2.model_validate({**base, **update})
    node = {
        "id": str(uuid4()),
        "kind": "question",
        "title": {"en": ""},
        "data": {
            "prompt": {"en": ""},
            "answer_type": "integer",
            "required": False,
            "allow_skip": True,
            "min": 0,
        },
    }
    assert DraftFlowV2.model_validate({**base, "nodes": [node]})
    for nodes in (
        [node, node],
        [{**node, "kind": "unknown"}],
        [
            {
                **node,
                "data": {
                    **node["data"],
                    "options": [
                        {"id": "a", "label": {"en": "A"}},
                        {"id": "b", "label": {"en": "B"}},
                    ],
                },
            }
        ],
    ):
        with pytest.raises(ValidationError):
            DraftFlowV2.model_validate({**base, "nodes": nodes})


def test_v2_publication_requires_nonempty_localized_text_and_schema():
    from sensibilia.flows import FlowV2

    flow = {
        "schema_version": 2,
        "languages": ["en"],
        "default_language": "en",
        "nodes": [
            {
                "id": str(uuid4()),
                "kind": "end",
                "title": {"en": "Finish"},
                "data": {"body": {}, "outcome": "completed"},
            }
        ],
    }
    assert DraftFlowV2.model_validate(flow)
    with pytest.raises(ValidationError):
        FlowV2.model_validate(flow)
    schema = FlowV2.model_json_schema()
    body = schema["$defs"]["EndData"]["properties"]["body"]
    assert body["minProperties"] == 1
    assert next(iter(body["patternProperties"].values()))["minLength"] == 1


def test_built_researcher_deep_links_are_scoped(client):
    from pathlib import Path

    if not (Path(__file__).resolve().parents[1] / "frontend" / "dist").is_dir():
        pytest.skip("Build frontend before deployment checks")
    for path in (
        "/researcher/methods",
        "/researcher/terminals",
        "/researcher/templates",
        "/researcher/studies/new",
        f"/researcher/studies/{uuid4()}/versions/{uuid4()}/flow",
    ):
        response = client.get(path)
        assert response.status_code == 200
        assert "/researcher/assets/" in response.text
    assert client.get("/researcher/assets/not-found.js").status_code == 404
    assert client.get("/researcher/unknown").status_code == 404
    assert client.get(f"/studies/{uuid4()}").status_code == 401


def test_upgrade_retains_existing_publication_and_values(tmp_path, monkeypatch):
    import json

    from alembic import command
    from alembic.config import Config

    from sensibilia.db import make_engine

    url = f"sqlite:///{(tmp_path / 'old.db').as_posix()}"
    monkeypatch.setenv("SENSIBILIA_DATABASE_URL", url)
    config = Config("alembic.ini")
    command.upgrade(config, "0003")
    engine = make_engine(url)
    form = json.dumps(
        {
            "schema_version": 1,
            "steps": [
                {
                    "kind": "test",
                    "id": "legacy-test",
                    "title": "Liking",
                    "study_test_id": "test",
                    "layout": "cards",
                    "route": {"condition": None, "then": "next", "otherwise": "next"},
                }
            ],
            "completion_message": "Thanks",
            "screen_out_message": "Ended",
        }
    )
    with engine.begin() as db:
        db.execute(text("INSERT INTO studies VALUES ('study','Old','', 'active','now')"))
        db.execute(
            text(
                "INSERT INTO study_versions VALUES ('version','study',1,'Old','','published',:form)"
            ),
            {"form": form},
        )
        db.execute(
            text(
                "INSERT INTO sessions VALUES "
                "('session','version','A','hash','[]','now',NULL,'in_progress')"
            )
        )
    command.upgrade(config, "head")
    with engine.begin() as db:
        assert db.scalar(text("SELECT form FROM study_versions WHERE id='version'")) == form
        assert db.scalar(text("SELECT revision FROM study_versions WHERE id='version'")) == 0
        assert db.scalar(text("SELECT context FROM sessions WHERE id='session'")) == "{}"
        assert db.scalar(text("PRAGMA foreign_keys")) == 1
        assert db.scalar(text("PRAGMA journal_mode")) == "wal"
        assert db.scalar(text("PRAGMA busy_timeout")) == 5000
        with pytest.raises(IntegrityError):
            db.execute(text("UPDATE study_versions SET form=NULL WHERE id='version'"))
    engine.dispose()


def test_method_step_scale_layout_is_a_display_setting_of_the_step(client, researcher_headers):
    """The layout lives on the flow step, so the frozen method configuration does not change."""
    h = researcher_headers
    study, version, test, flow, base = configured(client, h)
    method = flow["nodes"][0]
    saved = client.get(base, headers=h).json()
    for layout in ("vertical", "horizontal", "horizontal_ends", None):
        method["data"]["scale_layout"] = layout
        result = client.put(
            base + "/form", headers=h, json={"form": flow, "revision_hash": saved["revision_hash"]}
        )
        assert result.status_code == 200, (layout, result.text)
        saved = client.get(base, headers=h).json()
        assert saved["form"]["nodes"][0]["data"].get("scale_layout") == layout
    method["data"]["scale_layout"] = "diagonal"
    refused = client.put(
        base + "/form", headers=h, json={"form": flow, "revision_hash": saved["revision_hash"]}
    )
    assert refused.status_code == 422
    # The method configuration is untouched by any of this.
    tests = client.get(base + "/tests", headers=h).json()
    assert tests[0]["configuration"] == test["configuration"]
