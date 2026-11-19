"""Launcher for the Windows portable install.

The .bat files in the portable zip call ``python -m sensibilia.portable <command>``; all logic
lives here so it can be tested. The data layout matches the Docker standard install
(``data/server``, ``data/assets``, ``data/dev-tls``, ``data/lab-ca``, ``data/backups``), so a
laboratory can move between the two by copying ``data/``.

Commands: start, backup, status, restore, keys, firewall, tablet-app.
"""

from __future__ import annotations

import argparse
import contextlib
import os
import secrets
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

from sensibilia import operations

# Same value the Docker install records, so backups restore across both installs.
RELEASE = "dev-local"
HTTPS_PORT = 1379
HTTP_PORT = 1380
API_PORT = 1381  # internal; not 8000, which other programs commonly use
KEY_NAMES = ("DEV_RESEARCHER_KEY", "DEV_OPERATOR_KEY")


class Problem(Exception):
    """An error with a message written for laboratory staff."""


def home() -> Path:
    return Path(os.environ.get("SENSIBILIA_PORTABLE_HOME") or Path.cwd()).resolve()


def read_settings(path: Path) -> dict[str, str]:
    """Parse KEY=value lines; blank lines and # comments are ignored."""
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip().strip('"')
    return values


def lan_address(override: str = "") -> str:
    """This computer's LAN address. A UDP connect sends no packet; it only picks the route."""
    if override:
        return override
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(("192.0.2.1", 9))  # TEST-NET-1: never routed, so nothing is sent
            address = probe.getsockname()[0]
        return address if address and not address.startswith("127.") else "127.0.0.1"
    except OSError:
        return "127.0.0.1"


def port_is_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        return probe.connect_ex(("127.0.0.1", port)) != 0


def make_keys(settings_file: Path) -> str | None:
    """Add researcher and operator keys to settings.env unless keys already exist.

    Returns the text to show once, or None when keys were already set (never overwritten).
    """
    existing = read_settings(settings_file)
    if any(existing.get(name) for name in KEY_NAMES):
        return None
    researcher, operator = secrets.token_urlsafe(24), secrets.token_urlsafe(24)
    text = settings_file.read_text(encoding="utf-8") if settings_file.is_file() else ""
    lines = [line for line in text.splitlines() if line.split("=", 1)[0].strip() not in KEY_NAMES]
    lines += [f"DEV_RESEARCHER_KEY={researcher}", f"DEV_OPERATOR_KEY={operator}"]
    settings_file.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return f"Researcher key: {researcher}\nOperator key:   {operator}"


def paths(root: Path, settings: dict[str, str]) -> dict[str, Path]:
    data = root / "data"
    backups = Path(settings.get("BACKUP_DIRECTORY") or data / "backups")
    return {
        "data": data,
        "server": data / "server",
        "assets": data / "assets",
        "tls": data / "dev-tls",
        "ca": data / "lab-ca",
        "backups": backups if backups.is_absolute() else root / backups,
        "database": data / "server" / "sensibilia.db",
        "app": root / "app",
        "logs": data / "logs",
    }


def prepare(layout: dict[str, Path]) -> None:
    for name in ("server", "assets", "tls", "ca", "backups", "logs"):
        layout[name].mkdir(parents=True, exist_ok=True)


def database_url(layout: dict[str, Path]) -> str:
    return "sqlite:///" + layout["database"].as_posix()


def fingerprint(certificate: Path) -> str:
    import hashlib
    import ssl

    der = ssl.PEM_cert_to_DER_cert(certificate.read_text(encoding="ascii"))
    digest = hashlib.sha256(der).hexdigest().upper()
    return ":".join(digest[i : i + 2] for i in range(0, len(digest), 2))


# --- Backup, status, restore ----------------------------------------------------------------


def run_backup(layout: dict[str, Path]) -> Path:
    if not layout["database"].exists():
        raise Problem("There is no database yet. Start Sensibilia once first.")
    prepare(layout)
    archive = operations.backup(layout["database"], layout["backups"], RELEASE)
    operations.verify(archive)
    # Losing the tablet-app signing key means every tablet must uninstall the app first.
    key_folder = layout["data"] / "tablet-app"
    if (key_folder / "signing.p12").is_file():
        copy = layout["backups"] / "tablet-app-signing"
        copy.mkdir(exist_ok=True)
        for name in ("signing.p12", "signing.pass"):
            if (key_folder / name).is_file():
                shutil.copyfile(key_folder / name, copy / name)
    return archive


