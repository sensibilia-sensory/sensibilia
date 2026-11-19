import re
from pathlib import Path

import pytest
from test_api import configuration, provision, study

from sensibilia.methods import DEFAULT_LABELS


def test_study_browsing_requires_researcher_auth_and_supports_search(client, researcher_headers):
    assert client.get("/studies").status_code == 401
    first = client.post(
        "/studies", headers=researcher_headers, json={"title": "Oat acceptance"}
    ).json()
    second = client.post(
        "/studies", headers=researcher_headers, json={"title": "Tea preferences"}
    ).json()
    rows = client.get("/studies", headers=researcher_headers).json()
    assert [row["id"] for row in rows] == [second["id"], first["id"]]
    assert rows[0]["versions"][0]["version_number"] == 1
    filtered = client.get("/studies?search=OAT", headers=researcher_headers).json()
    assert [row["id"] for row in filtered] == [first["id"]]
    assert client.get("/studies?search=%25", headers=researcher_headers).json() == []
    assert (
        client.get("/studies?limit=1&offset=1", headers=researcher_headers).json()[0]["id"]
        == first["id"]
    )


def test_metadata_edits_update_only_current_draft(client, researcher_headers):
    data, _, version = study(client, researcher_headers)
    session, headers = provision(client, researcher_headers, version)
    path = f"/studies/{data['id']}"
    changed = {"title": "Updated title", "description": "New purpose"}
    assert client.patch(path, headers=researcher_headers, json=changed).status_code == 409
    client.post(f"{path}/drafts", headers=researcher_headers)
    result = client.patch(path, headers=researcher_headers, json=changed)
    assert result.status_code == 200
    assert result.json()["title"] == changed["title"]
    assert result.json()["versions"][0]["title"] == "Acceptance"
    assert result.json()["versions"][1]["title"] == changed["title"]
    package = client.get(f"/sessions/{session['id']}/test", headers=headers).json()
    assert package["study_version"]["title"] == "Acceptance"
    assert client.patch(path, headers=headers, json=changed).status_code == 401


def test_removing_draft_test_compacts_positions_and_preserves_publication(
    client, researcher_headers
):
    data, published_test, version = study(client, researcher_headers)
    path = f"/studies/{data['id']}"
    assert (
        client.delete(
            f"{path}/tests/{published_test['id']}", headers=researcher_headers
        ).status_code
        == 409
    )
    draft = client.post(f"{path}/drafts", headers=researcher_headers).json()
    original = client.get(
        f"{path}/versions/{draft['id']}/tests", headers=researcher_headers
    ).json()[0]
    added = []
    for _ in range(3):
        added.append(
            client.post(
                f"{path}/tests", headers=researcher_headers, json={"configuration": configuration()}
            ).json()
        )
    assert (
        client.delete(f"{path}/tests/{original['id']}", headers=researcher_headers).status_code
        == 204
    )
    remaining = client.get(
        f"{path}/versions/{draft['id']}/tests", headers=researcher_headers
    ).json()
    assert [test["id"] for test in remaining] == [test["id"] for test in added]
    assert [test["position"] for test in remaining] == [0, 1, 2]
    last = client.post(
        f"{path}/tests", headers=researcher_headers, json={"configuration": configuration()}
    ).json()
    assert last["position"] == 3
    frozen = client.get(f"{path}/versions/{version['id']}/tests", headers=researcher_headers).json()
    assert frozen[0]["id"] == published_test["id"]
    assert (
        client.delete(
            f"{path}/tests/{published_test['id']}", headers=researcher_headers
        ).status_code
        == 409
    )


def test_ui_scale_defaults_come_from_the_method_implementation(client, researcher_headers):
    method = client.get("/test-types/hedonic-9-v1", headers=researcher_headers).json()
    assert method["default_scale_labels"] == DEFAULT_LABELS


@pytest.mark.skipif(
    not (Path(__file__).resolve().parents[1] / "frontend" / "dist").is_dir(),
    reason="Build the frontend first to check the compiled same-origin GUI",
)
def test_built_researcher_gui_and_assets_are_served(client):
    response = client.get("/researcher/")
    assert response.status_code == 200
    assert "Researcher workspace" in response.text
    assets = re.findall(r'(?:src|href)="(/researcher/assets/[^\"]+)"', response.text)
    assert assets
    for route in ("/researcher/rooms", "/operator", "/operator/"):
        linked = client.get(route)
        assert linked.status_code == 200
        assert linked.text == response.text
        assert linked.headers["Cache-Control"] == "no-cache"
    for asset in assets:
        assert client.get(asset).status_code == 200
