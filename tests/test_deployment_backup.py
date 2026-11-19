import json
import sqlite3
from contextlib import closing
from pathlib import Path

import pytest
from conftest import RESEARCHER_TOKEN
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import text
from test_api import event, provision, study, submit

from sensibilia import operations
from sensibilia.api import create_app
from sensibilia.config import Settings
from sensibilia.db import EXPECTED_REVISION

RELEASE = "sensibilia@sha256:" + "1" * 64


def archive_dir(tmp_path):
    return tmp_path.parent / (tmp_path.name + "-archives")


def test_live_wal_restore_preserves_package_uuid_history_and_csv(
    client, researcher_headers, database_url, tmp_path
):
    data, test, version = study(client, researcher_headers, allow_skips=True)
    session, headers = provision(client, researcher_headers, version)
    first = event(test, value={"state": "skipped"})
    second = event(test, supersedes_event_id=first["client_event_id"])
    assert submit(client, session, headers, [first, second]).status_code == 200
    package = client.get(f"/sessions/{session['id']}/test", headers=headers).json()
    exported = client.get(f"/studies/{data['id']}/export", headers=researcher_headers).text
    source = operations.database_path(database_url)
    with closing(sqlite3.connect(source)) as writer:
        writer.execute("PRAGMA wal_autocheckpoint=0")
        writer.execute("CREATE TABLE backup_probe (value TEXT)")
        writer.execute("INSERT INTO backup_probe VALUES ('committed in WAL')")
        writer.commit()
        assert Path(str(source) + "-wal").stat().st_size > 0
        archive = operations.backup(source, archive_dir(tmp_path), RELEASE)
    receipt = operations.verify(archive)
    assert receipt["revision"] == EXPECTED_REVISION
    assert receipt["table_counts"]["responses"] == 2
    target = tmp_path / "restored" / "lab.db"
    operations.restore(archive, target, RELEASE)
    with closing(sqlite3.connect(target)) as db:
        assert db.execute("SELECT value FROM backup_probe").fetchone()[0] == "committed in WAL"
    with TestClient(
        create_app(
            Settings(
                database_url=f"sqlite:///{target.as_posix()}", researcher_token=RESEARCHER_TOKEN
            )
        )
    ) as restored:
        assert restored.get(f"/sessions/{session['id']}/test", headers=headers).json() == package
        assert (
            restored.get(f"/studies/{data['id']}/export", headers=researcher_headers).text
            == exported
        )
        assert [
            ack["status"]
            for ack in submit(restored, session, headers, [first, second]).json()["events"]
        ] == ["duplicate", "duplicate"]
        assert (
            restored.get(f"/studies/{data['id']}/export", headers=researcher_headers).text
            == exported
        )


def test_restore_refuses_overwrite_wrong_release_and_corrupt_archive(database_url, tmp_path):
    source = operations.database_path(database_url)
    archive = operations.backup(source, archive_dir(tmp_path), RELEASE)
    with pytest.raises(ValueError, match="matching release"):
        operations.restore(archive, tmp_path / "restore.db", "other")
    with pytest.raises(ValueError, match="fresh"):
        operations.restore(archive, source, RELEASE)
    with archive.open("ab") as stream:
        stream.write(b"corruption")
    with pytest.raises(ValueError, match="checksum"):
        operations.restore(archive, tmp_path / "restore.db", RELEASE)
    assert not (tmp_path / "restore.db").exists()


def test_failed_backup_blocks_migration(database_url, tmp_path, monkeypatch):
    def failed(*_args, **_kwargs):
        raise OSError("backup target unavailable")

    def unexpected(*_args, **_kwargs):
        pytest.fail("Migration ran without a verified backup")

    monkeypatch.setattr(operations, "backup", failed)
    monkeypatch.setattr(operations.command, "upgrade", unexpected)
    with pytest.raises(OSError):
        operations.migrate(database_url, archive_dir(tmp_path), RELEASE, app_stopped=True)