def backup_status(layout: dict[str, Path], max_age_hours: float = 26) -> dict:
    import json

    try:
        receipt = json.loads((layout["backups"] / "last-success.json").read_text(encoding="utf-8"))
        operations.verify(layout["backups"] / receipt["backup"])
    except (OSError, KeyError, ValueError) as error:
        raise Problem("There is no verified backup. Run Back up.bat.") from error
    age = (datetime.now(UTC) - datetime.fromisoformat(receipt["created_at"])).total_seconds()
    if not 0 <= age <= max_age_hours * 3600:
        raise Problem(f"The last verified backup is older than {max_age_hours:g} hours.")
    return receipt


def list_backups(layout: dict[str, Path]) -> list[Path]:
    return sorted(layout["backups"].glob("*.db"), reverse=True)


def run_restore(layout: dict[str, Path], name: str, stamp: str | None = None) -> Path:
    """Put a backup back; the data it replaces moves to data/before-restore-<time>."""
    if "/" in name or "\\" in name or not name.endswith(".db"):
        raise Problem("Give a backup file name from the backup folder, ending in .db.")
    archive = layout["backups"] / name
    if not archive.is_file():
        raise Problem(f"No such backup: {archive}")
    operations.verify(archive)  # refuse a damaged backup before moving anything
    aside = layout["data"] / f"before-restore-{stamp or datetime.now().strftime('%Y%m%dT%H%M%S')}"
    aside.mkdir(parents=True)
    for name_ in ("server", "assets"):
        if layout[name_].exists():
            layout[name_].replace(aside / name_)
    prepare(layout)
    try:
        operations.restore(archive, layout["database"], RELEASE)
    except Exception as error:
        raise Problem(f"The restore failed. Your data from before is in {aside}.") from error
    return aside


# --- Firewall ---------------------------------------------------------------------------------


def firewall_rule_commands() -> list[list[str]]:
    commands = []
    for port in (HTTPS_PORT, HTTP_PORT):
        name = f"Sensibilia tablets {port}"
        commands.append(["netsh", "advfirewall", "firewall", "delete", "rule", f"name={name}"])
        commands.append(
            [
                "netsh", "advfirewall", "firewall", "add", "rule", f"name={name}",
                "dir=in", "action=allow", "protocol=TCP", f"localport={port}", "profile=private",
            ]
        )  # fmt: skip
    return commands


def run_firewall() -> None:
    import ctypes

    if not ctypes.windll.shell32.IsUserAnAdmin():  # type: ignore[attr-defined]
        # Ask Windows for administrator rights once, then run this same command again.
        params = "-m sensibilia.portable firewall"
        ctypes.windll.shell32.ShellExecuteW(  # type: ignore[attr-defined]
            None, "runas", sys.executable, params, str(home()), 1
        )
        return
    for command in firewall_rule_commands():
        subprocess.run(command, check=False, capture_output=True)  # delete of a missing rule fails
    print("Tablets on this network can now reach Sensibilia (private networks only).")
    time.sleep(3)


# --- Start ------------------------------------------------------------------------------------


def child_environment(
    root: Path, layout: dict[str, Path], settings: dict[str, str], address: str = ""
) -> dict:
    env = dict(os.environ)
    env.update(
        SENSIBILIA_DATABASE_URL=database_url(layout),
        SENSIBILIA_ASSETS_DIRECTORY=str(layout["assets"]),
        SENSIBILIA_ROOT=str(layout["app"]),
        SENSIBILIA_RELEASE=RELEASE,
        SENSIBILIA_RESEARCHER_TOKEN=settings.get("DEV_RESEARCHER_KEY", ""),
        SENSIBILIA_OPERATOR_TOKEN=settings.get("DEV_OPERATOR_KEY", ""),
        SENSIBILIA_LAN_ADDRESS=address,
        # Optional analysis add-on; absent until 'Add analysis (R).bat' runs.
        SENSIBILIA_ANALYSIS_RUNTIME=str(layout["data"] / "analysis-runtime"),
    )
    return env


