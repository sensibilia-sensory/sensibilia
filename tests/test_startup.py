import pytest
from conftest import RESEARCHER_TOKEN
from fastapi.testclient import TestClient
from pydantic import ValidationError

from sensibilia.api import create_app
from sensibilia.config import Settings


def test_credentials_may_be_short_or_empty(monkeypatch):
    monkeypatch.delenv("SENSIBILIA_RESEARCHER_TOKEN", raising=False)
    assert Settings(_env_file=None).researcher_token.get_secret_value() == ""
    short = Settings(researcher_token="1234", operator_token="4321", _env_file=None)
    assert short.operator_token.get_secret_value() == "4321"
    with pytest.raises(ValidationError, match="differ"):
        Settings(researcher_token="1234", operator_token="1234", _env_file=None)
    assert (
        Settings(researcher_token="", operator_token="", _env_file=None).operator_token is not None
    )


def test_empty_researcher_key_needs_no_sign_in(database_url):
    settings = Settings(database_url=database_url, researcher_token="", _env_file=None)
    with TestClient(create_app(settings)) as open_client:
        assert open_client.get("/studies").status_code == 200
        assert open_client.get("/operator/dashboard").status_code == 401
    settings = Settings(
        database_url=database_url, researcher_token="", operator_token="", _env_file=None
    )
    with TestClient(create_app(settings)) as open_client:
        assert open_client.get("/operator/dashboard").status_code == 200


def test_startup_does_not_create_tables(tmp_path):
    settings = Settings(
        database_url=f"sqlite:///{(tmp_path / 'unmigrated.db').as_posix()}",
        researcher_token=RESEARCHER_TOKEN,
    )
    with (
        pytest.raises(RuntimeError, match="alembic upgrade head"),
        TestClient(create_app(settings)),
    ):
        pass
