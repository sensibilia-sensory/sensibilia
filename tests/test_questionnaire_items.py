"""The questionnaire item bank: copied, archived, never deleted."""

from pathlib import Path
from uuid import uuid4

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect, text
from test_flow_guards import node, question

from sensibilia.db import EXPECTED_REVISION, make_engine


def payload(step, name="Consent statement"):
    return {"name": name, "languages": ["en"], "default_language": "en", "node": step}


def consent():
    return node(
        "consent",
        {
            "body": {"en": "I agree to take part."},
            "accept_label": {"en": "I agree"},
            "decline_label": {"en": "I do not agree"},
        },
    )


def test_items_are_saved_listed_archived_and_never_deleted(client, researcher_headers):
    h = researcher_headers
    assert client.get("/questionnaire-items").status_code == 401
    assert client.post("/questionnaire-items", json=payload(consent())).status_code == 401
    created = client.post("/questionnaire-items", headers=h, json=payload(consent()))
    assert created.status_code == 201, created.text
    item = created.json()
    assert item["kind"] == "consent" and item["archived_at"] is None
    assert item["principal"].startswith("researcher-key:")
    assert item["node"]["data"]["accept_label"] == {"en": "I agree"}
    other = client.post("/questionnaire-items", headers=h, json=payload(question(), "Allergies"))
    assert other.status_code == 201, other.text
    names = [i["name"] for i in client.get("/questionnaire-items", headers=h).json()]
    assert sorted(names) == ["Allergies", "Consent statement"]
    archived = client.post(f"/questionnaire-items/{item['id']}/archive", headers=h)
    assert archived.status_code == 200 and archived.json()["archived_at"]
    again = client.post(f"/questionnaire-items/{item['id']}/archive", headers=h).json()
    assert again["archived_at"] == archived.json()["archived_at"]  # archiving twice changes nothing
    shown = client.get("/questionnaire-items", headers=h).json()
    assert [i["name"] for i in shown] == ["Allergies"]
    everything = client.get("/questionnaire-items?include_archived=true", headers=h).json()
    assert len(everything) == 2  # archived items stay readable
    # There is no delete route: nothing the application collects is deleted.
    assert client.delete(f"/questionnaire-items/{item['id']}", headers=h).status_code in (404, 405)
    assert len(client.get("/questionnaire-items?include_archived=true", headers=h).json()) == 2
    assert client.post(f"/questionnaire-items/{uuid4()}/archive", headers=h).status_code == 404


def test_only_ordinary_valid_steps_can_be_saved(client, researcher_headers):
    h = researcher_headers
    method = node(
        "embedded_method",
        {"study_test_id": str(uuid4()), "sample_binding": "none"},
    )
    loop = node("loop_samples", {"sample_ids": [], "children": [consent()]})
    for step in (method, loop, node("group", {"children": [method]})):
        refused = client.post("/questionnaire-items", headers=h, json=payload(step))
        assert refused.status_code == 422, (step["kind"], refused.text)
    broken = consent()
    broken["data"]["accept_label"] = 5
    assert client.post("/questionnaire-items", headers=h, json=payload(broken)).status_code == 422
    unknown = payload(consent()) | {"unexpected": True}
    assert client.post("/questionnaire-items", headers=h, json=unknown).status_code == 422
    assert (
        client.post("/questionnaire-items", headers=h, json=payload(consent(), "")).status_code
        == 422
    )
    # A group of ordinary steps is fine, and so is a language the step is written in.
    group = node("group", {"children": [consent(), question()]})
    assert client.post("/questionnaire-items", headers=h, json=payload(group)).status_code == 201
    assert client.get("/questionnaire-items", headers=h).json()[0]["kind"] == "group"
    assert not client.get("/questionnaire-items", headers=h, params={"limit": 0}).is_success


def test_upgrade_0017_adds_the_bank_and_downgrade_removes_only_it(tmp_path, monkeypatch):
    root = Path(__file__).resolve().parents[1]
    url = f"sqlite:///{(tmp_path / 'bank.db').as_posix()}"
    monkeypatch.setenv("SENSIBILIA_DATABASE_URL", url)
    config = Config(str(root / "alembic.ini"))
    command.upgrade(config, "0016")
    engine = make_engine(url)
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO studies (id,title,description,status,created_at) "
                "VALUES ('s','Keep me','','draft','2026-10-10')"
            )
        )
    assert "questionnaire_items" not in inspect(engine).get_table_names()
    command.upgrade(config, "head")
    with engine.connect() as connection:
        assert (
            connection.scalar(text("SELECT version_num FROM alembic_version")) == EXPECTED_REVISION
        )
        assert connection.scalar(text("SELECT title FROM studies")) == "Keep me"
        assert connection.scalar(text("SELECT count(*) FROM questionnaire_items")) == 0
    command.downgrade(config, "0016")
    assert "questionnaire_items" not in inspect(engine).get_table_names()
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT title FROM studies")) == "Keep me"
    engine.dispose()
