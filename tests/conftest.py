from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient

from sensibilia.api import create_app
from sensibilia.config import Settings

RESEARCHER_TOKEN = "test-researcher-token-" + "x" * 32
ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def database_url(tmp_path, monkeypatch):
    url = f"sqlite:///{(tmp_path / 'test.db').as_posix()}"
    monkeypatch.setenv("SENSIBILIA_DATABASE_URL", url)
    config = Config(str(ROOT / "alembic.ini"))
    command.upgrade(config, "head")
    return url


@pytest.fixture
def client(database_url):
    # Analysis jobs are run explicitly in tests (scheduler.run_one), never by a background thread.
    settings = Settings(
        database_url=database_url, researcher_token=RESEARCHER_TOKEN, analysis_runner=False
    )
    with TestClient(create_app(settings)) as test_client:
        yield test_client


@pytest.fixture
def researcher_headers():
    return {"Authorization": f"Bearer {RESEARCHER_TOKEN}"}
