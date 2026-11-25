"""The Windows portable launcher: settings, keys, backup, restore, tablet app."""

import socket
import sqlite3
import zipfile
from contextlib import closing

import pytest
from alembic import command
from alembic.config import Config

from sensibilia import operations, portable, tablet_app
from sensibilia.db import EXPECTED_REVISION

CERTIFICATE = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n"


@pytest.fixture
def layout(tmp_path, monkeypatch):
    """A portable folder with a space and a non-ASCII letter, with a migrated database in it."""
    root = tmp_path / "Lab Åsa" / "Sensibilia"
    root.mkdir(parents=True)
    paths = portable.paths(root, {})
    portable.prepare(paths)
    monkeypatch.setenv("SENSIBILIA_DATABASE_URL", portable.database_url(paths))
    command.upgrade(Config(str(operations.ROOT / "alembic.ini")), "head")
    return paths


def test_settings_file_ignores_comments_and_quotes(tmp_path):
    path = tmp_path / "settings.env"
    path.write_text(
        '\ufeff# note\n\nDEV_LAN_ADDRESS=192.168.1.20\nBACKUP_DIRECTORY = "E:\\Backups"\n',
        encoding="utf-8",
    )
    assert portable.read_settings(path) == {
        "DEV_LAN_ADDRESS": "192.168.1.20",
        "BACKUP_DIRECTORY": "E:\\Backups",
    }
    assert portable.read_settings(tmp_path / "missing.env") == {}


def test_lan_address_override_and_fallback(monkeypatch):
    assert portable.lan_address("10.0.0.5") == "10.0.0.5"

    class Offline:
        def __enter__(self):
            raise OSError("network unreachable")

        def __exit__(self, *args):
            return False

    monkeypatch.setattr(socket, "socket", lambda *args: Offline())
    assert portable.lan_address() == "127.0.0.1"


def test_keys_are_created_once_and_never_overwritten(tmp_path):
    path = tmp_path / "settings.env"
    path.write_text("DEV_LAN_ADDRESS=10.0.0.5\n", encoding="utf-8")
    shown = portable.make_keys(path)
    settings = portable.read_settings(path)
    assert settings["DEV_LAN_ADDRESS"] == "10.0.0.5"
    assert settings["DEV_RESEARCHER_KEY"] in shown and settings["DEV_OPERATOR_KEY"] in shown
    assert settings["DEV_RESEARCHER_KEY"] != settings["DEV_OPERATOR_KEY"]
    before = path.read_text(encoding="utf-8")
    assert portable.make_keys(path) is None
    assert path.read_text(encoding="utf-8") == before


def test_port_check_reports_a_busy_port():
    with socket.socket() as busy:
        busy.bind(("127.0.0.1", 0))
        busy.listen()
        port = busy.getsockname()[1]
        assert not portable.port_is_free(port)
    assert portable.port_is_free(port)


def test_caddy_environment_uses_forward_slashes_for_paths_with_spaces(layout):
    env = portable.caddy_environment(layout, "10.0.0.5")
    assert " " in env["SENSIBILIA_CA_ROOT"] and "\\" not in env["SENSIBILIA_CA_ROOT"]
    assert "\\" not in env["SENSIBILIA_TABLET_APP"]
    assert env["SENSIBILIA_UPSTREAM"] == f"127.0.0.1:{portable.API_PORT}"


def test_backup_is_verified_status_passes_and_signing_key_is_included(layout):
    with pytest.raises(portable.Problem):
        portable.backup_status(layout)
    tablet = layout["data"] / "tablet-app"
    tablet.mkdir()
    (tablet / "signing.p12").write_bytes(b"key")
    (tablet / "signing.pass").write_text("secret")
    archive = portable.run_backup(layout)
    assert operations.verify(archive)["revision"] == EXPECTED_REVISION
    assert portable.backup_status(layout)["backup"] == archive.name
    assert (layout["backups"] / "tablet-app-signing" / "signing.p12").read_bytes() == b"key"


def test_backup_without_a_database_says_so_in_plain_words(tmp_path):
    empty = portable.paths(tmp_path, {})
    with pytest.raises(portable.Problem, match="Start Sensibilia"):
        portable.run_backup(empty)


def test_restore_moves_current_data_aside_instead_of_deleting_it(layout):
    archive = portable.run_backup(layout)
    with closing(sqlite3.connect(layout["database"])) as db:
        db.execute("CREATE TABLE added_later (value TEXT)")
        db.commit()
    aside = portable.run_restore(layout, archive.name, stamp="test")
    assert aside == layout["data"] / "before-restore-test"
    with closing(sqlite3.connect(aside / "server" / "sensibilia.db")) as db:
        assert db.execute("SELECT count(*) FROM added_later").fetchone()[0] == 0
    with closing(sqlite3.connect(layout["database"])) as db:
        tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master")}
    assert "added_later" not in tables


