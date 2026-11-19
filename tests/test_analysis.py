"""Analysis add-on: optional runtime, composite queueing, runner, reports.

R itself is exercised by tests/test_analysis_recipes.py when the add-on is installed; here a
stand-in runner checks everything around it, so these run on every machine and in CI.
"""

import hashlib
import io
import json
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import inspect, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from test_api import event, provision, study, submit
from test_v2_methods import setup_method

from sensibilia import analysis_setup
from sensibilia.analysis import inputs, power, reports, routes, scheduler
from sensibilia.analysis.presenter import present
from sensibilia.analysis.registry import RECIPES
from sensibilia.analysis.runner import RecipeFailed
from sensibilia.db import EXPECTED_REVISION, make_engine
from sensibilia.models import AnalysisJob, AnalysisJobFigure, DatasetSnapshot

LIKING_RESULT = {
    "recipe": "liking-anova",
    "version": 1,
    "rows_used": 6,
    "rows_left_out": {"skipped": 1},
    "warnings": [{"code": "few_assessors", "detail": {"n": 3}}],
    "alpha": 0.05,
    "comparison": "tukey",
    "questions": [
        {
            "question_id": "overall",
            "question": "Overall liking",
            "n_assessors": 3,
            "n_ratings": 6,
            "test_name": "ANOVA with Tukey HSD",
            "statistic": 12.5,
            "p_value": 0.002,
            "lsd": None,
            "samples": [
                {
                    "code": "731",
                    "n": 3,
                    "mean": 7.3,
                    "sd": 0.6,
                    "ci_low": 6.0,
                    "ci_high": 8.7,
                    "group": "a",
                },
                {
                    "code": "482",
                    "n": 3,
                    "mean": 4.0,
                    "sd": 1.0,
                    "ci_low": 1.5,
                    "ci_high": 6.5,
                    "group": "b",
                },
            ],  # fmt: skip
            "pairs": [
                {"a": "482", "b": "731", "difference": -3.3, "p_value": 0.002, "significant": True}
            ],
            "table": [
                {
                    "term": "Sample",
                    "df": 1,
                    "sum_sq": 16.3,
                    "mean_sq": 16.3,
                    "statistic": 12.5,
                    "p_value": 0.002,
                },
            ],  # fmt: skip
        }
    ],
}


def tiny_png() -> bytes:
    import struct
    import zlib

    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    header = struct.pack(">IIBBBBB", 1, 1, 8, 0, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(b"\x00\x00"))
        + chunk(b"IEND", b"")
    )


PNG = tiny_png()


@pytest.fixture
def ready(monkeypatch, tmp_path):
    """Pretend the add-on is installed; the stand-in runner never starts R."""
    state = {
        "state": "ready",
        "message": "The analysis add-on is installed.",
        "receipt": {"versions": {"R": "4.6.2"}, "snapshot_date": "2026-11-16"},
    }
    monkeypatch.setattr(routes, "status", lambda: state)
    monkeypatch.setattr(scheduler, "status", lambda: state)
    monkeypatch.setattr(scheduler, "runtime_directory", lambda: tmp_path)
    return state


def hedonic(client, h):
    data, test, version = study(client, h)
    session, token = provision(client, h, version)
    assert submit(client, session, token, [event(test)]).status_code == 200
    return data, test, version


def queue(client, h, data, test, version, **extra):
    return client.post(
        f"/studies/{data['id']}/analyses",
        headers=h,
        json={
            "study_version_id": version["id"],
            "study_test_id": test["id"],
            "recipe": "liking-anova",
            "staff_name": "Scientist",
            **extra,
        },
    )


def engine_of(client):
    return client.app.state.engine


