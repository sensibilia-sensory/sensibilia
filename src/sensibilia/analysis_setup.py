"""Install the optional analysis add-on: R and its sensory packages.

    python -m sensibilia.analysis_setup install [--from FOLDER]
    python -m sensibilia.analysis_setup download FOLDER
    python -m sensibilia.analysis_setup status
    python -m sensibilia.analysis_setup remove

Every file comes from the lock shipped with this release and must match its SHA-256. Nothing is
taken from the internet that the lock does not name, and a failed install leaves nothing behind.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from datetime import UTC, datetime
from pathlib import Path

LOCK_PATH = Path(__file__).with_name("analysis") / "r-runtime.lock.json"
RECEIPT = "receipt.json"
CHECK_PACKAGES = ["jsonlite", "FactoMineR", "SensoMineR", "sensR", "agricolae"]
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


class Problem(Exception):
    """An error with a message written for laboratory staff."""


def lock_bytes() -> bytes:
    return LOCK_PATH.read_bytes()


def lock() -> dict:
    return json.loads(lock_bytes())


def lock_sha256() -> str:
    return hashlib.sha256(lock_bytes()).hexdigest()


def runtime_directory() -> Path:
    """Where the add-on lives: SENSIBILIA_ANALYSIS_RUNTIME, else data/ beside the app."""
    configured = os.environ.get("SENSIBILIA_ANALYSIS_RUNTIME")
    if configured:
        return Path(configured).resolve()
    portable = os.environ.get("SENSIBILIA_PORTABLE_HOME")
    if portable:
        return (Path(portable) / "data" / "analysis-runtime").resolve()
    return (Path(__file__).resolve().parents[2] / "data" / "analysis-runtime").resolve()


def files() -> list[tuple[str, dict]]:
    """(file name, {url, sha256, bytes}) for every locked Windows download."""
    data = lock()
    entries = [data["r"]["windows"]] + [p["windows"] for p in data["packages"]]
    return [(entry["url"].rsplit("/", 1)[1], entry) for entry in entries]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(1 << 20):
            digest.update(block)
    return digest.hexdigest()


def fetch(url: str, target: Path, expected: str, size: int) -> None:
    if target.is_file() and sha256_file(target) == expected:
        return
    partial = target.with_name(target.name + ".part")
    request = urllib.request.Request(url, headers={"User-Agent": "sensibilia-analysis-setup"})
    try:
        with urllib.request.urlopen(request, timeout=120) as response, partial.open("wb") as out:  # noqa: S310
            shutil.copyfileobj(response, out, 1 << 20)
    except OSError as error:
        partial.unlink(missing_ok=True)
        raise Problem(
            f"Could not download {target.name} ({error}). Check the internet connection, or "
            "prepare the files on another computer with 'download' and install with --from."
        ) from None
    if sha256_file(partial) != expected or partial.stat().st_size != size:
        partial.unlink()
        raise Problem(f"{target.name} does not match the expected checksum; nothing was installed.")
    partial.replace(target)


def gather(folder: Path, source: Path | None) -> None:
    """Fill `folder` with every locked file, verified: from `source` if given, else from the web."""
    folder.mkdir(parents=True, exist_ok=True)
    entries = files()
    total = sum(entry["bytes"] for _, entry in entries)
    done = 0
    for name, entry in entries:
        target = folder / name
        if source is not None:
            origin = source / name
            if not origin.is_file():
                raise Problem(f"{name} is missing from {source}; nothing was installed.")
            if sha256_file(origin) != entry["sha256"]:
                raise Problem(
                    f"{name} in {source} does not match its checksum; nothing was installed."
                )
            if origin.resolve() != target.resolve():
                shutil.copyfile(origin, target)
        else:
            fetch(entry["url"], target, entry["sha256"], entry["bytes"])
        done += entry["bytes"]
        print(f"  {done * 100 // total:3d} %  {name}")


def rscript(directory: Path) -> Path:
    return directory / "R" / "bin" / ("Rscript.exe" if sys.platform == "win32" else "Rscript")


def r_environment(library: Path) -> dict:
    """A minimal environment: no user profile, site library or inherited R settings.

    Keeps the variables Windows sets for every process to describe the machine. Without
    PROCESSOR_ARCHITECTURE, R 4.6 on Windows crashes on exit (0xc0000005) once cli, rlang or
    lazyeval has been loaded, which failed every job and the install check.
    """
    keep = (
        "SYSTEMROOT", "WINDIR", "SYSTEMDRIVE", "TEMP", "TMP", "PATH", "LANG", "HOME",
        "USERPROFILE", "LOCALAPPDATA", "APPDATA", "PROGRAMDATA", "OS", "NUMBER_OF_PROCESSORS",
        "PROCESSOR_ARCHITECTURE", "PROCESSOR_IDENTIFIER",
    )  # fmt: skip
    env = {k: os.environ[k] for k in keep if k in os.environ}
    env.update(
        R_LIBS=str(library),
        R_LIBS_USER=str(library),
        R_LIBS_SITE=str(library),
        R_ENVIRON="",
        R_ENVIRON_USER="",
        R_PROFILE="",
        R_PROFILE_USER="",
        LANGUAGE="en",
    )
    return env


def self_check(directory: Path) -> dict:
    script = (
        "pk <- commandArgs(TRUE); "
        "for (p in pk) suppressPackageStartupMessages(library(p, character.only = TRUE)); "
        "v <- c(R = paste(R.version$major, R.version$minor, sep = '.'), "
        "sapply(pk, function(p) as.character(utils::packageVersion(p)))); "
        "cat(jsonlite::toJSON(as.list(v), auto_unbox = TRUE))"
    )
    library = directory / "library"
    result = subprocess.run(
        [str(rscript(directory)), "--vanilla", "-e", script, *CHECK_PACKAGES],
        capture_output=True,
        text=True,
        timeout=300,
        env=r_environment(library),
        creationflags=NO_WINDOW,
        check=False,
    )
    if result.returncode:
        detail = result.stderr.strip()[-2000:] or (
            f"R stopped with exit code {result.returncode & 0xFFFFFFFF:#x} and no message."
        )
        raise Problem("The analysis add-on did not pass its check:\n" + detail)
    versions = json.loads(result.stdout.strip().splitlines()[-1])
    expected = {p["name"]: p["version"] for p in lock()["packages"]}
    for name in CHECK_PACKAGES:
        if versions.get(name) != expected[name].replace("-", "."):
            raise Problem(
                f"{name} reports version {versions.get(name)}, expected {expected[name]}."
            )
    if versions["R"] != lock()["r"]["version"]:
        raise Problem(f"R reports version {versions['R']}, expected {lock()['r']['version']}.")
    return versions


def uninstall_r(directory: Path) -> None:
    uninstaller = directory / "R" / "unins000.exe"
    if uninstaller.is_file():
        subprocess.run(
            [str(uninstaller), "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART"],
            timeout=600,
            creationflags=NO_WINDOW,
            check=False,
        )


def install(source: Path | None = None) -> dict:
    if sys.platform != "win32":
        raise Problem("This installer is for Windows. On Docker use ./docker-up.sh analysis.")
    target = runtime_directory()
    if (target / RECEIPT).is_file():
        remove(quiet=True)
    if target.exists():
        uninstall_r(target)
        shutil.rmtree(target, ignore_errors=True)
    with tempfile.TemporaryDirectory(prefix="sensibilia-analysis-") as scratch_name:
        downloads = Path(scratch_name) / "downloads"
        print("Collecting and checking the files...")
        gather(downloads, source)
        try:
            target.mkdir(parents=True)
            installer = downloads / files()[0][0]
            print("Installing R for this user (no administrator rights needed)...")
            result = subprocess.run(
                [
                    str(installer), "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART",
                    "/CURRENTUSER", "/NOICONS", f"/DIR={target / 'R'}",
                    "/COMPONENTS=main,x64", "/MERGETASKS=!desktopicon,!recordversion,!associate",
                ],
                timeout=900, creationflags=NO_WINDOW, check=False,
            )  # fmt: skip
            if result.returncode or not rscript(target).is_file():
                raise Problem(f"The R installer stopped (code {result.returncode}).")
            library = target / "library"
            library.mkdir()
            print("Unpacking the analysis packages...")
            for name, _ in files()[1:]:
                with zipfile.ZipFile(downloads / name) as archive:
                    archive.extractall(library)
            print("Checking that everything loads...")
            versions = self_check(target)
            receipt = {
                "lock_sha256": lock_sha256(),
                "snapshot_date": lock()["snapshot_date"],
                "versions": versions,
                "installed_at": datetime.now(UTC).isoformat(timespec="seconds"),
                "source": str(source) if source else "internet",
            }
            (target / RECEIPT).write_text(json.dumps(receipt, indent=2), encoding="utf-8")
            return receipt
        except BaseException:
            uninstall_r(target)
            shutil.rmtree(target, ignore_errors=True)
            raise


def status() -> dict:
    """installed: ready | needs_update | missing | broken, with a sentence for people."""
    directory = runtime_directory()
    receipt_path = directory / RECEIPT
    if not receipt_path.is_file():
        return {
            "state": "missing",
            "message": "The analysis add-on is not installed.",
            "directory": str(directory),
        }
    try:
        receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    except ValueError:
        return {"state": "broken", "message": "The add-on receipt is unreadable; install again."}
    if receipt.get("lock_sha256") != lock_sha256():
        return {
            "state": "needs_update",
            "message": (
                "This version of Sensibilia needs a newer analysis add-on; install it again."
            ),
            "receipt": receipt,
        }
    if not rscript(directory).is_file():
        return {"state": "broken", "message": "R is missing from the add-on; install it again."}
    return {"state": "ready", "message": "The analysis add-on is installed.", "receipt": receipt}


def remove(quiet: bool = False) -> None:
    directory = runtime_directory()
    if not directory.exists():
        if not quiet:
            print("The analysis add-on is not installed.")
        return
    uninstall_r(directory)
    shutil.rmtree(directory, ignore_errors=True)
    if not quiet:
        print("Removed the analysis add-on. Results already computed stay in Sensibilia.")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawTextHelpFormatter
    )
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("install").add_argument("--from", dest="source", type=Path)
    sub.add_parser("download").add_argument("folder", type=Path)
    sub.add_parser("status")
    sub.add_parser("remove")
    args = parser.parse_args(argv)
    sys.stdout.reconfigure(line_buffering=True)
    try:
        if args.command == "install":
            receipt = install(args.source)
            print(f"\nThe analysis add-on is ready (R {receipt['versions']['R']}).")
            print("Start Sensibilia (or restart it) and open Results > Analyses.")
        elif args.command == "download":
            total = sum(entry["bytes"] for _, entry in files()) // 1_000_000
            print(f"Downloading {total} MB into {args.folder}...")
            gather(args.folder, None)
            shutil.copyfile(LOCK_PATH, args.folder / LOCK_PATH.name)
            print(
                f"\nDone. Copy {args.folder} to the laboratory computer and run there:\n"
                f'  Add analysis (R).bat "{args.folder}"'
            )
        elif args.command == "status":
            state = status()
            print(state["message"])
            return 0 if state["state"] == "ready" else 1
        elif args.command == "remove":
            remove()
    except Problem as problem:
        print(f"\n{problem}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
