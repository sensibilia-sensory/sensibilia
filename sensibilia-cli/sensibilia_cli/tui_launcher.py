"""Keep Bun/OpenTUI optional for everyone using only the Python CLI."""

import shutil
import subprocess
import sys
from pathlib import Path

from .document import AuthoringError


def launch(filename=None, *, install=True):
    bun = shutil.which("bun")
    if not bun:
        raise AuthoringError("Install Bun to run the terminal workbench, then retry this command.")
    project = Path(__file__).with_name("tui")
    entrypoint = project / "src" / "index.ts"
    if not entrypoint.is_file():
        raise AuthoringError(
            "The terminal interface assets are missing; reinstall sensibilia-flow-cli."
        )
    dependency = project / "node_modules" / "@opentui" / "core" / "package.json"
    if not dependency.is_file():
        if not install:
            raise AuthoringError(
                "TUI dependencies are missing. Run without --no-install to install them."
            )
        print(
            "Installing the optional terminal interface dependencies in its own folder…", flush=True
        )
        result = subprocess.run(
            [bun, "--no-env-file", "install", "--frozen-lockfile"], cwd=project, check=False
        )
        if result.returncode:
            raise AuthoringError(
                "TUI dependency installation failed; the Python CLI is still available."
            )
    command = [bun, "--no-env-file", str(entrypoint), "--python", sys.executable]
    if filename:
        command.append(str(Path(filename).resolve()))
    return subprocess.run(command, check=False).returncode