def caddy_environment(layout: dict[str, Path], address: str) -> dict:
    env = dict(os.environ)
    env.update(
        DEV_LAN_ADDRESS=address,
        SENSIBILIA_UPSTREAM=f"127.0.0.1:{API_PORT}",
        # Caddy keeps its authority under $XDG_DATA_HOME/caddy, as in the Docker install.
        XDG_DATA_HOME=str(layout["tls"]),
        XDG_CONFIG_HOME=str(layout["data"] / "caddy-config"),
        SENSIBILIA_CA_ROOT=(layout["tls"] / "caddy" / "pki" / "authorities" / "local").as_posix(),
        SENSIBILIA_TABLET_APP=(layout["data"] / "tablet-app").as_posix(),
    )
    return env


def migrate(layout: dict[str, Path], env: dict) -> None:
    """Upgrade the database to this release, backing up first when there is something to lose."""
    if layout["database"].exists():
        try:
            current = operations.inspect_database(layout["database"])["revision"]
        except Exception:  # an unreadable database is reported by the upgrade below
            current = None
        if current != operations.EXPECTED_REVISION:
            print("Backing up before updating the database...")
            archive = operations.backup(
                layout["database"], layout["backups"], RELEASE, purpose="pre-upgrade"
            )
            operations.verify(archive)
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=layout["app"],
        env=env,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        log = layout["logs"] / f"portable-{datetime.now():%Y%m%d}.log"
        log.write_text(result.stdout + result.stderr, encoding="utf-8")
        raise Problem(f"The database could not be updated. Details: {log}")


def wait_for(url: str, seconds: float = 40, context=None) -> bool:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        with contextlib.suppress(OSError, ValueError):
            urllib.request.urlopen(url, timeout=3, context=context)  # noqa: S310
            return True
        time.sleep(0.5)
    return False


def kill_on_close_job(process: subprocess.Popen | None = None, memory: int | None = None):
    """A Windows Job Object that ends the child processes when this launcher exits.

    The launcher joins the job, so the server and Caddy it starts inherit it; when the launcher
    ends for any reason (window closed, killed), Windows ends them too and frees the ports.
    With `process`, that child joins instead (an analysis recipe), optionally capped at `memory`
    bytes; close the returned handle with `close_job` when it has finished.
    """
    import ctypes
    from ctypes import wintypes

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateJobObjectW.restype = wintypes.HANDLE
    kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
    kernel.SetInformationJobObject.argtypes = [
        wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD,
    ]  # fmt: skip
    kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    kernel.GetCurrentProcess.restype = wintypes.HANDLE

    class Basic(ctypes.Structure):
        _fields_ = [
            ("PerProcessUserTimeLimit", ctypes.c_int64),
            ("PerJobUserTimeLimit", ctypes.c_int64),
            ("LimitFlags", wintypes.DWORD),
            ("MinimumWorkingSetSize", ctypes.c_size_t),
            ("MaximumWorkingSetSize", ctypes.c_size_t),
            ("ActiveProcessLimit", wintypes.DWORD),
            ("Affinity", ctypes.c_size_t),
            ("PriorityClass", wintypes.DWORD),
            ("SchedulingClass", wintypes.DWORD),
        ]

    class IoCounters(ctypes.Structure):
        _fields_ = [(name, ctypes.c_uint64) for name in ("a", "b", "c", "d", "e", "f")]

    class Extended(ctypes.Structure):
        _fields_ = [
            ("Basic", Basic),
            ("Io", IoCounters),
            ("ProcessMemoryLimit", ctypes.c_size_t),
            ("JobMemoryLimit", ctypes.c_size_t),
            ("PeakProcessMemoryUsed", ctypes.c_size_t),
            ("PeakJobMemoryUsed", ctypes.c_size_t),
        ]

    job = kernel.CreateJobObjectW(None, None)
    if not job:
        raise ctypes.WinError(ctypes.get_last_error())
    info = Extended()
    info.Basic.LimitFlags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if memory:
        info.Basic.LimitFlags |= 0x100  # JOB_OBJECT_LIMIT_PROCESS_MEMORY
        info.ProcessMemoryLimit = memory
    if not kernel.SetInformationJobObject(job, 9, ctypes.byref(info), ctypes.sizeof(info)):
        raise ctypes.WinError(ctypes.get_last_error())
    target = wintypes.HANDLE(process._handle) if process else kernel.GetCurrentProcess()
    if not kernel.AssignProcessToJobObject(job, target):
        raise ctypes.WinError(ctypes.get_last_error())
    return job


