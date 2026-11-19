"""Administrative one-job worker. Only a fixed recipe enters the isolated container."""

import argparse
import json
import re
import subprocess
import tempfile
import time
from pathlib import Path
from uuid import UUID

from sqlalchemy.orm import Session

from sensibilia.config import Settings
from sensibilia.data_service import canonical
from sensibilia.db import EXPECTED_REVISION, make_engine
from sensibilia.models import AnalysisJob, DatasetSnapshot, timestamp
from sensibilia.snapshots import RECIPE, RECIPE_PATH, sha, verified_file

POLICY = [
    "--network=none",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--user=65534:65534",
    "--pids-limit=32",
    "--memory=128m",
    "--memory-swap=128m",
    "--cpus=1",
    "--tmpfs=/tmp:rw,noexec,nosuid,size=16m",
    "--ipc=none",
    "--pull=never",
]
TIMEOUT = 60
OUTPUT_LIMIT = 1024 * 1024


def docker_command(directory, image, name):
    if not re.fullmatch(r"[a-zA-Z0-9./:_-]+@sha256:[0-9a-f]{64}", image):
        raise ValueError("Use an explicitly provisioned digest-pinned Python image")
    return [
        "docker",
        "run",
        "--rm",
        "--name",
        name,
        *POLICY,
        "--mount",
        f"type=bind,source={Path(directory).resolve()},target=/input,readonly",
        "--workdir=/tmp",
        "--entrypoint=python",
        image,
        "-I",
        "-B",
        "/input/recipe.py",
        "/input/dataset.json",
    ]


def isolated_run(content, image, job_id, cancelled):
    name = "sensibilia-analysis-" + str(UUID(job_id))
    with tempfile.TemporaryDirectory(prefix="sensibilia-analysis-") as directory:
        target = Path(directory)
        (target / "dataset.json").write_bytes(content)
        (target / "recipe.py").write_bytes(RECIPE_PATH.read_bytes())
        with tempfile.TemporaryFile() as output:
            command = docker_command(target, image, name)
            command[1] = "create"
            created = subprocess.run(
                command,
                capture_output=True,
                timeout=30,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                check=False,
            )
            if created.returncode:
                raise RuntimeError("Isolated container creation failed; verify runtime/image")
            process = subprocess.Popen(
                ["docker", "start", "--attach", name],
                stdout=output,
                stderr=output,
                stdin=subprocess.DEVNULL,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            deadline = time.monotonic() + TIMEOUT
            try:
                while process.poll() is None:
                    if cancelled():
                        raise RuntimeError("Job cancelled")
                    if time.monotonic() > deadline:
                        raise RuntimeError("Analysis exceeded 60 second limit")
                    if output.seek(0, 2) > OUTPUT_LIMIT:
                        raise RuntimeError("Analysis output limit exceeded")
                    time.sleep(0.1)
                if process.returncode:
                    raise RuntimeError(
                        "Isolated runner failed; verify the provisioned image/runtime"
                    )
                if output.seek(0, 2) > OUTPUT_LIMIT:
                    raise RuntimeError("Analysis output limit exceeded")
                output.seek(0)
                return json.loads(output.read())
            finally:
                # Cancellation/timeout must stop the container, not only the CLI process.
                subprocess.run(
                    ["docker", "rm", "-f", name],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    timeout=10,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                    check=False,
                )
                if process.poll() is None:
                    process.kill()
                    process.wait(timeout=10)


def run_job(engine, job_id, image, runner=isolated_run):
    # Validate the runtime before claiming anything; fail closed without a container.
    docker_command(Path(tempfile.gettempdir()), image, "validation")
    with Session(engine, expire_on_commit=False) as db:
        db.connection(execution_options={"sqlite_begin_mode": "IMMEDIATE"})
        job = db.get(AnalysisJob, str(UUID(job_id)))
        if not job or job.status != "queued":
            raise ValueError("Job must exist and be queued")
        item = db.get(DatasetSnapshot, job.snapshot_id)
        content = verified_file(item, "dataset.json")
        if job.recipe != RECIPE or job.recipe_sha256 != sha(RECIPE_PATH.read_bytes()):
            raise ValueError("Queued recipe does not match installed reviewed code")
        job.status, job.started_at, job.image = "running", timestamp(), image
        expected_hash = item.manifest["dataset_sha256"]
        db.commit()

    def cancelled():
        with Session(engine) as db:
            return db.get(AnalysisJob, job_id).status == "cancelled"

    result, error = None, None
    try:
        result = runner(content, image, job_id, cancelled)
        from sensibilia.analysis_recipe import census

        if result != census(content) or result.get("dataset_sha256") != expected_hash:
            raise ValueError("Recipe result failed dataset/fixture reconciliation")
    except Exception as e:
        error = str(e)[:500]
    with Session(engine) as db:
        db.connection(execution_options={"sqlite_begin_mode": "IMMEDIATE"})
        job = db.get(AnalysisJob, job_id)
        if job.status == "cancelled":
            return "cancelled"
        job.finished_at = timestamp()
        job.status = "failed" if error else "succeeded"
        job.error = error
        job.result = None if error else result
        job.result_sha256 = None if error else sha(canonical(result).encode())
        db.commit()
        return job.status


def recover_job(engine, job_id, staff):
    """An interrupted running job cannot silently produce a result or be rerun."""
    name = "sensibilia-analysis-" + str(UUID(job_id))
    removed = subprocess.run(
        ["docker", "rm", "-f", name], capture_output=True, text=True, timeout=10
    )
    if removed.returncode and "No such container" not in removed.stderr:
        raise RuntimeError("Cannot verify removal of the interrupted container")
    with Session(engine) as db:
        db.connection(execution_options={"sqlite_begin_mode": "IMMEDIATE"})
        job = db.get(AnalysisJob, job_id)
        if not job or job.status != "running":
            raise ValueError("Recovery requires a running job")
        job.status, job.finished_at = "failed", timestamp()
        job.error = (
            "Interrupted worker recovered by "
            + staff
            + "; queue a new job against the same snapshot"
        )
        db.commit()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("job_id", type=UUID)
    parser.add_argument(
        "--image", required=True, help="Locally provisioned Python image@sha256:digest"
    )
    parser.add_argument(
        "--recover", metavar="STAFF", help="Stop retained container and fail an interrupted job"
    )
    args = parser.parse_args()
    engine = make_engine(Settings().database_url)
    try:
        from sqlalchemy import text

        with engine.connect() as connection:
            if (
                connection.scalar(text("SELECT version_num FROM alembic_version"))
                != EXPECTED_REVISION
            ):
                raise ValueError("Migrate explicitly before running the worker")
        if args.recover:
            recover_job(engine, str(args.job_id), args.recover)
        else:
            print(run_job(engine, str(args.job_id), args.image))
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