def test_without_the_add_on_nothing_runs_and_the_reason_is_plain(client, researcher_headers):
    h = researcher_headers
    state = client.get("/analysis/status", headers=h).json()
    assert state["state"] in {"missing", "ready", "needs_update", "broken"}
    if state["state"] == "ready":
        pytest.skip("the add-on is installed on this machine")
    assert state["message"] == "The analysis add-on is not installed."
    data, test, version = hedonic(client, h)
    refused = queue(client, h, data, test, version)
    assert refused.status_code == 409 and "not installed" in refused.json()["detail"]
    with Session(engine_of(client)) as db:
        assert db.scalar(select(DatasetSnapshot)) is None  # composite: nothing left behind
    # Suggestions and the calculator work without R.
    suggested = client.get(
        f"/studies/{data['id']}/versions/{version['id']}/analyses/suggested", headers=h
    )
    assert [s["recipe"] for s in suggested.json()] == ["liking-anova"]
    assert suggested.json()[0]["settings"] == {"alpha": 0.05, "comparison": "tukey"}
    assert client.post(
        "/analysis/power", headers=h, json={"method": "triangle", "size": 0.5}
    ).is_success


@pytest.mark.parametrize(
    "method,path",
    [
        ("get", "/analysis/status"),
        ("post", "/analysis/power"),
        ("get", "/studies/{s}/analyses"),
        ("post", "/studies/{s}/analyses"),
        ("get", "/studies/{s}/analyses/{j}"),
        ("get", "/studies/{s}/analyses/{j}/report"),
        ("get", "/studies/{s}/analyses/{j}/figures/x.png"),
        ("get", "/studies/{s}/versions/{v}/analyses/suggested"),
    ],
)
def test_every_endpoint_needs_the_researcher_key(client, researcher_headers, method, path):
    data, test, version = study(client, researcher_headers)
    url = path.format(s=data["id"], v=version["id"], j="00000000-0000-0000-0000-000000000000")
    assert getattr(client, method)(url).status_code == 401


def test_queue_run_read_and_report(client, researcher_headers, ready):
    h = researcher_headers
    data, test, version = hedonic(client, h)
    created = queue(client, h, data, test, version, settings={"comparison": "lsd"})
    assert created.status_code == 201, created.text
    job = created.json()
    assert job["status"] == "queued" and job["parameters"] == {"alpha": 0.05, "comparison": "lsd"}
    assert job["snapshot_label"].startswith("For analysis")
    assert job["recipe_sha256"] == RECIPES["liking-anova"].sha256()
    seen = {}

    def fake(recipe, files, runtime, cancelled):
        seen.update(files)
        return LIKING_RESULT, {"liking_01.png": PNG}

    assert scheduler.run_one(engine_of(client), run=fake) == "succeeded"
    assert scheduler.run_one(engine_of(client), run=fake) is None  # idle
    assert json.loads(seen["params.json"]) == {"alpha": 0.05, "comparison": "lsd"}
    assert json.loads(seen["context.json"])["test"]["questions"][0]["id"] == "overall"
    assert b"overall" in seen["rows_main.csv"]
    read = client.get(f"/studies/{data['id']}/analyses/{job['id']}", headers=h).json()
    assert read["status"] == "succeeded" and read["figures"] == ["liking_01.png"]
    assert read["runtime"]["versions"] == {"R": "4.6.2"}
    assert read["result_sha256"]
    assert "731 was liked most" in " ".join(read["presentation"]["answer"])
    assert "Only 3 assessors" in read["presentation"]["warnings"][0]
    assert "1 skipped" in read["presentation"]["warnings"][-1]
    listed = client.get(f"/studies/{data['id']}/analyses", headers=h).json()
    assert [a["id"] for a in listed] == [job["id"]] and listed[0]["result"] is None
    figure = client.get(
        f"/studies/{data['id']}/analyses/{job['id']}/figures/liking_01.png", headers=h
    )
    assert figure.content == PNG and figure.headers["content-type"] == "image/png"
    base = f"/studies/{data['id']}/analyses/{job['id']}/report"
    from docx import Document
    from openpyxl import load_workbook

    book = load_workbook(io.BytesIO(client.get(base, headers=h).content))
    assert book.sheetnames[0] == "Summary"
    assert any("731 was liked most" in str(c.value) for c in book["Summary"]["A"])
    assert book.worksheets[1]["A2"].value == "731"
    document = Document(io.BytesIO(client.get(base + "?format=docx", headers=h).content))
    assert any("731 was liked most" in p.text for p in document.paragraphs)
    assert len(document.inline_shapes) == 1
    # Results and figures are append-only once stored.
    with Session(engine_of(client)) as db, pytest.raises(IntegrityError):
        db.execute(text("DELETE FROM analysis_job_figures"))
    with Session(engine_of(client)) as db, pytest.raises(IntegrityError):
        db.execute(text("UPDATE analysis_jobs SET parameters = '{}'"))