def test_failed_migration_retains_verified_preupgrade_backup(database_url, tmp_path, monkeypatch):
    def failed(*_args, **_kwargs):
        raise RuntimeError("synthetic migration failure")

    monkeypatch.setattr(operations.command, "upgrade", failed)
    with pytest.raises(RuntimeError):
        operations.migrate(database_url, archive_dir(tmp_path), RELEASE, app_stopped=True)
    archives = list(archive_dir(tmp_path).glob("*.db"))
    assert len(archives) == 1
    assert operations.verify(archives[0])["revision"] == EXPECTED_REVISION
    assert (
        operations.inspect_database(operations.database_path(database_url))["revision"]
        == EXPECTED_REVISION
    )


def test_explicit_initialise_then_upgrade_never_initialises_existing_db(tmp_path):
    url = f"sqlite:///{(tmp_path / 'live' / 'new.db').as_posix()}"
    with pytest.raises(ValueError, match="Stop"):
        operations.migrate(url, tmp_path / "archives", RELEASE, app_stopped=False, initialize=True)
    operations.migrate(url, tmp_path / "archives", RELEASE, app_stopped=True, initialize=True)
    with pytest.raises(ValueError, match="fresh"):
        operations.migrate(url, tmp_path / "archives", RELEASE, app_stopped=True, initialize=True)
    operations.migrate(url, tmp_path / "archives", RELEASE, app_stopped=True)
    assert len(list((tmp_path / "archives").glob("*.db"))) == 1


def test_backup_refuses_missing_source_live_directory_and_invalid_fk(database_url, tmp_path):
    source = operations.database_path(database_url)
    with pytest.raises(ValueError, match="outside"):
        operations.backup(source, source.parent, RELEASE)
    with pytest.raises(sqlite3.OperationalError):
        operations.backup(tmp_path / "absent.db", archive_dir(tmp_path), RELEASE)
    with closing(sqlite3.connect(source)) as db:
        db.execute("CREATE TABLE broken (id INTEGER REFERENCES studies(id))")
        db.execute("INSERT INTO broken VALUES (999)")
        db.commit()
    with pytest.raises(ValueError, match="foreign key"):
        operations.backup(source, archive_dir(tmp_path), RELEASE)
    assert not list(archive_dir(tmp_path).glob("*.db"))
    assert not (archive_dir(tmp_path) / "last-success.json").exists()


def test_backup_status_stale_failure_and_secret_safe_cli(database_url, tmp_path, capsys):
    destination = archive_dir(tmp_path)
    archive = operations.backup(operations.database_path(database_url), destination, RELEASE)
    assert operations.main(["status", "--destination", str(destination)]) == 0
    capsys.readouterr()
    assert (
        operations.main(["status", "--destination", str(destination), "--max-age-hours", "0"]) == 1
    )
    assert "stopped" in capsys.readouterr().err
    receipt = json.loads(archive.with_suffix(".json").read_text())
    assert json.loads((destination / "last-success.json").read_text()) == receipt
    assert (
        operations.main(
            [
                "--database-url",
                "sqlite:///no-such/secret-value.db",
                "--release",
                RELEASE,
                "backup",
                "--destination",
                str(destination),
            ]
        )
        == 1
    )
    assert "secret-value" not in capsys.readouterr().err


def test_health_rechecks_revision_after_startup(client):
    assert client.get("/health").json() == {"status": "ok"}
    with client.app.state.engine.begin() as db:
        db.execute(text("INSERT INTO alembic_version (version_num) VALUES ('extra')"))
    assert client.get("/health").status_code == 503
    with client.app.state.engine.begin() as db:
        db.execute(text("DELETE FROM alembic_version WHERE version_num='extra'"))
        db.execute(text("UPDATE alembic_version SET version_num='wrong'"))
    assert client.get("/health").status_code == 503
    with client.app.state.engine.begin() as db:
        db.execute(text("DROP TABLE alembic_version"))
    assert client.get("/health").status_code == 503


