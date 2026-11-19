"""Image ownership, byte integrity, publication freeze and backup reconciliation."""

import base64
import hashlib
import struct
import zlib
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from test_flow_guards import node

from sensibilia import operations
from sensibilia.assets import MAX_BODY, png_dimensions, storage_path


def png(rgb=b"\xff\x00\x00", width=1, height=1):
    def chunk(kind, data):
        return (
            struct.pack(">I", len(data))
            + kind
            + data
            + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
        )

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(b"\x00" + rgb))
        + chunk(b"IEND", b"")
    )


def draft(client, h):
    study = client.post("/studies", headers=h, json={"title": "Images"}).json()
    version = study["versions"][0]
    base = f"/studies/{study['id']}/versions/{version['id']}"
    test = client.post(
        f"/studies/{study['id']}/tests",
        headers=h,
        json={
            "configuration": {
                "instructions": "Taste",
                "questions": [{"id": "liking", "prompt": "Liking"}],
            }
        },
    ).json()
    # Reuse the code-owned default hedonic shape rather than inventing a method.
    assert "id" in test, test
    info = node(
        "info", {"body": {"en": "Look"}, "continue_label": {"en": "Continue"}, "asset_ids": []}
    )
    method = node("embedded_method", {"study_test_id": test["id"], "sample_binding": "none"})
    end = node("end", {"body": {"en": "Done"}, "outcome": "completed"})
    form = dict(
        schema_version=2, languages=["en"], default_language="en", nodes=[info, method, end]
    )
    save(client, h, base, form)
    return study, version, base, form


def save(client, h, base, form):
    revision = client.get(base, headers=h).json()["revision_hash"]
    return client.put(base + "/form", headers=h, json={"form": form, "revision_hash": revision})


def upload(client, h, base, content=None, **kwargs):
    payload = dict(
        revision_hash=client.get(base, headers=h).json()["revision_hash"],
        name="Reviewed stimulus",
        alt_text={"en": "Red square"},
        content_base64=base64.b64encode(content or png()).decode(),
    )
    payload.update(kwargs)
    return client.post(base + "/assets", headers=h, json=payload)


def publish(client, h, study, version):
    base = f"/studies/{study['id']}/versions/{version['id']}"
    report = client.get(base + "/validation", headers=h).json()
    assert report["valid"], report
    return client.post(
        f"/studies/{study['id']}/publish",
        headers=h,
        json={
            "study_version_id": version["id"],
            "revision_hash": report["revision_hash"],
            "acknowledged_warning_codes": [
                i["code"] for i in report["issues"] if i["severity"] == "warning"
            ],
        },
    )


def test_asset_manifest_hash_freeze_session_scope_and_clone(client, researcher_headers):
    h = researcher_headers
    study, version, base, form = draft(client, h)
    before = client.get(base, headers=h).json()["revision_hash"]
    result = upload(client, h, base)
    assert result.status_code == 201, result.text
    asset = result.json()
    assert asset["sha256"] == hashlib.sha256(png()).hexdigest()
    assert (asset["byte_size"], asset["width"], asset["height"]) == (len(png()), 1, 1)
    assert client.get(base, headers=h).json()["revision_hash"] != before
    assert upload(client, h, base, revision_hash=before).status_code == 409
    unused = upload(client, h, base, png(b"\x00\xff\x00")).json()
    form["nodes"][0]["data"]["asset_ids"] = [asset["id"]]
    assert save(client, h, base, form).status_code == 200
    assert publish(client, h, study, version).status_code == 200
    frozen = client.get(base, headers=h).json()
    assert upload(client, h, base).status_code == 409
    assert client.get(base + "/assets/" + asset["id"] + "/content", headers=h).content == png()
    assert client.get(base + "/assets/" + asset["id"] + "/content").status_code == 401
    session = client.post(
        "/sessions", headers=h, json={"study_version_id": version["id"], "assessor_code": "I"}
    ).json()
    token = {"Authorization": "Bearer " + session["session_token"]}
    url = f"/sessions/{session['id']}"
    package = client.get(url + "/test", headers=token).json()
    assert package["evaluator_version"] == "assets-v2.10"
    assert len(package["assets"]) == 1
    assert "name" not in package["assets"][0]
    assert client.get(package["assets"][0]["url"], headers=token).content == png()
    assert client.get(package["assets"][0]["url"]).status_code == 401
    assert client.get(url + "/assets/" + unused["sha256"], headers=token).status_code == 404
    assert client.get(url + "/assets/" + "0" * 64, headers=token).status_code == 404
    assert client.get(url + "/assets/../file", headers=token).status_code == 404
    cloned = client.post(f"/studies/{study['id']}/drafts", headers=h, json={}).json()
    assets = client.get(f"/studies/{study['id']}/versions/{cloned['id']}/assets", headers=h).json()
    reference = cloned["form"]["nodes"][0]["data"]["asset_ids"][0]
    assert reference != asset["id"]
    assert next(a for a in assets if a["id"] == reference)["sha256"] == asset["sha256"]
    assert client.get(base, headers=h).json() == frozen
    assert client.get(url + "/test", headers=token).json() == package