def test_failures_are_recorded_in_plain_words(client, researcher_headers, ready):
    h = researcher_headers
    data, test, version = hedonic(client, h)
    first = queue(client, h, data, test, version).json()
    second = queue(client, h, data, test, version).json()

    def broken(recipe, files, runtime, cancelled):
        raise RecipeFailed("The analysis took longer than 120 seconds.")

    def odd(recipe, files, runtime, cancelled):
        return {"recipe": "liking-anova", "surprise": 1}, {}

    assert scheduler.run_one(engine_of(client), run=broken) == "failed"
    assert scheduler.run_one(engine_of(client), run=odd) == "failed"
    one = client.get(f"/studies/{data['id']}/analyses/{first['id']}", headers=h).json()
    two = client.get(f"/studies/{data['id']}/analyses/{second['id']}", headers=h).json()
    assert one["error"] == "The analysis took longer than 120 seconds."
    assert two["error"] == "The analysis returned a result in an unexpected form."
    report = client.get(f"/studies/{data['id']}/analyses/{first['id']}/report", headers=h)
    assert report.status_code == 409


def test_restart_fails_interrupted_jobs_and_cancel_wins(client, researcher_headers, ready):
    h = researcher_headers
    data, test, version = hedonic(client, h)
    job = queue(client, h, data, test, version).json()
    assert scheduler.claim(engine_of(client)) == job["id"]
    assert scheduler.recover_interrupted(engine_of(client)) == 1
    read = client.get(f"/studies/{data['id']}/analyses/{job['id']}", headers=h).json()
    assert read["status"] == "failed" and read["error"] == scheduler.INTERRUPTED
    later = queue(client, h, data, test, version).json()
    assert scheduler.claim(engine_of(client)) == later["id"]
    cancel = client.post(
        f"/studies/{data['id']}/snapshots/{later['snapshot_id']}/jobs/{later['id']}/cancel",
        headers=h,
        json={"staff_name": "Scientist"},
    )
    assert cancel.status_code == 200
    assert scheduler.finish(engine_of(client), later["id"], result=LIKING_RESULT) == "cancelled"


def test_invalid_requests_leave_nothing_behind(client, researcher_headers, ready):
    h = researcher_headers
    data, test, version = hedonic(client, h)
    for extra in (
        {"settings": {"alpha": 0.2}},
        {"settings": {"script": "system('x')"}},
        {"recipe": "cata"},
        {"recipe": "anything"},
    ):
        assert queue(client, h, data, test, version, **extra).status_code == 422
    other, other_test, other_version = study(client, h)
    assert queue(client, h, data, other_test, version).status_code == 422
    with Session(engine_of(client)) as db:
        assert db.scalar(select(DatasetSnapshot)) is None
        assert db.scalar(select(AnalysisJob)) is None


