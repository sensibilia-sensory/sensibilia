"""Run one recipe in R, isolated: its own temporary folder, a reduced environment, hard limits."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from sensibilia.analysis.registry import R_DIRECTORY, Recipe
from sensibilia.analysis_setup import r_environment, rscript

TIMEOUT = 120
MEMORY = 1024 * 1024 * 1024
RESULT_LIMIT = 1024 * 1024
FIGURE_LIMIT = 1024 * 1024
MAX_FIGURES = 8


class RecipeFailed(Exception):
    """Shown to researchers; written in plain words."""


def limit_process(process: subprocess.Popen):
    """Windows: a Job Object with a memory cap that also ends R if the server ends."""
    if sys.platform != "win32":
        return None
    import ctypes

    from sensibilia.portable import kill_on_close_job

    try:
        return kill_on_close_job(process=process, memory=MEMORY)
    except (OSError, AttributeError, ctypes.ArgumentError):
        return None


def posix_limits():  # pragma: no cover - Linux only
    import resource

    resource.setrlimit(resource.RLIMIT_AS, (MEMORY, MEMORY))
    resource.setrlimit(resource.RLIMIT_CPU, (TIMEOUT, TIMEOUT))


def run(
    recipe: Recipe,
    files: dict[str, bytes],
    runtime: Path,
    cancelled=lambda: False,
) -> tuple[dict, dict[str, bytes]]:
    """Return (result JSON, {figure name: PNG bytes}). Raises RecipeFailed with a plain reason."""
    executable = rscript(runtime)
    if not executable.is_file():
        raise RecipeFailed("The analysis add-on is not installed on the server.")
    with tempfile.TemporaryDirectory(prefix="sensibilia-recipe-") as scratch_name:
        scratch = Path(scratch_name)
        source, output, temporary = scratch / "input", scratch / "output", scratch / "tmp"
        for folder in (source, output, temporary):
            folder.mkdir()
        for name, content in files.items():
            (source / name).write_bytes(content)
        shutil.copyfile(R_DIRECTORY / "common.R", source / "common.R")
        shutil.copyfile(recipe.path, source / "recipe.R")
        env = r_environment(runtime / "library")
        env.update(TMPDIR=str(temporary), TMP=str(temporary), TEMP=str(temporary))
        log = scratch / "log.txt"
        with log.open("wb") as stream:
            process = subprocess.Popen(
                [str(executable), "--vanilla", str(source / "recipe.R"), str(source), str(output)],
                cwd=scratch,
                env=env,
                stdin=subprocess.DEVNULL,
                stdout=stream,
                stderr=subprocess.STDOUT,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                preexec_fn=None if sys.platform == "win32" else posix_limits,  # noqa: PLW1509
            )
            job = limit_process(process)
            deadline = time.monotonic() + TIMEOUT
            try:
                while process.poll() is None:
                    if cancelled():
                        raise RecipeFailed("Cancelled.")
                    if time.monotonic() > deadline:
                        raise RecipeFailed(f"The analysis took longer than {TIMEOUT} seconds.")
                    time.sleep(0.1)
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait(10)
                if job:
                    from sensibilia.portable import close_job

                    close_job(job)
        result_path = output / "result.json"
        if process.returncode or not result_path.is_file():
            message = (
                (output / "problem.txt").read_text(encoding="utf-8")[:500]
                if (output / "problem.txt").is_file()
                else None
            )
            if message:
                raise RecipeFailed(message)
            tail = log.read_text(encoding="utf-8", errors="replace")[-400:]
            raise RecipeFailed("The analysis stopped with an error. Details: " + tail.strip())
        if result_path.stat().st_size > RESULT_LIMIT:
            raise RecipeFailed("The analysis produced more output than allowed.")
        result = json.loads(result_path.read_text(encoding="utf-8"))
        figures = {}
        for path in sorted(output.glob("*.png")):
            if len(figures) == MAX_FIGURES or path.stat().st_size > FIGURE_LIMIT:
                raise RecipeFailed("The analysis produced more figures than allowed.")
            figures[path.name] = path.read_bytes()
        return result, figures