@pytest.mark.parametrize(
    "content",
    [b"<svg/>", b"not an image", png()[:-1], png() + b"trailing", png().replace(b"IDAT", b"acTL")],
)
def test_invalid_image_upload_retains_revision(client, researcher_headers, content):
    _, _, base, _ = draft(client, researcher_headers)
    before = client.get(base, headers=researcher_headers).json()
    assert upload(client, researcher_headers, base, content).status_code == 422
    assert client.get(base, headers=researcher_headers).json() == before
    assert client.get(base + "/assets", headers=researcher_headers).json() == []


def test_asset_ownership_alt_text_auth_and_limits(client, researcher_headers):
    h = researcher_headers
    _, _, base, form = draft(client, h)
    _, _, foreign, _ = draft(client, h)
    asset = upload(client, h, base).json()
    assert client.get(foreign + "/assets/" + asset["id"] + "/content", headers=h).status_code == 404
    foreign_form = client.get(foreign, headers=h).json()["form"]
    foreign_form["nodes"][0]["data"]["asset_ids"] = [asset["id"]]
    assert save(client, h, foreign, foreign_form).status_code == 422
    assert client.post(base + "/assets", json={}).status_code == 401
    assert upload(client, h, base, alt_text={"sv": "Bild"}).status_code == 422
    assert upload(client, h, base, alt_text={"en": " "}).status_code == 422
    assert upload(client, h, base, content_base64="!").status_code == 422
    assert (
        client.post(
            base + "/assets",
            headers={**h, "Content-Type": "application/json"},
            content=b" " * (MAX_BODY + 1),
        ).status_code
        == 413
    )
    form["languages"] = ["en", "sv"]
    for n in form["nodes"]:
        n["title"]["sv"] = n["title"]["en"]
        for k in ("body", "continue_label"):
            if k in n["data"]:
                n["data"][k]["sv"] = n["data"][k]["en"]
    form["nodes"][0]["data"]["asset_ids"] = [asset["id"]]
    assert save(client, h, base, form).status_code == 200
    report = client.get(base + "/validation", headers=h).json()
    assert any(i["code"] == "asset_text" for i in report["issues"])


@pytest.mark.parametrize("damage", ["missing", "changed"])
def test_unavailable_stimulus_blocks_publish_and_download(client, researcher_headers, damage):
    study, version, base, form = draft(client, researcher_headers)
    asset = upload(client, researcher_headers, base).json()
    form["nodes"][0]["data"]["asset_ids"] = [asset["id"]]
    save(client, researcher_headers, base, form)
    target = storage_path(client.app.state.settings) / asset["sha256"]
    if damage == "missing":
        target.unlink()
    else:
        target.write_bytes(b"altered")
    assert publish(client, researcher_headers, study, version).status_code == 503
    assert (
        client.get(
            base + "/assets/" + asset["id"] + "/content", headers=researcher_headers
        ).status_code
        == 503
    )
    assert client.get(base, headers=researcher_headers).json()["published_at"] is None