@pytest.mark.parametrize("name", ["../x.db", "a\\b.db", "backup.json", ""])
def test_restore_refuses_a_name_that_is_not_a_backup_file(layout, name):
    with pytest.raises(portable.Problem):
        portable.run_restore(layout, name)


def test_restore_refuses_a_damaged_backup_before_touching_anything(layout):
    archive = portable.run_backup(layout)
    archive.write_bytes(b"damaged")
    with pytest.raises(ValueError):
        portable.run_restore(layout, archive.name)
    assert layout["database"].exists()
    assert not list(layout["data"].glob("before-restore-*"))


def test_firewall_rules_name_both_ports_and_private_networks_only():
    adds = [c for c in portable.firewall_rule_commands() if "add" in c]
    assert [c[-2] for c in adds] == ["localport=1379", "localport=1380"]
    assert all("profile=private" in c and "action=allow" in c for c in adds)


# --- tablet app ---------------------------------------------------------------------------------


def make_template(path, *, with_certificate=True):
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("AndroidManifest.xml", b"manifest", zipfile.ZIP_DEFLATED)
        archive.writestr("resources.arsc", b"arsc" * 10, zipfile.ZIP_STORED)
        archive.writestr("META-INF/CERT.RSA", b"old signature")
        archive.writestr("META-INF/CERT.SF", b"old signature")
        archive.writestr("META-INF/services/keep.me", b"keep")
        if with_certificate:
            archive.writestr(tablet_app.CA_ENTRY, b"placeholder")


def test_rebake_replaces_only_the_certificate_and_drops_the_old_signature(tmp_path):
    template, result = tmp_path / "template.apk", tmp_path / "unsigned.apk"
    make_template(template)
    tablet_app.replace_certificate(template, CERTIFICATE.encode(), result)
    with zipfile.ZipFile(result) as archive:
        names = archive.namelist()
        assert archive.read(tablet_app.CA_ENTRY) == CERTIFICATE.encode()
        assert archive.read("AndroidManifest.xml") == b"manifest"
        assert archive.read("META-INF/services/keep.me") == b"keep"
        assert not [n for n in names if n.endswith((".RSA", ".SF"))]
        assert archive.testzip() is None
        arsc = archive.getinfo("resources.arsc")
        assert arsc.compress_type == zipfile.ZIP_STORED
        assert arsc.header_offset + 30 + len(arsc.filename) + len(arsc.extra) & 3 == 0


def test_rebake_refuses_a_template_without_the_certificate_entry(tmp_path):
    template = tmp_path / "template.apk"
    make_template(template, with_certificate=False)
    with pytest.raises(ValueError, match="lab_ca"):
        tablet_app.replace_certificate(template, b"x", tmp_path / "out.apk")


def test_tablet_app_is_unavailable_without_a_template(tmp_path):
    certificate = tmp_path / "root.crt"
    certificate.write_text(CERTIFICATE)
    with pytest.raises(tablet_app.Unavailable):
        tablet_app.ensure(tmp_path / "app", tmp_path / "out", certificate)


def test_tablet_app_json_names_the_template_version_and_the_apk_checksum(tmp_path):
    import hashlib
    import json

    app, out = tmp_path / "app", tmp_path / "data" / "tablet-app"
    (app / "tablet-app").mkdir(parents=True)
    out.mkdir(parents=True)
    apk = out / tablet_app.APK_NAME
    apk.write_bytes(b"signed apk")
    # No template version (an older zip): no file, so tablets stay quiet.
    tablet_app.describe(app, apk)
    assert not (out / tablet_app.INFO_NAME).exists()
    assert tablet_app.published(out) is None
    (app / "tablet-app" / "template.json").write_text(
        json.dumps({"version_code": 4, "version_name": "0.1.3"})
    )
    tablet_app.describe(app, apk)
    info = json.loads((out / tablet_app.INFO_NAME).read_text())
    assert info == {
        "version_code": 4,
        "version_name": "0.1.3",
        "sha256": hashlib.sha256(b"signed apk").hexdigest(),
    }
    assert tablet_app.published(out) == {"version_code": 4, "version_name": "0.1.3"}
    assert tablet_app.published(None) is None
    # A broken template version removes the file rather than leaving a stale one.
    (app / "tablet-app" / "template.json").write_text("{")
    tablet_app.describe(app, apk)
    assert not (out / tablet_app.INFO_NAME).exists()


def test_tablet_app_version_is_read_from_the_user_agent():
    agent = "Mozilla/5.0 (Linux; Android 14) Chrome/131 Mobile SensibiliaTablet/4/0.1.3"
    assert tablet_app.reported(agent) == {"version_code": 4, "version_name": "0.1.3"}
    assert tablet_app.reported("Mozilla/5.0 Chrome/131") is None
    assert tablet_app.reported("SensibiliaTablet/x/0.1.3") is None