def close_job(job) -> None:
    """Close a Job Object handle; with kill-on-close this ends anything still inside it."""
    import ctypes
    from ctypes import wintypes

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.CloseHandle(job)


def run_start(open_browser: bool = True) -> None:
    root = home()
    settings_file = root / "settings.env"
    if not settings_file.exists():
        settings_file.write_text(
            "# Sensibilia settings. Remove the # from a line to use it.\n"
            "# DEV_LAN_ADDRESS=192.168.1.20\n"
            "# BACKUP_DIRECTORY=E:\\SensibiliaBackups\n",
            encoding="utf-8",
        )
    settings = read_settings(settings_file)
    layout = paths(root, settings)
    prepare(layout)
    caddy = layout["app"] / "caddy.exe"
    if not caddy.is_file():
        raise Problem("app\\caddy.exe is missing. Unzip Sensibilia again.")
    for port in (HTTPS_PORT, HTTP_PORT, API_PORT):
        if not port_is_free(port):
            raise Problem(
                "Sensibilia already seems to be running (another window), or another program "
                f"uses port {port}. Close the other window and try again."
            )
    address = lan_address(settings.get("DEV_LAN_ADDRESS", ""))
    try:
        kill_on_close_job()  # the handle stays open until this process ends
    except OSError as error:
        print(f"Note: closing this window may leave Sensibilia running ({error}).")
    env = child_environment(root, layout, settings, address)
    migrate(layout, env)
    log = (layout["logs"] / f"portable-{datetime.now():%Y%m%d}.log").open("a", encoding="utf-8")
    server = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "sensibilia.main:app", "--host", "127.0.0.1",
         "--port", str(API_PORT), "--workers", "1", "--proxy-headers", "--no-access-log"],
        cwd=layout["app"], env=env, stdout=log, stderr=subprocess.STDOUT,
    )  # fmt: skip
    proxy = None
    try:
        if not wait_for(f"http://127.0.0.1:{API_PORT}/health"):
            raise Problem(f"The server did not start. Details: {log.name}")
        proxy = subprocess.Popen(
            [
                str(caddy), "run", "--adapter", "caddyfile",
                "--config", str(layout["app"] / "Caddyfile"),
            ],
            cwd=layout["app"], env=caddy_environment(layout, address),
            stdout=log, stderr=subprocess.STDOUT,
        )  # fmt: skip
        certificate = layout["ca"] / "root.crt"
        note = save_root(layout, certificate, proxy)
        has_tablet_app = refresh_tablet_app(layout, certificate)
        tablet = (
            f"Tablet app: on a tablet open http://{address}:{HTTP_PORT}/tablet-app.apk"
            if has_tablet_app
            else "Tablet app: not included in this copy (see android/INSTALL.md)."
        )
        sign_in = (
            "Sign-in: researcher and operator keys are set (see settings.env)."
            if any(settings.get(name) for name in KEY_NAMES)
            else "Sign-in: none. Anyone on this network can open the researcher screen;\n"
            "  run 'Set sign-in keys.bat' before collecting."
        )
        print(
            f"\nSensibilia is running. Close this window to stop it.\n"
            f"  This computer: https://localhost:{HTTPS_PORT}/researcher/\n"
            f"  Other devices: https://{address}:{HTTPS_PORT}/researcher/\n"
            f"{note}\n{tablet}\n{sign_in}\n"
            f"Backups: run Back up.bat (into {layout['backups']}); keep a copy on a second disk.\n"
            "If tablets cannot connect, run 'Allow tablets (firewall).bat' once."
        )
        if open_browser:
            import webbrowser

            webbrowser.open(f"https://localhost:{HTTPS_PORT}/researcher/")
        while server.poll() is None and proxy.poll() is None:
            time.sleep(1)
        raise Problem("Sensibilia stopped unexpectedly. Details: " + log.name)
    except KeyboardInterrupt:
        print("Stopping...")
    finally:
        for process in (proxy, server):
            if process and process.poll() is None:
                process.terminate()
        for process in (proxy, server):
            if process:
                with contextlib.suppress(subprocess.TimeoutExpired):
                    process.wait(10)
                if process.poll() is None:
                    process.kill()