def test_asset_history_database_triggers(client, researcher_headers):
    _, version, base, _ = draft(client, researcher_headers)
    asset = upload(client, researcher_headers, base).json()
    for statement in (
        "UPDATE assets SET name='changed'",
        "DELETE FROM assets",
        "UPDATE asset_blobs SET width=2",
        "DELETE FROM asset_blobs",
    ):
        with pytest.raises(IntegrityError), client.app.state.engine.begin() as db:
            db.execute(text(statement))
    with client.app.state.engine.begin() as db:
        db.execute(
            text("UPDATE study_versions SET published_at='frozen' WHERE id=:id"),
            {"id": version["id"]},
        )
    with pytest.raises(IntegrityError), client.app.state.engine.begin() as db:
        db.execute(
            text(
                "INSERT INTO assets SELECT :id, study_version_id, sha256, name, "
                "alt_text, created_at FROM assets"
            ),
            {"id": str(uuid4())},
        )
    assert asset["id"]


def test_assets_backed_up_restored_and_verified(client, researcher_headers, database_url, tmp_path):
    _, _, base, _ = draft(client, researcher_headers)
    asset = upload(client, researcher_headers, base).json()
    source = operations.database_path(database_url)
    destination = tmp_path.parent / (tmp_path.name + "-asset-backups")
    archive = operations.backup(source, destination, "release")
    receipt = operations.verify(archive)
    assert receipt["assets"] == [{"sha256": asset["sha256"], "byte_size": len(png())}]
    target = tmp_path / "restored" / "db.sqlite"
    (target.parent / "assets").mkdir(parents=True)
    operations.restore(archive, target, "release")
    assert (target.parent / "assets" / asset["sha256"]).read_bytes() == png()
    (archive.with_suffix(".assets") / asset["sha256"]).write_bytes(b"corrupt")
    with pytest.raises(ValueError, match="checksum"):
        operations.verify(archive)
    with pytest.raises(ValueError):
        operations.restore(archive, tmp_path / "refused" / "db", "release")
    assert not (tmp_path / "refused" / "db").exists()


def test_png_bounded_deflate_and_dimensions():
    assert png_dimensions(png()) == (1, 1)
    malformed = bytearray(png())
    malformed[-1] ^= 1
    with pytest.raises(ValueError):
        png_dimensions(bytes(malformed))


def test_version_asset_count_and_digest_dedup(client, researcher_headers):
    _, _, base, _ = draft(client, researcher_headers)
    for index in range(50):
        result = upload(client, researcher_headers, base, name=f"Image {index}")
        assert result.status_code == 201
    assert upload(client, researcher_headers, base).status_code == 422
    with client.app.state.engine.connect() as db:
        assert db.scalar(text("SELECT count(*) FROM asset_blobs")) == 1
        assert db.scalar(text("SELECT count(*) FROM assets")) == 50


def test_image_dimension_deflate_reference_and_history_limits(
    client, researcher_headers, database_url
):
    from alembic import command
    from alembic.config import Config
    from conftest import ROOT

    _, _, base, form = draft(client, researcher_headers)
    for invalid in (png(width=4097), png(width=2), png(rgb=b"x" * 1000000)):
        assert upload(client, researcher_headers, base, invalid).status_code == 422
    asset = upload(client, researcher_headers, base).json()
    form["nodes"][0]["data"]["asset_ids"] = [asset["id"], asset["id"]]
    assert save(client, researcher_headers, base, form).status_code == 422
    with pytest.raises(RuntimeError, match="Asset history"):
        command.downgrade(Config(str(ROOT / "alembic.ini")), "0011")
    with client.app.state.engine.connect() as db:
        assert db.scalar(text("SELECT version_num FROM alembic_version")) == "0012"
