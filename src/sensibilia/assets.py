"""Bounded static PNG stimuli and immutable version-owned manifests."""

import base64
import binascii
import hashlib
import os
import struct
import zlib
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException
from pydantic import Field
from sqlalchemy import select

from sensibilia.flows import Text, walk
from sensibilia.methods import StrictModel
from sensibilia.models import Asset, AssetBlob

MAX_BYTES = 5 * 1024 * 1024
MAX_BODY = 7 * 1024 * 1024
MAX_VERSION_BYTES = 25 * 1024 * 1024


class AssetUpload(StrictModel):
    revision_hash: str
    name: str = Field(min_length=1, max_length=250, pattern=r"\S")
    alt_text: Text
    content_base64: str = Field(min_length=1, max_length=6990508)


class AssetManifest(StrictModel):
    id: str
    study_version_id: str
    alt_text: Text
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    media_type: str
    byte_size: int
    width: int
    height: int
    url: str | None = None


class AssetRead(AssetManifest):
    name: str
    created_at: str


def storage_path(settings):
    if settings.assets_directory:
        return settings.assets_directory.resolve()
    from sqlalchemy.engine import make_url

    database = make_url(settings.database_url).database
    if not database or database == ":memory:":
        raise HTTPException(503, "Configure an asset directory for in-memory databases")
    return Path(database).resolve().parent / "assets"