def save_root(layout: dict[str, Path], target: Path, proxy: subprocess.Popen) -> str:
    """Wait for Caddy to create its authority, copy the public root, report its fingerprint."""
    source = layout["tls"] / "caddy" / "pki" / "authorities" / "local" / "root.crt"
    deadline = time.monotonic() + 30
    while not source.is_file() and time.monotonic() < deadline:
        if proxy.poll() is not None:
            raise Problem("The secure connection part did not start. Details are in data/logs.")
        time.sleep(0.5)
    if not source.is_file():
        return "No root certificate yet: close this window and start again."
    shutil.copyfile(source, target)
    return f"Root certificate saved to {target}\n  SHA-256 {fingerprint(target)}"


def refresh_tablet_app(layout: dict[str, Path], certificate: Path) -> bool:
    """Re-bake the tablet app when the root changed. False when this install has no template."""
    from sensibilia import tablet_app

    try:
        tablet_app.ensure(layout["app"], layout["data"] / "tablet-app", certificate)
    except tablet_app.Unavailable:
        return False
    return True


# --- Entry point ------------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("start").add_argument("--no-browser", action="store_true")
    sub.add_parser("backup")
    sub.add_parser("status")
    sub.add_parser("restore")
    sub.add_parser("keys")
    sub.add_parser("firewall")
    sub.add_parser("tablet-app")
    args = parser.parse_args(argv)
    sys.stdout.reconfigure(line_buffering=True)  # the window shows progress as it happens
    root = home()
    settings_file = root / "settings.env"
    layout = paths(root, read_settings(settings_file))
    try:
        if args.command == "start":
            run_start(open_browser=not args.no_browser)
        elif args.command == "backup":
            archive = run_backup(layout)
            print(f"Backup written: {archive}\nKeep a copy on a second disk.")
        elif args.command == "status":
            receipt = backup_status(layout)
            print(f"Last verified backup: {receipt['created_at']}")
        elif args.command == "restore":
            names = list_backups(layout)
            if not names:
                raise Problem("There are no backups in " + str(layout["backups"]))
            for number, path in enumerate(names, 1):
                print(f"  {number}. {path.name}")
            choice = input("Number of the backup to restore (empty to cancel): ").strip()
            if not choice:
                return 0
            if not choice.isdigit() or not 1 <= int(choice) <= len(names):
                raise Problem("That is not one of the numbers in the list.")
            aside = run_restore(layout, names[int(choice) - 1].name)
            print(f"Restored. The data it replaced is in {aside}. Start Sensibilia and check it.")
        elif args.command == "keys":
            shown = make_keys(settings_file)
            if shown is None:
                print("Keys are already set in settings.env; leaving them as they are.")
            else:
                print(f"Sign-in keys (also saved in settings.env, shown only now):\n{shown}")
                print("Restart Sensibilia for the keys to take effect.")
        elif args.command == "firewall":
            run_firewall()
        elif args.command == "tablet-app":
            from sensibilia import tablet_app

            certificate = layout["ca"] / "root.crt"
            if not certificate.is_file():
                raise Problem("Start Sensibilia once first, so it can create its certificate.")
            apk = tablet_app.ensure(layout["app"], layout["data"] / "tablet-app", certificate)
            print(
                f"Tablet app: {apk}\nOn a tablet, open http://{lan_address()}:{HTTP_PORT}/tablet-app.apk"
            )
    except Problem as problem:
        print(f"\n{problem}", file=sys.stderr)
        return 1
    except Exception as error:  # last resort: a plain message; the detail goes to the log
        layout["logs"].mkdir(parents=True, exist_ok=True)
        log = layout["logs"] / f"portable-{datetime.now():%Y%m%d}.log"
        with log.open("a", encoding="utf-8") as stream:
            stream.write(f"{datetime.now().isoformat()} {args.command}: {error!r}\n")
        print(f"\nSomething went wrong ({type(error).__name__}). Details: {log}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
