"""What a recipe receives: R-ready rows of the frozen snapshot, settings and plain context.

Only sample codes, attribute names and question texts leave the database; private product labels,
database paths and credentials never do: private product labels never reach anyone who does
not need them, and analyses never get unrestricted access to the operational database.
"""

from __future__ import annotations

import json

from fastapi import HTTPException

from sensibilia.data_service import canonical
from sensibilia.export_service import r_csv
from sensibilia.schemas import DataRowRead
from sensibilia.snapshots import verified_file


def configuration(item) -> dict:
    provenance = json.loads(verified_file(item, "provenance.json"))
    if item.study_version_id is None or len(provenance["versions"]) != 1:
        raise HTTPException(422, "Analyse a snapshot of one version, not of all versions")
    return provenance["versions"][0]["configuration"]


def describe_test(config: dict, test_id: str) -> dict:
    test = next((t for t in config["tests"] if t["id"] == test_id), None)
    if test is None:
        raise HTTPException(422, "That test is not part of this version")
    codes = {s["id"]: s["code"] for s in config["samples"]}
    settings = test["configuration"]
    questions = settings.get("questions") or settings.get("attributes") or []
    return {
        "id": test["id"],
        "test_type_id": test["test_type_id"],
        "kind": settings.get("kind", "hedonic"),
        "questions": [{"id": q["id"], "text": q["prompt"]} for q in questions],
        "samples": [codes[s] for s in settings.get("sample_ids", []) if s in codes],
        "scale_labels": settings.get("scale_labels"),
        "rating_min": settings.get("rating_min"),
        "rating_target": settings.get("rating_target"),
        "purpose": settings.get("purpose"),
        "task": settings.get("task"),
        "expected_sample": codes.get(settings.get("expected_sample_id")),
    }


def rows(item, test_id: str) -> str:
    records = [
        DataRowRead.model_validate(r) for r in json.loads(verified_file(item, "dataset.json"))
    ]
    return r_csv([r for r in records if r.study_test_id == test_id], history="current")


def build(item, test_id: str, settings: dict) -> dict[str, bytes]:
    config = configuration(item)
    context = {
        "test": describe_test(config, test_id),
        "samples": sorted(s["code"] for s in config["samples"]),
    }
    files = {"rows_main.csv": rows(item, test_id)}
    liking = settings.get("liking_test_id")
    if liking:
        context["liking"] = describe_test(config, liking)
        if context["liking"]["test_type_id"] != "hedonic-9-v1":
            raise HTTPException(422, "The liking test must be a hedonic test")
        files["rows_liking.csv"] = rows(item, liking)
    files["context.json"] = canonical(context)
    files["params.json"] = canonical(settings)
    return {name: content.encode("utf-8") for name, content in files.items()}
