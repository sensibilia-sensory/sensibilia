"""Smoke-test a built portable zip the way a laboratory would use it.

    python scripts/smoke_portable.py dist/Sensibilia-0.1.0-windows-portable.zip [--tablet-app]

Unzips into a folder whose name has a space and a non-ASCII letter, starts the launcher with the
bundled Python, checks the researcher screen over HTTPS through Caddy, the public root certificate
and (with --tablet-app) that the served APK carries this server's root, makes and checks a backup,
then kills the launcher the hard way and checks that no port is left held by an orphan.
Windows only.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import socket
import ssl
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

PORTS = (1379, 1380, 1381)


def fetch(url: str) -> tuple[int, bytes]:
    context = ssl.create_default_context()
    context.check_hostname, context.verify_mode = False, ssl.CERT_NONE  # a private root
    try:
        with urllib.request.urlopen(url, timeout=5, context=context) as response:  # noqa: S310
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, b""


def wait_until(check, seconds: float, what: str):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            if value := check():
                return value
        except OSError:
            pass
        time.sleep(1)
    raise SystemExit(f"FAIL: {what} did not happen within {seconds:.0f} s")


def port_is_free(port: int) -> bool:
    with socket.socket() as probe:
        return probe.connect_ex(("127.0.0.1", port)) != 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("zip", type=Path)
    parser.add_argument("--tablet-app", action="store_true", help="expect the tablet app too")
    args = parser.parse_args()
    busy = [port for port in PORTS if not port_is_free(port)]
    if busy:
        raise SystemExit(f"FAIL: ports {busy} are already in use; stop the other copy first")

    with tempfile.TemporaryDirectory(prefix="Sensibilia test Å ") as folder:
        zipfile.ZipFile(args.zip).extractall(folder)
        home = Path(folder) / "Sensibilia"
        env = dict(os.environ, SENSIBILIA_PORTABLE_HOME=str(home), PYTHONUNBUFFERED="1")
        python = str(home / "app" / "python" / "python.exe")
        log = (Path(folder) / "start.log").open("w", encoding="utf-8")
        launcher = subprocess.Popen(
            [python, "-m", "sensibilia.portable", "start", "--no-browser"],
            cwd=home, env=env, stdout=log, stderr=subprocess.STDOUT,
        )  # fmt: skip
        try:
            wait_until(lambda: fetch("https://localhost:1379/health")[0] == 200, 90, "HTTPS health")
            assert fetch("https://localhost:1379/researcher/")[0] == 200, "researcher screen"
            status, root = fetch("http://localhost:1380/certificate.crt")
            assert status == 200 and b"BEGIN CERTIFICATE" in root, "public root certificate"
            saved_file = home / "data" / "lab-ca" / "root.crt"
            wait_until(saved_file.is_file, 30, "saving the root certificate")
            saved = saved_file.read_bytes()
            assert saved == root, "saved root differs from the served root"
            if args.tablet_app:  # Start bakes the app a moment after Caddy is up
                wait_until(
                    lambda: fetch("http://localhost:1380/tablet-app.apk")[0] == 200,
                    30,
                    "tablet app download",
                )
            status, apk = fetch("http://localhost:1380/tablet-app.apk")
            if args.tablet_app:
                assert status == 200, f"tablet app download answered {status}"
                (Path(folder) / "t.apk").write_bytes(apk)
                with zipfile.ZipFile(Path(folder) / "t.apk") as archive:
                    assert archive.read("res/raw/lab_ca.crt") == root, "APK holds another root"
                # The app updates itself over HTTPS from the same files.
                status, info = fetch("https://localhost:1379/tablet-app.json")
                assert status == 200, f"tablet-app.json answered {status}"
                info = json.loads(info)
                assert info["sha256"] == hashlib.sha256(apk).hexdigest(), "checksum differs"
                assert info["version_code"] >= 1 and info["version_name"], "no app version"
                assert fetch("https://localhost:1379/tablet-app.apk") == (200, apk), "HTTPS apk"
            else:
                assert status == 404, f"expected no tablet app, got {status}"
            for command in ("backup", "status"):
                result = subprocess.run(
                    [python, "-m", "sensibilia.portable", command],
                    cwd=home, env=env, capture_output=True, text=True,
                )  # fmt: skip
                assert result.returncode == 0, f"{command} failed: {result.stderr or result.stdout}"
            print("PASS: start, HTTPS, root certificate, tablet app, backup")
        finally:
            launcher.kill()  # the hard way: the window is closed or the process is killed
            launcher.wait(10)
            log.close()
            print((Path(folder) / "start.log").read_text(encoding="utf-8", errors="replace"))
            for server_log in sorted((home / "data" / "logs").glob("*.log")):
                print(f"--- {server_log.name} (last 6000 characters)")
                print(server_log.read_text(encoding="utf-8", errors="replace")[-6000:])
        time.sleep(3)
        still_held = [port for port in PORTS if not port_is_free(port)]
        if still_held:
            raise SystemExit(f"FAIL: ports {still_held} are still held after the launcher ended")
        print("PASS: nothing left running after the launcher was killed")


if __name__ == "__main__":
    if sys.platform != "win32":
        raise SystemExit("The portable edition is Windows only.")
    # The CI console is cp1252; the start log must print whatever it holds.
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    main()