def test_inputs_carry_codes_never_private_labels(client, researcher_headers, ready):
    h = researcher_headers
    study_data, version, base, samples, test, *_ = setup_method(client, h, "triangle")
    review = client.get(base + "/validation", headers=h).json()
    published = client.post(
        f"/studies/{study_data['id']}/publish",
        headers=h,
        json={"study_version_id": version["id"], "revision_hash": review["revision_hash"]},
    )
    assert published.status_code == 200, published.text
    created = client.post(
        f"/studies/{study_data['id']}/analyses",
        headers=h,
        json={
            "study_version_id": version["id"],
            "study_test_id": test["id"],
            "recipe": "discrimination",
            "staff_name": "Scientist",
        },
    )
    assert created.status_code == 201, created.text
    with Session(engine_of(client)) as db:
        job = db.get(AnalysisJob, created.json()["id"])
        files = inputs.build(
            db.get(DatasetSnapshot, job.snapshot_id), job.study_test_id, job.parameters
        )
    joined = b"".join(files.values())
    assert b"Private" not in joined and b"sensibilia.db" not in joined
    assert json.loads(files["context.json"])["test"]["samples"] == ["317", "318"]
    assert json.loads(files["context.json"])["test"]["kind"] == "triangle"


def test_power_matches_published_values(client, researcher_headers):
    # sensR::psyfun(1, method) — triangle 0.4180, duo-trio 0.5825, 2-AFC 0.7602.
    assert round(power.pc_from_d_prime("triangle", 1), 4) == 0.4180
    assert round(power.pc_from_d_prime("duo_trio", 1), 4) == 0.5825
    assert round(power.pc_from_d_prime("two_afc", 1), 4) == 0.7602
    assert round(power.d_prime_from_pc("triangle", 0.4180), 2) == 1.0
    # Exact binomial: 9 of 16 is the triangle critical value at alpha 0.05 (ISO 4120 table A.1).
    response = client.post(
        "/analysis/power",
        headers=researcher_headers,
        json={"method": "triangle", "size": 0.5, "assessors": 16},
    ).json()
    assert response["critical_correct"] == 9 and response["power"] > 0.8
    for n, critical in ((12, 8), (24, 13), (36, 18)):
        assert power.difference_power("triangle", n, 0.05, 1 / 3)[1] == critical
    refused = client.post(
        "/analysis/power", headers=researcher_headers, json={"method": "triangle", "size": 1.5}
    )
    assert refused.status_code == 422


def test_presenter_covers_every_recipe_conclusion():
    discrimination = {
        "recipe": "discrimination", "version": 1, "rows_used": 30, "rows_left_out": {},
        "method": "triangle", "task": "difference", "alpha": 0.05, "n": 30, "correct": 17,
        "guessing": 1 / 3, "p_value": 0.003, "pc": None, "pd": {"estimate": 0.35, "low": 0.1,
        "high": 0.6}, "d_prime": {"estimate": 1.8, "low": 1, "high": 2.5}, "pd_limit": None,
        "conclusion": "different",
    }  # fmt: skip
    text = present("discrimination", discrimination)
    assert text["answer"][0].startswith("Assessors told the samples apart: 17 of 30")
    for conclusion in ("not_shown_different", "similar", "not_shown_similar"):
        assert present("discrimination", discrimination | {"conclusion": conclusion})["answer"]
    preference = discrimination | {
        "task": "preference", "method": "two_afc", "counts": {"A": 20, "B": 10},
        "conclusion": "preferred",
    }  # fmt: skip
    assert present("discrimination", preference)["answer"][0].startswith("A was preferred")
    for recipe in RECIPES:
        assert present(recipe, minimal(recipe))["how_to_read"]
        assert reports.tables(recipe, minimal(recipe)) is not None


