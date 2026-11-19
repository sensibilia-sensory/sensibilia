"""Long-form method data with lossless atomic values and interpreted context."""

from sensibilia.models import Sample, StudyTest
from sensibilia.presentation import assignment_for

EXPORT_COLUMNS = [
    "sample_code",
    "sample_label",
    "attribute_label",
    "descriptor_id",
    "descriptor",
    "rank",
    "x",
    "y",
    "coordinate_units",
    "selected_code",
    "correct",
    "serving_plan_json",
]


def method_rows(db, record):
    import json

    test = db.get(StudyTest, record["study_test_id"])
    config = test.configuration
    value = record["value"]
    kind = config.get("kind", "hedonic")
    assignment = assignment_for(db, record["session_id"], test.id)
    record["serving_plan_json"] = json.dumps(
        assignment.plan if assignment else None, ensure_ascii=False, separators=(",", ":")
    )
    if record.get("sample_id"):
        sample = db.get(Sample, record["sample_id"])
        record.update(sample_code=sample.code, sample_label=sample.label)
    question = next(
        (q for q in config.get("questions", []) if q["id"] == record["question_id"]), None
    )
    if question:
        record["attribute_label"] = question["prompt"]
    if kind in {"triangle", "duo_trio", "two_afc"}:
        plan = assignment.plan
        selected = next(s for s in plan["samples"] if s["slot_id"] == value["selected_slot_id"])
        record.update(selected_code=selected["code"])
        # Preference tests have no correct answer; leave the column empty rather than False.
        if "correct_slot_id" in plan:
            record["correct"] = value["selected_slot_id"] == plan["correct_slot_id"]
    if kind == "flash_profile":
        for descriptor in value["attributes"]:
            for sample_id, rank in descriptor["ranks"].items():
                sample = db.get(Sample, sample_id)
                yield {
                    **record,
                    "sample_id": sample_id,
                    "sample_code": sample.code,
                    "sample_label": sample.label,
                    "descriptor_id": descriptor["id"],
                    "descriptor": descriptor["term"],
                    "rank": rank,
                }
    elif kind == "napping":
        for sample_id, point in value["points"].items():
            sample = db.get(Sample, sample_id)
            yield {
                **record,
                "sample_id": sample_id,
                "sample_code": sample.code,
                "sample_label": sample.label,
                "x": point["x"],
                "y": point["y"],
                "descriptor": point["description"],
                "coordinate_units": config["coordinate_units"],
            }
    else:
        yield record
