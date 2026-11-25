"""Build the Windows portable zip. Needs internet; running the result does not.

    python scripts/build_portable.py [--out dist] [--template-apk FILE] [--signer-jar FILE]
                                     [--jre DIR] [--skip-frontend]

Runs on Windows or Linux. Downloads are verified against SHA-256 values pinned below; update the
pins deliberately when a component is upgraded. The tablet-app parts (template APK, signer jar,
Java runtime) are optional here: CI builds them (.github/workflows/ci.yml) and passes them in.
Without them the zip still works; the tablet app is then built the old way (android/INSTALL.md).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PYTHON_VERSION = "3.13.17"
PINS = {
    "python": (
        f"https://www.python.org/ftp/python/{PYTHON_VERSION}/python-{PYTHON_VERSION}-embed-amd64.zip",
        "9e35319bffedab8b36ad44d8f377cb4f1733bcec257a0b6d04d94f01486ddb38",
    ),
    "caddy": (
        "https://github.com/caddyserver/caddy/releases/download/v2.11.9/caddy_2.11.9_windows_amd64.zip",
        "ad93112d335ee687100c4c9f11bced16ca590377976b7fe7883882b9e797e472",
    ),
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(1 << 20):
            digest.update(block)
    return digest.hexdigest()


def download(name: str, cache: Path) -> Path:
    url, expected = PINS[name]
    target = cache / url.rsplit("/", 1)[1]
    if not target.is_file() or sha256(target) != expected:
        cache.mkdir(parents=True, exist_ok=True)
        print(f"Downloading {url}")
        with urllib.request.urlopen(url) as response, target.open("wb") as output:  # noqa: S310
            shutil.copyfileobj(response, output)
    if sha256(target) != expected:
        target.unlink()
        raise SystemExit(f"{target.name} does not match its pinned SHA-256; refusing to use it.")
    return target


def run(*command: str, cwd: Path = ROOT) -> None:
    print("+", " ".join(command))
    subprocess.run(
        command, cwd=cwd, check=True, shell=sys.platform == "win32" and command[0] == "npm"
    )


def version() -> str:
    text = (ROOT / "pyproject.toml").read_text(encoding="utf-8")
    return re.search(r'^version = "([^"]+)"', text, re.MULTILINE).group(1)


def tablet_app_version() -> dict:
    """versionCode and versionName of the tablet app built from this checkout."""
    text = (ROOT / "android" / "app" / "build.gradle.kts").read_text(encoding="utf-8")
    code = re.search(r"versionCode = (\d+)", text)
    name = re.search(r'versionName = "([^"]+)"', text)
    if not code or not name:
        raise SystemExit("android/app/build.gradle.kts has no versionCode or versionName.")
    return {"version_code": int(code.group(1)), "version_name": name.group(1)}


def commit() -> str:
    try:
        result = subprocess.run(
            ["git", "describe", "--always", "--dirty"], cwd=ROOT, capture_output=True, text=True
        )
        return result.stdout.strip() or "unknown"
    except OSError:
        return "unknown"


def copy_text(source: Path, target: Path, *, crlf: bool) -> None:
    data = source.read_text(encoding="utf-8").replace("\r\n", "\n")
    if crlf:
        data = data.replace("\n", "\r\n")  # Windows Notepad and cmd expect these
    target.write_bytes(data.encode("utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=ROOT / "dist")
    parser.add_argument("--template-apk", type=Path)
    parser.add_argument("--signer-jar", type=Path)
    parser.add_argument("--jre", type=Path, help="a jlink runtime that includes java and keytool")
    parser.add_argument("--skip-frontend", action="store_true", help="reuse frontend/dist")
    args = parser.parse_args()
    tablet = [args.template_apk, args.signer_jar, args.jre]
    if any(tablet) and not all(tablet):
        raise SystemExit("Give --template-apk, --signer-jar and --jre together, or none of them.")

    cache = ROOT / "build" / "portable-cache"
    python_zip, caddy_zip = download("python", cache), download("caddy", cache)
    if not args.skip_frontend:
        run("npm", "ci", cwd=ROOT / "frontend")
        run("npm", "run", "build", cwd=ROOT / "frontend")
    if not (ROOT / "frontend" / "dist" / "index.html").is_file():
        raise SystemExit("frontend/dist is missing; build the frontend first.")

    with tempfile.TemporaryDirectory() as scratch_name:
        scratch = Path(scratch_name)
        package = scratch / "Sensibilia"
        app = package / "app"
        interpreter = app / "python"
        interpreter.mkdir(parents=True)
        with zipfile.ZipFile(python_zip) as archive:
            archive.extractall(interpreter)
        with zipfile.ZipFile(caddy_zip) as archive:
            archive.extract("caddy.exe", app)
        # Embeddable Python ignores PYTHONPATH; this file lists where it looks (site-packages on).
        major_minor = "".join(PYTHON_VERSION.split(".")[:2])
        pth = interpreter / f"python{major_minor}._pth"
        pth.write_text(
            f"python{major_minor}.zip\n.\nLib\\site-packages\n\nimport site\n", encoding="ascii"
        )

        wheels = scratch / "wheels"
        run(sys.executable, "-m", "pip", "wheel", "--no-deps", "--wheel-dir", str(wheels), ".")
        site = interpreter / "Lib" / "site-packages"
        pip = [sys.executable, "-m", "pip", "install", "--target", str(site), "--no-deps"]
        pip += ["--platform", "win_amd64", "--python-version", "3.13", "--only-binary=:all:"]
        run(*pip, "-r", "requirements.lock")
        run(*pip, *map(str, wheels.glob("sensibilia-*.whl")))

        shutil.copytree(ROOT / "frontend" / "dist", app / "frontend" / "dist")
        shutil.copytree(
            ROOT / "migrations", app / "migrations", ignore=shutil.ignore_patterns("__pycache__")
        )
        shutil.copyfile(ROOT / "alembic.ini", app / "alembic.ini")
        copy_text(ROOT / "deploy" / "Caddyfile.dev", app / "Caddyfile", crlf=False)
        for item in (ROOT / "deploy" / "portable").iterdir():
            copy_text(item, package / item.name, crlf=True)
        if args.template_apk:
            (app / "tablet-app").mkdir()
            shutil.copyfile(args.template_apk, app / "tablet-app" / "template.apk")
            shutil.copyfile(args.signer_jar, app / "tablet-app" / "signer.jar")
            (app / "tablet-app" / "template.json").write_text(
                json.dumps(tablet_app_version()), encoding="ascii"
            )
            shutil.copytree(args.jre, app / "jre")
        stamp = f"{version()} {commit()} {datetime.now(UTC):%Y-%m-%dT%H:%MZ}\n"
        (app / "RELEASE").write_text(stamp, encoding="ascii")

        args.out.mkdir(parents=True, exist_ok=True)
        target = args.out / f"Sensibilia-{version()}-windows-portable.zip"
        target.unlink(missing_ok=True)
        with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as output:
            for path in sorted(package.rglob("*")):
                if path.is_file():
                    output.write(path, path.relative_to(scratch).as_posix())
    print(f"\nBuilt {target} ({target.stat().st_size // 1_000_000} MB)\nRelease {stamp.strip()}")


if __name__ == "__main__":
    main()