def minimal(recipe):
    common = {"recipe": recipe, "version": 1, "rows_used": 0, "rows_left_out": {}, "warnings": []}
    return common | {
        "liking-anova": {"alpha": 0.05, "comparison": "tukey", "questions": []},
        "discrimination": {
            "method": "duo_trio", "task": "difference", "alpha": 0.05, "n": 0, "correct": 0,
            "guessing": 0.5, "p_value": None, "pc": None, "pd": None, "d_prime": None,
            "pd_limit": None, "conclusion": "not_shown_different",
        },
        "jar-penalty": {"threshold": 0.2, "alpha": 0.05, "liking_question": None, "attributes": []},
        "cata": {"alpha": 0.05, "n_assessors": 0, "samples": [], "attributes": [], "map": None,
                 "liking_question": None},
        "rata": {"alpha": 0.05, "comparison": "tukey", "rating_target": "intensity",
                 "rating_min": 1, "n_assessors": 0, "samples": [], "attributes": [], "map": None},
    }[recipe]  # fmt: skip


def test_rata_presenter_names_the_clearest_differences_and_reports_both_tables():
    def attribute(qid, text, p, means):
        return {
            "question_id": qid, "question": text, "n_assessors": 20, "statistic": 9.0,
            "p_value": p,
            "samples": [{"code": c, "n": 20, "mean": m, "sd": 1.0, "checked": 0.5,
                         "group": g} for c, (m, g) in means.items()],
        }  # fmt: skip

    result = minimal("rata") | {
        "n_assessors": 20, "samples": ["A", "B"],
        "attributes": [
            attribute("sweet", "Sweet", 0.0001, {"A": (4.2, "a"), "B": (1.1, "b")}),
            attribute("sour", "Sour", 0.4, {"A": (2.0, "a"), "B": (2.2, "a")}),
        ],
        "warnings": [{"code": "unrated", "detail": {"n": 3}}, {"code": "zero_origin"}],
    }  # fmt: skip
    text = present("rata", RECIPES["rata"].result.model_validate(result).model_dump(mode="json"))
    assert (
        text["answer"][0]
        == "1 of 2 attributes were rated differently between the samples (20 assessors)."
    )
    assert (
        "“Sweet” was strongest in A (mean 4.2) and weakest in B (1.1; p < 0.001)." in text["answer"]
    )
    assert "3 checked attributes had no rating and were left out." in text["warnings"]
    means, checked = reports.tables("rata", result)
    assert means[2][0] == ["Sweet", "4.20 a", "1.10 b", 9.0, 0.0001]
    assert checked[2][1] == ["Sour", 0.5, 0.5]


def test_setup_refuses_tampered_or_missing_files(tmp_path, monkeypatch):
    lock = {
        "lock_version": 1,
        "snapshot_date": "2026-11-16",
        "r": {"version": "4.6.2", "windows": {"url": "https://x/R.exe", "sha256": "", "bytes": 3}},
        "packages": [
            {"name": "p", "version": "1", "windows": {"url": "https://x/p_1.zip", "sha256": "",
                                                      "bytes": 3}},
        ],
    }  # fmt: skip
    good = b"abc"
    lock["r"]["windows"]["sha256"] = hashlib.sha256(good).hexdigest()
    lock["packages"][0]["windows"]["sha256"] = hashlib.sha256(good).hexdigest()
    path = tmp_path / "lock.json"
    path.write_text(json.dumps(lock))
    monkeypatch.setattr(analysis_setup, "LOCK_PATH", path)
    source = tmp_path / "source"
    source.mkdir()
    (source / "R.exe").write_bytes(good)
    with pytest.raises(analysis_setup.Problem, match="p_1.zip is missing"):
        analysis_setup.gather(tmp_path / "target", source)
    (source / "p_1.zip").write_bytes(b"abd")
    with pytest.raises(analysis_setup.Problem, match="does not match its checksum"):
        analysis_setup.gather(tmp_path / "target", source)
    (source / "p_1.zip").write_bytes(good)
    analysis_setup.gather(tmp_path / "target", source)
    assert (tmp_path / "target" / "p_1.zip").read_bytes() == good
    # Status: missing, then a receipt from another lock needs an update, then ready.
    runtime = tmp_path / "runtime"
    monkeypatch.setenv("SENSIBILIA_ANALYSIS_RUNTIME", str(runtime))
    assert analysis_setup.status()["state"] == "missing"
    runtime.mkdir()
    (runtime / "receipt.json").write_text(json.dumps({"lock_sha256": "old"}))
    assert analysis_setup.status()["state"] == "needs_update"
    (runtime / "receipt.json").write_text(json.dumps({"lock_sha256": analysis_setup.lock_sha256()}))
    assert analysis_setup.status()["state"] == "broken"  # receipt without R
    rscript = analysis_setup.rscript(runtime)
    rscript.parent.mkdir(parents=True)
    rscript.write_bytes(b"")
    assert analysis_setup.status()["state"] == "ready"


