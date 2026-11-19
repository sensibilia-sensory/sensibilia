"""Immutable cuts, exact export compatibility, reviewed census and isolated execution."""

import csv
import hashlib
import io
import json
import shutil
import subprocess
import zipfile
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from test_api import event, provision, study, submit

from sensibilia.analysis_recipe import census
from sensibilia.analysis_worker import POLICY, docker_command, run_job
from sensibilia.models import AnalysisJob
from sensibilia.snapshots import RECIPE_PATH, sha


def setup(client, headers):
    data, test, version = study(client, headers)
    session, token = provision(client, headers, version)
    base = f"/studies/{data['id']}/snapshots"
    return data, test, version, session, token, base


def create(client, headers, base, version=None, history="all"):
    response = client.post(
        base,
        headers=headers,
        json=dict(
            label="Reviewed synthetic cut",
            staff_name="Scientist",
            study_version_id=version,
            history=history,
        ),
    )
    assert response.status_code == 201, response.text
    return response.json()


def archive(client, headers, base, item):
    response = client.get(base + "/" + item["id"] + "/export", headers=headers)
    assert response.status_code == 200, response.text
    return zipfile.ZipFile(io.BytesIO(response.content))


def queue(client, headers, base, item):
    response = client.post(
        base + "/" + item["id"] + "/jobs", headers=headers, json={"staff_name": "Scientist"}
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_cut_freezes_exports_packages_history_and_hashes(client, researcher_headers):
    data, test, version, session, token, base = setup(client, researcher_headers)
    original = event(test)
    assert submit(client, session, token, [original]).status_code == 200
    item = create(client, researcher_headers, base, version["id"])
    z = archive(client, researcher_headers, base, item)
    manifest = json.loads(z.read("manifest.json"))
    for name, digest in manifest["files"].items():
        content = z.read(name)
        assert len(content) == digest["byte_size"] and sha(content) == digest["sha256"]
    assert (
        z.read("long.csv").decode()
        == client.get(
            f"/studies/{data['id']}/export?study_version_id={version['id']}",
            headers=researcher_headers,
        ).text
    )
    assert manifest["row_count"] == 1 and manifest["event_counts"]["responses"] == 1
    provenance = json.loads(z.read("provenance.json"))
    assert provenance["packages"][0]["package"]["study_version"]["id"] == version["id"]
    assert provenance["methods"][0]["configuration_schema"]
    assert session["session_token"].encode() not in z.read("provenance.json")
    assert b"token_hash" not in z.read("provenance.json")
    corrected = event(
        test, value={"state": "rated", "rating": 2}, supersedes_event_id=original["client_event_id"]
    )
    assert submit(client, session, token, [corrected]).status_code == 200
    assert submit(client, session, token, [corrected]).json()["events"][0]["status"] == "duplicate"
    assert archive(client, researcher_headers, base, item).read("long.csv") == z.read("long.csv")
    current = create(client, researcher_headers, base, version["id"], "current")
    current_z = archive(client, researcher_headers, base, current)
    assert len(json.loads(current_z.read("dataset.json"))) == 1
    assert len(json.loads(current_z.read("provenance.json"))["ledgers"]["responses"]) == 2
    assert current["manifest"]["dataset_sha256"] != item["manifest"]["dataset_sha256"]
    wide = list(csv.DictReader(io.StringIO(z.read("wide.csv").decode())))
    recovered = [
        r for row in wide for k, v in row.items() if k.startswith("w_") and v for r in json.loads(v)
    ]
    assert recovered == json.loads(z.read("dataset.json"))
    first = client.get(base + "/" + item["id"] + "/export", headers=researcher_headers).content
    assert (
        first == client.get(base + "/" + item["id"] + "/export", headers=researcher_headers).content
    )


def test_empty_published_and_blank_sessions(client, researcher_headers):
    data, test, version = study(client, researcher_headers)
    base = f"/studies/{data['id']}/snapshots"
    item = create(client, researcher_headers, base)
    assert item["manifest"]["row_count"] == 0 and item["manifest"]["session_count"] == 0
    session, token = provision(client, researcher_headers, version)
    second = create(client, researcher_headers, base)
    assert second["manifest"]["session_count"] == 1
    assert archive(client, researcher_headers, base, item).read("dataset.json") == b"[]"


@pytest.mark.parametrize("suffix", ["", "/{id}", "/{id}/export", "/{id}/jobs"])
def test_authorization_and_foreign_snapshot(client, researcher_headers, suffix):
    data, test, version, session, token, base = setup(client, researcher_headers)
    item = create(client, researcher_headers, base)
    target = base + suffix.replace("{id}", item["id"])
    assert client.get(target).status_code == 401
    assert client.get(target, headers=token).status_code == 401
    other = client.post("/studies", headers=researcher_headers, json={"title": "Other"}).json()
    if suffix:
        foreign = target.replace(data["id"], other["id"])
        assert client.get(foreign, headers=researcher_headers).status_code == 404


def test_draft_foreign_bad_fields_and_bounds(client, researcher_headers, monkeypatch):
    data, test, version, session, token, base = setup(client, researcher_headers)
    other = client.post("/studies", headers=researcher_headers, json={"title": "Draft"}).json()
    body = dict(label="cut", staff_name="Scientist", study_version_id=other["versions"][0]["id"])
    assert client.post(base, headers=researcher_headers, json=body).status_code == 404
    assert (
        client.post(
            f"/studies/{other['id']}/snapshots", headers=researcher_headers, json=body
        ).status_code
        == 409
    )
    assert (
        client.post(
            base, headers=researcher_headers, json={"label": " ", "staff_name": "S"}
        ).status_code
        == 422
    )
    import sensibilia.snapshots as module

    monkeypatch.setattr(module, "MAX_BYTES", 1)
    assert (
        client.post(
            base, headers=researcher_headers, json={"label": "cut", "staff_name": "S"}
        ).status_code
        == 422
    )
    assert client.get(base, headers=researcher_headers).json() == []


def test_snapshot_and_terminal_job_storage_immutable(client, researcher_headers):
    data, test, version, session, token, base = setup(client, researcher_headers)
    item = create(client, researcher_headers, base)
    job = queue(client, researcher_headers, base, item)
    jobbase = base + "/" + item["id"] + "/jobs/" + job["id"]
    for table, id in (("dataset_snapshots", item["id"]), ("analysis_jobs", job["id"])):
        with Session(client.app.state.engine) as db, pytest.raises(IntegrityError):
            db.execute(text(f"DELETE FROM {table} WHERE id=:id"), {"id": id})
    with Session(client.app.state.engine) as db, pytest.raises(IntegrityError):
        db.execute(
            text("UPDATE dataset_snapshots SET label='mutated' WHERE id=:id"), {"id": item["id"]}
        )
    assert (
        client.post(
            jobbase + "/cancel", headers=researcher_headers, json={"staff_name": "Operator"}
        ).json()["status"]
        == "cancelled"
    )
    assert (
        client.post(
            jobbase + "/cancel", headers=researcher_headers, json={"staff_name": "Operator"}
        ).status_code
        == 200
    )
    with Session(client.app.state.engine) as db, pytest.raises(IntegrityError):
        db.execute(
            text("UPDATE analysis_jobs SET status='running' WHERE id=:id"), {"id": job["id"]}
        )
    with pytest.raises(ValueError, match="queued"):
        run_job(
            client.app.state.engine, job["id"], "python@sha256:" + "a" * 64, runner=lambda *args: {}
        )


def test_consistent_cut_with_concurrent_ingestion(client, researcher_headers, monkeypatch):
    data, test, version, session, token, base = setup(client, researcher_headers)
    import sensibilia.snapshots as module

    original = module.data_rows
    future = None
    with ThreadPoolExecutor(max_workers=1) as pool:

        def hooked(*args):
            nonlocal future
            future = pool.submit(submit, client, session, token, [event(test)])
            yield from original(*args)

        monkeypatch.setattr(module, "data_rows", hooked)
        item = create(client, researcher_headers, base)
        assert future.result(timeout=10).status_code == 200
    assert item["manifest"]["event_counts"]["responses"] == 0
    assert (
        json.loads(archive(client, researcher_headers, base, item).read("dataset.json"))[0][
            "row_kind"
        ]
        == "expected_missing"
    )
    assert len(client.get(f"/studies/{data['id']}/data", headers=researcher_headers).json()) == 1


def test_reviewed_fixture_preserves_states_and_zero():
    content = json.dumps(
        [
            dict(session_id="s", row_kind="answer", state=state, value_json=json.dumps(value))
            for state, value in [
                ("missing", None),
                ("skipped", None),
                ("unselected", []),
                ("selected", {"rating": None}),
                ("rated", 0),
                (None, "null"),
            ]
        ]
    ).encode()
    result = census(content)
    assert result["row_count"] == 6
    assert result["states"] == {
        "missing": 1,
        "null": 1,
        "rated": 1,
        "selected": 1,
        "skipped": 1,
        "unselected": 1,
    }
    assert result["dataset_sha256"] == hashlib.sha256(content).hexdigest()


def test_runtime_policy_and_no_arbitrary_scripts(tmp_path):
    image = "python@sha256:" + "a" * 64
    command = docker_command(tmp_path, image, "test")
    assert all(flag in command for flag in POLICY)
    assert "target=/input,readonly" in " ".join(command)
    assert "--entrypoint=python" in command and "-I" in command
    assert "--env" not in command and "--privileged" not in command
    assert "sensibilia.db" not in " ".join(command)
    with pytest.raises(ValueError, match="digest"):
        docker_command(tmp_path, "python:latest", "test")


@pytest.mark.parametrize("failure", ["bad-result", "exception", "cancel"])
def test_failed_or_cancelled_worker_retains_no_results(client, researcher_headers, failure):
    data, test, version, session, token, base = setup(client, researcher_headers)
    item = create(client, researcher_headers, base)
    job = queue(client, researcher_headers, base, item)

    def runner(content, image, id, cancelled):
        if failure == "exception":
            raise RuntimeError("fixture failure")
        if failure == "cancel":
            response = client.post(
                base + "/" + item["id"] + "/jobs/" + id + "/cancel",
                headers=researcher_headers,
                json={"staff_name": "Cancel scientist"},
            )
            assert response.status_code == 200 and cancelled()
        return {"wrong": 1}

    assert run_job(
        client.app.state.engine, job["id"], "python@sha256:" + "a" * 64, runner=runner
    ) == ("cancelled" if failure == "cancel" else "failed")
    response = client.get(
        base + "/" + item["id"] + "/jobs/" + job["id"], headers=researcher_headers
    ).json()
    assert response["result"] is None and response["result_sha256"] is None


def local_image():
    if not shutil.which("docker"):
        pytest.skip("Docker runtime not provisioned")
    result = subprocess.run(
        [
            "docker",
            "image",
            "inspect",
            "python:3.12.12-slim-bookworm",
            "--format",
            "{{index .RepoDigests 0}}",
        ],
        capture_output=True,
        text=True,
        timeout=15,
    )
    if result.returncode:
        pytest.skip("Digest-pinned test image/runtime not provisioned")
    return result.stdout.strip()


def test_real_isolated_recipe_reproduces_snapshot_and_no_db_access(client, researcher_headers):
    image = local_image()
    data, test, version, session, token, base = setup(client, researcher_headers)
    assert submit(client, session, token, [event(test)]).status_code == 200
    item = create(client, researcher_headers, base)
    expected = census(archive(client, researcher_headers, base, item).read("dataset.json"))
    hashes = []
    for _ in range(2):
        job = queue(client, researcher_headers, base, item)
        assert run_job(client.app.state.engine, job["id"], image) == "succeeded"
        with Session(client.app.state.engine) as db:
            record = db.get(AnalysisJob, job["id"])
            assert record.result == expected and record.recipe_sha256 == sha(
                RECIPE_PATH.read_bytes()
            )
            hashes.append(record.result_sha256)
    assert hashes[0] == hashes[1]


def test_real_container_has_no_network_or_db_mount(tmp_path):
    image = local_image()
    script = tmp_path / "recipe.py"
    script.write_text(
        "import os,json\n"
        "print(json.dumps({'db':os.path.exists('/data'),"
        "'write':os.access('/input',os.W_OK),'network':os.listdir('/sys/class/net'),"
        "'secret':os.getenv('SENSIBILIA_RESEARCHER_TOKEN')}))",
        encoding="utf-8",
    )
    (tmp_path / "dataset.json").write_text("[]")
    result = subprocess.run(
        docker_command(tmp_path, image, "sensibilia-isolation-test"),
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stderr
    facts = json.loads(result.stdout)
    assert facts == {"db": False, "write": False, "network": ["lo"], "secret": None}


@pytest.mark.parametrize("reason", ["cancel", "timeout"])
def test_real_runner_stops_container_on_cancel_or_timeout(tmp_path, monkeypatch, reason):
    image = local_image()
    import sensibilia.analysis_worker as worker

    recipe = tmp_path / "slow.py"
    recipe.write_text("import time\ntime.sleep(30)\nprint('{}')", encoding="utf-8")
    monkeypatch.setattr(worker, "RECIPE_PATH", recipe)
    if reason == "timeout":
        monkeypatch.setattr(worker, "TIMEOUT", 0.1)
    job_id = str(uuid4())
    with pytest.raises(RuntimeError, match="cancelled" if reason == "cancel" else "60 second"):
        worker.isolated_run(b"[]", image, job_id, lambda: reason == "cancel")
    result = subprocess.run(
        ["docker", "ps", "-aq", "--filter", "name=sensibilia-analysis-" + job_id],
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert result.returncode == 0 and not result.stdout.strip()


def test_all_version_snapshots_retain_scope_and_method_states(client, researcher_headers):
    from test_method_library import make_study

    data, test, version, samples = make_study(client, researcher_headers, "rata", rating_min=0)
    session, token = provision(client, researcher_headers, version)
    values = [
        {"kind": "rata", "state": "selected", "rating": 0},
        {"kind": "rata", "state": "unselected"},
    ]
    for sample, value in zip(samples, values, strict=True):
        assert (
            submit(
                client,
                session,
                token,
                [event(test, question_id="sweet", sample_id=sample["id"], value=value)],
            ).status_code
            == 200
        )
    base = f"/studies/{data['id']}/snapshots"
    item = create(client, researcher_headers, base)
    records = json.loads(archive(client, researcher_headers, base, item).read("dataset.json"))
    assert {r["state"] for r in records} == {"selected", "unselected"}
    assert any(json.loads(r["value_json"]).get("rating") == 0 for r in records)
    assert item["study_version_id"] is None
    assert client.get(base + "?limit=1&offset=1", headers=researcher_headers).json() == []


def test_snapshot_downgrade_refuses_history_loss(
    client, researcher_headers, database_url, monkeypatch
):
    from alembic import command
    from alembic.config import Config
    from conftest import ROOT

    data, test, version, session, token, base = setup(client, researcher_headers)
    item = create(client, researcher_headers, base)
    monkeypatch.setenv("SENSIBILIA_DATABASE_URL", database_url)
    with pytest.raises(RuntimeError, match="Dataset history"):
        command.downgrade(Config(str(ROOT / "alembic.ini")), "0012")
    # Later migrations were already undone before the refusal; restore them for the running app.
    command.upgrade(Config(str(ROOT / "alembic.ini")), "head")
    assert client.get(base + "/" + item["id"], headers=researcher_headers).status_code == 200
    z = archive(client, researcher_headers, base, item)
    assert z.read("manifest.sha256").decode().split()[0] == item["manifest_sha256"]
    manifest = json.loads(z.read("manifest.json"))
    assert manifest["snapshot_id"] == item["id"] and manifest["staff_name"] == "Scientist"


def test_job_recipe_scope_auth_and_finished_cancellation(client, researcher_headers):
    data, test, version, session, token, base = setup(client, researcher_headers)
    first = create(client, researcher_headers, base)
    second = create(client, researcher_headers, base)
    path = base + "/" + first["id"] + "/jobs"
    assert client.post(path, headers=token, json={"staff_name": "S"}).status_code == 401
    assert (
        client.post(
            path, headers=researcher_headers, json={"staff_name": "S", "recipe": "arbitrary-script"}
        ).status_code
        == 422
    )
    job = queue(client, researcher_headers, base, first)
    wrong = base + "/" + second["id"] + "/jobs/" + job["id"]
    assert client.get(wrong, headers=researcher_headers).status_code == 404
    assert (
        client.post(
            wrong + "/cancel", headers=researcher_headers, json={"staff_name": "S"}
        ).status_code
        == 404
    )
    assert (
        run_job(
            client.app.state.engine,
            job["id"],
            "python@sha256:" + "a" * 64,
            runner=lambda content, *_: census(content),
        )
        == "succeeded"
    )
    assert (
        client.post(
            path + "/" + job["id"] + "/cancel", headers=researcher_headers, json={"staff_name": "S"}
        ).status_code
        == 409
    )


def test_recovery_of_worker_interrupted_after_container_exit(client, researcher_headers):
    local_image()
    from sensibilia.analysis_worker import recover_job

    data, test, version, session, token, base = setup(client, researcher_headers)
    item = create(client, researcher_headers, base)
    job = queue(client, researcher_headers, base, item)
    with Session(client.app.state.engine) as db:
        row = db.get(AnalysisJob, job["id"])
        row.status = "running"
        row.started_at = "2026-10-14T12:00:00Z"
        db.commit()
    recover_job(client.app.state.engine, job["id"], "Recovery scientist")
    read = client.get(
        base + "/" + item["id"] + "/jobs/" + job["id"], headers=researcher_headers
    ).json()
    assert read["status"] == "failed" and "Recovery scientist" in read["error"]
    assert read["result"] is None


def test_snapshot_archives_verified_stimuli_and_blocks_missing_assets(client, researcher_headers):
    from test_assets import draft, png, publish, save, upload

    from sensibilia.assets import storage_path

    data, version, version_base, form = draft(client, researcher_headers)
    asset = upload(client, researcher_headers, version_base).json()
    form["nodes"][0]["data"]["asset_ids"] = [asset["id"]]
    assert save(client, researcher_headers, version_base, form).status_code == 200
    assert publish(client, researcher_headers, data, version).status_code == 200
    session, token = provision(client, researcher_headers, version)
    base = f"/studies/{data['id']}/snapshots"
    item = create(client, researcher_headers, base, version["id"])
    z = archive(client, researcher_headers, base, item)
    assert z.read("assets/" + asset["sha256"] + ".png") == png()
    provenance = json.loads(z.read("provenance.json"))
    assert provenance["packages"][0]["package"]["evaluator_version"] == "assets-v2.10"
    assert provenance["versions"][0]["configuration"]["assets"][0]["alt_text"] == {
        "en": "Red square"
    }
    # This fixture's SQLite/asset root is temporary; never remove operational files.
    from pathlib import Path

    from sqlalchemy.engine import make_url

    path = storage_path(client.app.state.settings) / asset["sha256"]
    assert (
        Path(make_url(client.app.state.settings.database_url).database).parent.resolve()
        in path.resolve().parents
    )
    path.unlink()
    assert (
        archive(client, researcher_headers, base, item).read("assets/" + asset["sha256"] + ".png")
        == png()
    )
    response = client.post(
        base,
        headers=researcher_headers,
        json={"label": "blocked", "staff_name": "S", "study_version_id": version["id"]},
    )
    assert response.status_code == 503
    assert len(client.get(base, headers=researcher_headers).json()) == 1
