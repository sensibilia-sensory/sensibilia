"""Explicit maintenance commands. Never invoked by API startup."""

import argparse
import hashlib
import json
import os
import shutil
import sqlite3
import sys
import time
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from alembic import command
from alembic.config import Config
from sqlalchemy.engine import make_url

from sensibilia.db import EXPECTED_REVISION

ROOT = Path(os.getenv("SENSIBILIA_ROOT", Path(__file__).resolve().parents[2]))


def database_path(url: str) -> Path:
    parsed = make_url(url)
    if parsed.get_backend_name() != "sqlite" or parsed.database in (None, "", ":memory:"):
        raise ValueError("Maintenance requires a file-backed SQLite database")
    return Path(parsed.database).resolve()


def connect_readonly(path: Path):
    # mode=ro refuses a missing source rather than creating an empty backup.
    return sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=5)


def inspect_database(path: Path) -> dict:
    with closing(connect_readonly(path)) as db:
        if db.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
            raise ValueError("SQLite integrity check failed")
        if db.execute("PRAGMA foreign_key_check").fetchone():
            raise ValueError("SQLite foreign key check failed")
        revision = db.execute("SELECT version_num FROM alembic_version").fetchall()
        if len(revision) != 1:
            raise ValueError("Expected exactly one Alembic revision")
        # Table counts aid restore reconciliation without exposing values or credentials.
        names = db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        ).fetchall()
        counts = {
            name: db.execute('SELECT count(*) FROM "' + name.replace('"', '""') + '"').fetchone()[0]
            for (name,) in names
        }
        return {"revision": revision[0][0], "table_counts": counts}