def test_the_shipped_lock_names_every_package_once_with_a_checksum():
    lock = analysis_setup.lock()
    names = [p["name"] for p in lock["packages"]]
    assert len(names) == len(set(names))
    assert set(analysis_setup.CHECK_PACKAGES) <= set(names)
    for entry in [lock["r"]["windows"]] + [p["windows"] for p in lock["packages"]]:
        assert len(entry["sha256"]) == 64 and entry["url"].startswith("https://")
    for recipe in RECIPES.values():
        assert recipe.path.is_file()


def test_upgrade_0018_and_downgrade_keep_results(tmp_path, monkeypatch):
    root = Path(__file__).resolve().parents[1]
    url = f"sqlite:///{(tmp_path / 'analysis.db').as_posix()}"
    monkeypatch.setenv("SENSIBILIA_DATABASE_URL", url)
    config = Config(str(root / "alembic.ini"))
    command.upgrade(config, "0017")
    engine = make_engine(url)
    assert "analysis_job_figures" not in inspect(engine).get_table_names()
    command.upgrade(config, "head")
    with engine.connect() as connection:
        assert (
            connection.scalar(text("SELECT version_num FROM alembic_version")) == EXPECTED_REVISION
        )
    columns = {c["name"] for c in inspect(engine).get_columns("analysis_jobs")}
    assert {"recipe_version", "parameters", "study_test_id", "runtime"} <= columns
    command.downgrade(config, "0017")
    assert "analysis_job_figures" not in inspect(engine).get_table_names()
    assert "parameters" not in {c["name"] for c in inspect(engine).get_columns("analysis_jobs")}
    command.upgrade(config, "head")
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO studies (id,title,description,status,created_at) "
                "VALUES ('s','S','','draft','2026-11-18');"
            )
        )
        connection.execute(
            text(
                "INSERT INTO dataset_snapshots VALUES "
                "('d','s',NULL,'l','x','p','2026-11-18','{}','{}')"
            )
        )
        connection.execute(
            text(
                "INSERT INTO analysis_jobs (id,snapshot_id,recipe,recipe_sha256,staff_name,"
                "principal,created_at,status,parameters) VALUES "
                "('j','d','liking-anova','h','x','p','2026-11-18','queued','{}')"
            )
        )
    with pytest.raises(RuntimeError, match="cannot be discarded"):
        command.downgrade(config, "0017")
    engine.dispose()


def test_figures_model_is_registered():
    assert AnalysisJobFigure.__tablename__ == "analysis_job_figures"


def test_r_keeps_the_windows_machine_variables_but_no_r_settings(monkeypatch, tmp_path):
    # Without PROCESSOR_ARCHITECTURE, R 4.6 on Windows crashes on exit after loading cli.
    from sensibilia.analysis_setup import r_environment

    monkeypatch.setenv("PROCESSOR_ARCHITECTURE", "AMD64")
    monkeypatch.setenv("R_LIBS", "elsewhere")
    monkeypatch.setenv("SECRET_TOKEN", "x")
    env = r_environment(tmp_path)
    assert env["PROCESSOR_ARCHITECTURE"] == "AMD64"
    assert env["R_LIBS"] == str(tmp_path) and env["R_PROFILE_USER"] == ""
    assert "SECRET_TOKEN" not in env
