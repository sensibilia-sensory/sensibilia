"""Staff shortcuts for the deployment in compose.yaml. Python 3.13+, Docker Compose v2."""

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIGEST = re.compile(r"[^\s]+@sha256:[0-9a-f]{64}\Z")


def compose_arguments(configuration: Path) -> list[str]:
    return ["docker", "compose", "--env-file", str(configuration), "-f", str(ROOT / "compose.yaml")]


def execute(arguments: list[str], *, capture=False):
    return subprocess.run(arguments, check=True, text=True, capture_output=capture, cwd=ROOT)


def released_images(compose: list[str]):
    # Read structured configuration without printing configuration/secrets.
    config = json.loads(execute([*compose, "config", "--format", "json"], capture=True).stdout)
    for name in ("app", "tls"):
        if not DIGEST.fullmatch(config["services"][name]["image"]):
            raise ValueError("Application and TLS images must be pinned by sha256 digest")


def stopped(compose: list[str]):
    running = execute([*compose, "ps", "--status", "running", "--quiet", "app"], capture=True)
    if running.stdout.strip():
        raise ValueError("App still running; maintenance refused")


def perform(
    compose: list[str], action: str, *, previous_release=None, archive=None, retention=False
):
    released_images(compose)
    if action in {"initialize", "upgrade", "restore"}:
        if action == "upgrade" and not DIGEST.fullmatch(previous_release or ""):
            raise ValueError("Upgrade requires the exact previous release digest")
        execute([*compose, "stop", "app", "tls"])
        stopped(compose)
        arguments = [
            *compose,
            "--profile",
            "maintenance",
            "run",
            "--rm",
            "--no-deps",
            "migrate",
            "python",
            "-m",
            "sensibilia.operations",
        ]
        if action == "upgrade":
            arguments += ["--release", previous_release, "migrate", "--app-stopped"]
        elif action == "initialize":
            arguments += ["initialize", "--app-stopped"]
        else:
            if not archive or Path(archive).name != archive or not archive.endswith(".db"):
                raise ValueError("Select a backup filename, and configure a fresh DATA_VOLUME")
            arguments += ["restore", "/backup/" + archive, "--target", "/data/sensibilia.db"]
        execute(arguments)
        # Deliberately no start on success or failure: staff inspect/rehearse explicitly.
    elif action in {"backup", "status"}:
        execute(
            [
                *compose,
                "--profile",
                "scheduler",
                "run",
                "--rm",
                "--no-deps",
                "backup",
                "python",
                "-m",
                "sensibilia.operations",
                action,
                *(["--retain"] if action == "backup" and retention else []),
            ]
        )
    elif action == "start":
        execute([*compose, "up", "-d", "--wait", "app", "tls"])
    else:
        execute([*compose, "stop", "app", "tls"])


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=ROOT / "deploy" / "private" / "lab.env")
    parser.add_argument(
        "action", choices=["initialize", "upgrade", "restore", "backup", "status", "start", "stop"]
    )
    parser.add_argument("--previous-release")
    parser.add_argument("--archive")
    parser.add_argument("--retention", action="store_true")
    args = parser.parse_args(argv)
    try:
        perform(
            compose_arguments(args.config),
            args.action,
            previous_release=args.previous_release,
            archive=args.archive,
            retention=args.retention,
        )
        print("Command succeeded. Maintenance leaves collection stopped; inspect before Start.")
        return 0
    except (subprocess.SubprocessError, OSError, ValueError, KeyError):
        print(
            "Command failed. Do not start collection; preserve volumes/queues and contact support.",
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