def png_dimensions(content):
    """Accept only complete static 8-bit RGB/RGBA non-interlaced PNGs.

    Check every CRC, exact bounded deflate size and scanline filter values.
    No SVG/HTML, external references, animation or image re-encoding.
    """
    if not 0 < len(content) <= MAX_BYTES or content[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("Upload a static PNG of at most 5 MiB")
    at, width, height, channels = 8, 0, 0, 0
    compressed = bytearray()
    ended, data_ended = False, False
    while at < len(content):
        if at + 12 > len(content):
            raise ValueError("Truncated PNG")
        size, kind = struct.unpack(">I4s", content[at : at + 8])
        end = at + 12 + size
        if end > len(content):
            raise ValueError("Truncated PNG chunk")
        data = content[at + 8 : end - 4]
        crc = struct.unpack(">I", content[end - 4 : end])[0]
        if zlib.crc32(kind + data) & 0xFFFFFFFF != crc:
            raise ValueError("PNG checksum mismatch")
        if at == 8:
            if kind != b"IHDR" or size != 13:
                raise ValueError("PNG needs a valid header")
            width, height, depth, color, compression, filtering, interlace = struct.unpack(
                ">IIBBBBB", data
            )
            if not (1 <= width <= 4096 and 1 <= height <= 4096) or width * height > 16000000:
                raise ValueError("PNG dimensions exceed the stimulus limit")
            if depth != 8 or color not in (2, 6) or compression or filtering or interlace:
                raise ValueError("Use 8-bit RGB/RGBA non-interlaced PNG")
            channels = 3 if color == 2 else 4
        elif kind == b"IHDR" or kind in (b"acTL", b"fcTL", b"fdAT"):
            raise ValueError("Duplicate header or animated PNG is unsupported")
        elif kind == b"IDAT":
            if data_ended:
                raise ValueError("PNG data chunks must be contiguous")
            compressed.extend(data)
        elif kind == b"IEND":
            if size or end != len(content):
                raise ValueError("PNG end/trailing data is invalid")
            ended = True
        elif kind[:1].isupper() and kind != b"PLTE":
            raise ValueError("Unknown critical PNG chunk")
        elif compressed:
            data_ended = True
        at = end
    if not ended or not compressed:
        raise ValueError("PNG is incomplete")
    expected = height * (1 + width * channels)
    decoder = zlib.decompressobj()
    raw = decoder.decompress(compressed, expected + 1)
    if len(raw) != expected or not decoder.eof or decoder.unused_data or decoder.unconsumed_tail:
        raise ValueError("PNG pixel data is invalid")
    if any(raw[i] > 4 for i in range(0, expected, 1 + width * channels)):
        raise ValueError("PNG scanline filter is invalid")
    return width, height


def version_assets(db, version_id):
    return list(
        db.scalars(select(Asset).where(Asset.study_version_id == version_id).order_by(Asset.id))
    )


def referenced_ids(form):
    from sensibilia.flows import DraftFlowV2

    if not form or form.get("schema_version") != 2:
        return set()
    return {
        str(a)
        for n in walk(DraftFlowV2.model_validate(form).nodes)
        if n.kind == "info"
        for a in n.data.asset_ids
    }


def asset_read(db, asset, url=None):
    blob = db.get(AssetBlob, asset.sha256)
    return AssetRead(
        id=asset.id,
        study_version_id=asset.study_version_id,
        name=asset.name,
        created_at=asset.created_at,
        alt_text=asset.alt_text,
        sha256=asset.sha256,
        media_type=blob.media_type,
        byte_size=blob.byte_size,
        width=blob.width,
        height=blob.height,
        url=url,
    )


def verified_bytes(directory, blob):
    try:
        content = (directory / blob.sha256).read_bytes()
    except OSError:
        raise HTTPException(
            503, "Stimulus file is unavailable; restore it before collection"
        ) from None
    if len(content) != blob.byte_size or hashlib.sha256(content).hexdigest() != blob.sha256:
        raise HTTPException(503, "Stimulus checksum mismatch; restore before collection")
    return content


def store_upload(db, version, payload, directory):
    if not version.form or version.form.get("schema_version") != 2:
        raise HTTPException(422, "Images require a Flow v2 draft")
    languages = set(version.form["languages"])
    if set(payload.alt_text) != languages or any(not t.strip() for t in payload.alt_text.values()):
        raise HTTPException(422, "Review nonblank alt text for every study language")
    try:
        content = base64.b64decode(payload.content_base64, validate=True)
        width, height = png_dimensions(content)
    except (ValueError, binascii.Error, zlib.error) as exc:
        raise HTTPException(422, str(exc)) from exc
    existing = version_assets(db, version.id)
    if (
        len(existing) >= 50
        or sum(db.get(AssetBlob, a.sha256).byte_size for a in existing) + len(content)
        > MAX_VERSION_BYTES
    ):
        raise HTTPException(422, "A version supports at most 50 images / 25 MiB")
    sha = hashlib.sha256(content).hexdigest()
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / sha
    if target.exists():
        if target.read_bytes() != content:
            raise HTTPException(503, "Stored stimulus checksum mismatch; contact support")
    else:
        temporary = directory / (uuid4().hex + ".tmp")
        try:
            with temporary.open("xb") as stream:
                stream.write(content)
                stream.flush()
                os.fsync(stream.fileno())
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)
    if not db.get(AssetBlob, sha):
        db.add(
            AssetBlob(
                sha256=sha,
                media_type="image/png",
                byte_size=len(content),
                width=width,
                height=height,
            )
        )
        db.flush()
    asset = Asset(
        study_version_id=version.id, sha256=sha, name=payload.name, alt_text=payload.alt_text
    )
    db.add(asset)
    version.revision += 1
    db.flush()
    return asset


def asset_issues(db, version, flow):
    issues = []
    owned = {a.id: a for a in version_assets(db, version.id)}
    for node in walk(flow.nodes):
        if node.kind != "info":
            continue
        for asset_id in node.data.asset_ids:
            asset = owned.get(str(asset_id))
            if (
                not asset
                or set(asset.alt_text) != set(flow.languages)
                or any(not v.strip() for v in asset.alt_text.values())
            ):
                issues.append(
                    dict(
                        severity="error",
                        node_id=str(node.id),
                        study_test_id=None,
                        path=["nodes", str(node.id), "data", "asset_ids"],
                        code="asset_text",
                        message=(
                            "Image needs version ownership and reviewed alt text "
                            "in every study language"
                        ),
                    )
                )
    return issues


def clone_assets(db, previous, version):
    mapping = {}
    for asset in version_assets(db, previous.id):
        cloned = Asset(
            study_version_id=version.id,
            sha256=asset.sha256,
            name=asset.name,
            alt_text=dict(asset.alt_text),
        )
        db.add(cloned)
        db.flush()
        mapping[asset.id] = cloned.id
    return mapping