def test_secret_file_settings_support_env_without_disclosing_value(tmp_path, monkeypatch):
    monkeypatch.delenv("SENSIBILIA_RESEARCHER_TOKEN", raising=False)
    credential = tmp_path / "credential"
    credential.write_text(RESEARCHER_TOKEN + "\n")
    monkeypatch.setenv("SENSIBILIA_RESEARCHER_TOKEN_FILE", str(credential))
    settings = Settings(_env_file=None)
    assert settings.researcher_token.get_secret_value() == RESEARCHER_TOKEN
    assert RESEARCHER_TOKEN not in repr(settings)
    with pytest.raises(ValidationError, match="not both"):
        Settings(researcher_token=RESEARCHER_TOKEN, _env_file=None)
    credential.write_text("short")
    assert Settings(_env_file=None).researcher_token.get_secret_value() == "short"
    credential.unlink()
    with pytest.raises(ValidationError, match="Cannot read"):
        Settings(_env_file=None)


def test_operator_secret_file_loads_and_must_differ(tmp_path, monkeypatch):
    monkeypatch.delenv("SENSIBILIA_OPERATOR_TOKEN", raising=False)
    credential = tmp_path / "operator"
    credential.write_text("operator-token-" + "y" * 32 + "\n")
    monkeypatch.setenv("SENSIBILIA_OPERATOR_TOKEN_FILE", str(credential))
    settings = Settings(researcher_token=RESEARCHER_TOKEN, _env_file=None)
    assert settings.operator_token.get_secret_value() == "operator-token-" + "y" * 32
    credential.write_text(RESEARCHER_TOKEN)
    with pytest.raises(ValidationError, match="must differ"):
        Settings(researcher_token=RESEARCHER_TOKEN, _env_file=None)


def test_compose_mounts_both_role_secrets_into_app(tmp_path):
    import shutil
    import subprocess

    if (
        not shutil.which("docker")
        or subprocess.run(["docker", "compose", "version"], capture_output=True).returncode
    ):
        pytest.skip("Docker Compose v2 unavailable")
    files = {}
    for name in ("researcher", "operator", "certificate", "key"):
        files[name] = tmp_path / name
        files[name].write_text("placeholder")
    configuration = tmp_path / "lab.env"
    configuration.write_text(
        "\n".join(
            [
                f"APP_IMAGE={RELEASE}",
                "TLS_IMAGE=caddy@sha256:" + "2" * 64,
                "LAB_INTERFACE=127.0.0.1",
                "LAB_HOSTNAME=sensory.test",
                f"BACKUP_DIRECTORY={tmp_path.as_posix()}",
                f"RESEARCHER_TOKEN_FILE={files['researcher'].as_posix()}",
                f"OPERATOR_TOKEN_FILE={files['operator'].as_posix()}",
                f"TLS_CERTIFICATE_FILE={files['certificate'].as_posix()}",
                f"TLS_KEY_FILE={files['key'].as_posix()}",
                "PROXY_SUBNET=172.28.99.0/29",
                "TLS_PROXY_IP=172.28.99.2",
            ]
        )
    )
    compose = ["docker", "compose", "-f", str(operations.ROOT / "compose.yaml")]
    rendered = subprocess.run(
        [*compose, "--env-file", str(configuration), "config", "--format", "json"],
        capture_output=True,
        text=True,
    )
    assert rendered.returncode == 0, rendered.stderr
    app = json.loads(rendered.stdout)["services"]["app"]
    assert {secret["source"] for secret in app["secrets"]} == {"researcher_token", "operator_token"}
    assert app["environment"]["SENSIBILIA_OPERATOR_TOKEN_FILE"] == "/run/secrets/operator_token"

    configuration.write_text(
        configuration.read_text().replace(f"OPERATOR_TOKEN_FILE={files['operator'].as_posix()}", "")
    )
    missing = subprocess.run(
        [*compose, "--env-file", str(configuration), "config"], capture_output=True, text=True
    )
    assert missing.returncode != 0
    assert "operator token file" in missing.stderr


