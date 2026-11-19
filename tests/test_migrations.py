import json
from pathlib import Path
from uuid import uuid4

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect, text

from sensibilia.db import make_engine
from sensibilia.methods import HedonicConfiguration


def test_migration_roundtrip_and_model_consistency(database_url):
    root = Path(__file__).resolve().parents[1]
    config = Config(str(root / "alembic.ini"))
    command.check(config)
    command.downgrade(config, "base")
    engine = make_engine(database_url)
    assert "responses" not in inspect(engine).get_table_names()
    engine.dispose()
    command.upgrade(config, "head")
    engine = make_engine(database_url)
    try:
        with engine.connect() as connection:
            schema = connection.scalar(text("SELECT configuration_schema FROM test_types"))
        assert json.loads(schema) == HedonicConfiguration.model_json_schema()
    finally:
        engine.dispose()


def test_form_migration_preserves_legacy_publication_and_observations(database_url):
    """Exercise the upgrade with actual data and active immutability triggers."""
    root = Path(__file__).resolve().parents[1]
    config = Config(str(root / "alembic.ini"))
    command.downgrade(config, "0001")
    ids = {
        key: str(uuid4()) for key in ("study", "version", "test", "session", "response", "event")
    }
    engine = make_engine(database_url)
    with engine.begin() as connection:
        connection.execute(
            text("INSERT INTO studies VALUES (:study,'Legacy','Original','active','now')"), ids
        )
        connection.execute(
            text("INSERT INTO study_versions VALUES (:version,:study,1,'Legacy','Original',NULL)"),
            ids,
        )
        connection.execute(
            text("INSERT INTO study_tests VALUES (:test,:version,'hedonic-9-v1',0,:configuration)"),
            {
                **ids,
                "configuration": json.dumps(
                    {
                        "instructions": "Taste and rate.",
                        "questions": [{"id": "overall", "prompt": "Liking"}],
                    }
                ),
            },
        )
        connection.execute(
            text("UPDATE study_versions SET published_at='now' WHERE id=:version"), ids
        )
        connection.execute(
            text(
                "INSERT INTO sessions VALUES "
                "(:session,:version,'A001','legacy-hash',:order,'now',NULL,'in_progress')"
            ),
            {**ids, "order": json.dumps([ids["test"]])},
        )
        connection.execute(
            text(
                "INSERT INTO responses VALUES "
                "(:response,:session,:test,NULL,'overall',:value,'now','now',:event,NULL)"
            ),
            {**ids, "value": json.dumps({"state": "rated", "rating": 7})},
        )
    engine.dispose()
    command.upgrade(config, "head")
    engine = make_engine(database_url)
    try:
        with engine.connect() as connection:
            version = connection.execute(
                text("SELECT title, published_at, form FROM study_versions WHERE id=:version"), ids
            ).one()
            assert version == ("Legacy", "now", None)
            assert (
                connection.scalar(
                    text("SELECT client_event_id FROM responses WHERE id=:response"), ids
                )
                == ids["event"]
            )
            assert connection.scalar(text("SELECT count(*) FROM form_events")) == 0
            assert connection.execute(text("PRAGMA foreign_key_check")).all() == []
    finally:
        engine.dispose()