def checksum(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def atomic_json(path: Path, value: dict):
    temporary = path.with_name(path.name + "." + uuid4().hex + ".tmp")
    try:
        with temporary.open("x", encoding="utf-8") as stream:
            json.dump(value, stream, indent=2, sort_keys=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def asset_directory(database):
    return Path(os.getenv("SENSIBILIA_ASSETS_DIRECTORY", database.parent / "assets")).resolve()


def asset_manifest(database):
    with closing(connect_readonly(database)) as db:
        if not db.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='asset_blobs'"
        ).fetchone():
            return []
        return [
            {"sha256": sha, "byte_size": size}
            for sha, size in db.execute("SELECT sha256, byte_size FROM asset_blobs ORDER BY sha256")
        ]


def verify_assets(directory, manifest):
    for entry in manifest:
        sha = entry["sha256"]
        if len(sha) != 64 or any(c not in "0123456789abcdef" for c in sha):
            raise ValueError("Invalid stimulus digest")
        path = directory / sha
        if path.stat().st_size != entry["byte_size"] or checksum(path) != sha:
            raise ValueError("Stimulus checksum mismatch")


def backup(
    source: Path,
    destination: Path,
    release: str,
    *,
    timeout: float = 300,
    purpose: str = "scheduled",
) -> Path:
    source, destination = source.resolve(), destination.resolve()
    if (
        destination == source.parent
        or source.parent in destination.parents
        or destination == asset_directory(source)
        or asset_directory(source) in destination.parents
    ):
        raise ValueError("Backup destination must be outside the live database directory")
    if not release:
        raise ValueError("Record the release image digest with each backup")
    destination.mkdir(parents=True, exist_ok=True)
    identifier = datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ") + "-" + uuid4().hex
    final = destination / (identifier + ".db")
    temporary = destination / (identifier + ".tmp")
    started = time.monotonic()

    def progress(_status, _remaining, _total):
        if time.monotonic() - started > timeout:
            raise TimeoutError("SQLite backup deadline exceeded")

    try:
        with (
            closing(connect_readonly(source)) as origin,
            closing(sqlite3.connect(temporary)) as copy,
        ):
            origin.backup(copy, pages=256, progress=progress, sleep=0.05)
            # Produce a self-contained DB, with no dependency on WAL/SHM sidecars.
            copy.execute("PRAGMA journal_mode=DELETE")
        facts = inspect_database(temporary)
        manifest = asset_manifest(temporary)
        asset_copy = final.with_suffix(".assets")
        if manifest:
            origin_assets = asset_directory(source)
            verify_assets(origin_assets, manifest)
            asset_copy.mkdir()
            for entry in manifest:
                shutil.copyfile(origin_assets / entry["sha256"], asset_copy / entry["sha256"])
                with (asset_copy / entry["sha256"]).open("r+b") as stream:
                    os.fsync(stream.fileno())
            verify_assets(asset_copy, manifest)
        with temporary.open("r+b") as stream:
            os.fsync(stream.fileno())
        receipt = {
            "format_version": 1,
            **({"assets": manifest} if manifest else {}),
            "backup": final.name,
            "created_at": datetime.now(UTC).isoformat(),
            "release": release,
            "purpose": purpose,
            "sha256": checksum(temporary),
            **facts,
        }
        temporary.replace(final)
        atomic_json(final.with_suffix(".json"), receipt)
        # Success pointer is updated only after both durable files exist.
        atomic_json(destination / "last-success.json", receipt)
        return final
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise


def verify(archive: Path) -> dict:
    receipt = json.loads(archive.with_suffix(".json").read_text(encoding="utf-8"))
    if receipt["format_version"] != 1 or receipt["backup"] != archive.name:
        raise ValueError("Backup receipt does not identify this file")
    if checksum(archive) != receipt["sha256"]:
        raise ValueError("Backup checksum mismatch")
    facts = inspect_database(archive)
    if facts != {key: receipt[key] for key in ("revision", "table_counts")}:
        raise ValueError("Backup contents do not match receipt")
    manifest = asset_manifest(archive)
    if receipt.get("assets", []) != manifest:
        raise ValueError("Stimulus manifest does not match backup database")
    verify_assets(archive.with_suffix(".assets"), manifest)
    return receipt


def retain(destination: Path):
    """Opt-in institution-approved 48 hourly / 30 daily / 12 monthly retention."""
    records = [(path, verify(path)) for path in destination.glob("*.db")]
    records.sort(key=lambda item: item[1]["created_at"], reverse=True)
    keep = set()
    for prefix, limit in ((13, 48), (10, 30), (7, 12)):
        buckets = set()
        for path, receipt in records:
            if receipt.get("purpose") == "pre-upgrade":
                keep.add(path)  # Support explicitly releases upgrade backups after restore drills.
                continue
            bucket = receipt["created_at"][:prefix]
            if bucket not in buckets and len(buckets) < limit:
                buckets.add(bucket)
                keep.add(path)
    if records:
        keep.add(records[0][0])
    removed = 0
    for path, _receipt in records:
        if path not in keep:
            path.unlink()
            path.with_suffix(".json").unlink()
            assets = path.with_suffix(".assets")
            if assets.exists():
                for entry in _receipt.get("assets", []):
                    (assets / entry["sha256"]).unlink()
                assets.rmdir()
            removed += 1
    return removed


def restore(archive: Path, target: Path, release: str):
    receipt = verify(archive)
    if receipt["release"] != release:
        raise ValueError("Restore requires the matching release image")
    target.parent.mkdir(parents=True, exist_ok=True)
    if any(Path(str(target) + suffix).exists() for suffix in ("", "-wal", "-shm")):
        raise ValueError("Restore target must be fresh; preserve the failed volume")
    manifest = receipt.get("assets", [])
    target_assets = asset_directory(target)
    if manifest:
        if target_assets.exists() and any(target_assets.iterdir()):
            raise ValueError("Restore asset target must be fresh; preserve the failed volume")
        target_assets.mkdir(parents=True, exist_ok=True)
        for entry in manifest:
            with (
                (target_assets / entry["sha256"]).open("xb") as output,
                (archive.with_suffix(".assets") / entry["sha256"]).open("rb") as source,
            ):
                shutil.copyfileobj(source, output)
                output.flush()
                os.fsync(output.fileno())
        verify_assets(target_assets, manifest)
    # Exclusive creation also refuses a competing restore. No existing file is replaced.
    with target.open("xb") as output, archive.open("rb") as source:
        while block := source.read(1024 * 1024):
            output.write(block)
        output.flush()
        os.fsync(output.fileno())
    if checksum(target) != receipt["sha256"]:
        raise ValueError("Restored checksum does not match backup")
    if inspect_database(target) != {key: receipt[key] for key in ("revision", "table_counts")}:
        raise ValueError("Restored contents do not match backup")
    return receipt


def migrate(url: str, destination: Path, release: str, *, app_stopped: bool, initialize=False):
    if not app_stopped:
        raise ValueError("Stop the app before explicit maintenance")
    source = database_path(url)
    if initialize:
        if any(Path(str(source) + suffix).exists() for suffix in ("", "-wal", "-shm")):
            raise ValueError("Initialisation requires a fresh database")
    else:
        archive = backup(source, destination, release, purpose="pre-upgrade")
        verify(archive)  # A failed backup must prevent any migration call.
    config = Config(str(ROOT / "alembic.ini"))
    # env.py already honours this variable. Override only for the explicit command.
    previous = os.environ.get("SENSIBILIA_DATABASE_URL")
    os.environ["SENSIBILIA_DATABASE_URL"] = url
    try:
        command.upgrade(config, "head")
        if inspect_database(source)["revision"] != EXPECTED_REVISION:
            raise ValueError("Migration did not reach this release's revision")
    finally:
        if previous is None:
            os.environ.pop("SENSIBILIA_DATABASE_URL", None)
        else:
            os.environ["SENSIBILIA_DATABASE_URL"] = previous


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url", default=os.getenv("SENSIBILIA_DATABASE_URL"))
    parser.add_argument("--release", default=os.getenv("SENSIBILIA_RELEASE"))
    sub = parser.add_subparsers(dest="action", required=True)
    for action in ("backup", "migrate", "initialize"):
        options = sub.add_parser(action)
        options.add_argument("--destination", type=Path, default=Path("/backup"))
        if action == "backup":
            options.add_argument("--retain", action="store_true")
        if action != "backup":
            options.add_argument("--app-stopped", action="store_true")
    for action in ("verify", "restore"):
        options = sub.add_parser(action)
        options.add_argument("archive", type=Path)
        if action == "restore":
            options.add_argument("--target", type=Path, required=True)
    options = sub.add_parser("status")
    options.add_argument("--destination", type=Path, default=Path("/backup"))
    options.add_argument("--max-age-hours", type=float, default=2)
    args = parser.parse_args(argv)
    try:
        if args.action == "verify":
            result = verify(args.archive)
        elif args.action == "restore":
            result = restore(args.archive, args.target, args.release)
        elif args.action == "status":
            result = json.loads(
                (args.destination / "last-success.json").read_text(encoding="utf-8")
            )
            verify(args.destination / result["backup"])
            age = (datetime.now(UTC) - datetime.fromisoformat(result["created_at"])).total_seconds()
            if not 0 <= age <= args.max_age_hours * 3600:
                raise ValueError("Backup is stale")
        elif args.action == "backup":
            result = {
                "backup": backup(
                    database_path(args.database_url), args.destination, args.release
                ).name
            }
            if args.retain:
                result["removed"] = retain(args.destination)
        else:
            migrate(
                args.database_url,
                args.destination,
                args.release,
                app_stopped=args.app_stopped,
                initialize=args.action == "initialize",
            )
            result = {"revision": EXPECTED_REVISION}
        print(json.dumps(result, sort_keys=True))
        return 0
    except Exception:
        # Do not print exception strings: paths/URLs/configuration may contain secrets.
        print(
            "Maintenance failed; preserve data and contact support. App must remain stopped.",
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