@pytest.mark.parametrize("failure", ["backup-or-migration", "stop-verification"])
def test_staff_upgrade_failure_never_restarts_collection(monkeypatch, failure):
    import importlib.util
    from types import SimpleNamespace

    spec = importlib.util.spec_from_file_location(
        "laboratory", operations.ROOT / "scripts" / "laboratory.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    calls = []

    def execute(args, *, capture=False):
        calls.append(args)
        if "--format" in args:
            return SimpleNamespace(
                stdout=json.dumps(
                    {
                        "services": {
                            "app": {"image": RELEASE},
                            "tls": {"image": "caddy@sha256:" + "2" * 64},
                        }
                    }
                )
            )
        if "ps" in args:
            return SimpleNamespace(stdout="still-running" if failure == "stop-verification" else "")
        if "run" in args:
            raise OSError("synthetic maintenance failure")
        return SimpleNamespace(stdout="")

    monkeypatch.setattr(module, "execute", execute)
    with pytest.raises((ValueError, OSError)):
        module.perform(["docker", "compose"], "upgrade", previous_release=RELEASE)
    assert any("stop" in call for call in calls)
    assert not any("up" in call for call in calls)
    if failure == "stop-verification":
        assert not any("run" in call for call in calls)
    else:
        maintenance = next(call for call in calls if "run" in call)
        assert maintenance[maintenance.index("--release") + 1] == RELEASE


def test_installed_release_root_serves_scoped_static_assets(client, tmp_path):
    root = tmp_path / "installed-release"
    frontend = root / "frontend" / "dist"
    (frontend / "assessor").mkdir(parents=True)
    (frontend / "index.html").write_text("release shell")
    (frontend / "assessor" / "sw.js").write_text("// release worker")
    settings = Settings(
        root=root,
        database_url=client.app.state.settings.database_url,
        researcher_token=RESEARCHER_TOKEN,
    )
    with TestClient(create_app(settings)) as deployed:
        assert deployed.get("/researcher/studies/id/versions/id/flow").text == "release shell"
        assert deployed.get("/assessor/sessions/id").text == "release shell"
        worker = deployed.get("/assessor/sw.js")
        assert worker.text == "// release worker"
        assert worker.headers["Cache-Control"] == "no-cache"
        assert deployed.get("/studies/missing").status_code == 401
        assert deployed.get("/researcher/nonexistent.js").status_code == 404


def test_retention_keeps_hour_day_month_and_preupgrade_records(tmp_path):
    destination = tmp_path / "archives"
    destination.mkdir()
    # Receipt selection tested independently of expensive backups; verification is real elsewhere.
    records = []
    for index in range(60):
        path = destination / f"{index:03}.db"
        path.write_bytes(b"test archive")
        path.with_suffix(".json").write_text("{}")
        records.append(
            (path, {"created_at": f"2026-10-11T12:{index:02}:00+00:00", "purpose": "scheduled"})
        )
    records[0][1]["purpose"] = "pre-upgrade"
    from unittest.mock import patch

    with patch.object(
        operations, "verify", side_effect=lambda path: next(r for p, r in records if p == path)
    ):
        assert operations.retain(destination) == 58
    assert records[0][0].exists()
    assert records[-1][0].exists()


def test_backup_deadline_cleans_unfinished_copy(database_url, tmp_path):
    destination = archive_dir(tmp_path)
    with pytest.raises(TimeoutError):
        operations.backup(operations.database_path(database_url), destination, RELEASE, timeout=-1)
    assert not list(destination.glob("*.db"))
    assert not list(destination.glob("*.tmp"))
    assert not (destination / "last-success.json").exists()
