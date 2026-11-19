"""Presentation adapters for the existing method contracts, not method implementations."""

from copy import deepcopy
from uuid import uuid4

from .contracts.methods import CONFIGURATIONS
from .document import AuthoringError

LABELS = {
    "instructions": "Instructions",
    "questions": "Questions",
    "attributes": "Attributes",
    "sample_ids": "Samples",
    "scale_labels": "Scale labels",
    "allow_skips": "Allow skips",
    "rating_target": "Rating target",
    "rating_min": "Scale origin",
    "require_ratings": "Require ratings",
    "purpose": "Study purpose",
    "reference_mode": "Reference mode",
    "reference_sample_id": "Reference product",
    "task": "Comparison task",
    "question": "Comparison question",
    "expected_sample_id": "Expected higher product",
    "descriptor_instructions": "Descriptor instructions",
    "ranking_instructions": "Ranking instructions",
    "min_attributes": "Minimum descriptors",
    "max_attributes": "Maximum descriptors",
    "allow_ties": "Allow tied ranks",
    "collect_descriptions": "Collect descriptions",
    "start_instruction": "Start instruction",
    "duration_ms": "Duration (ms)",
    "required_tolerance_ms": "Timing tolerance (ms)",
    "canvas_width": "Sheet width",
    "canvas_height": "Sheet height",
    "coordinate_units": "Coordinate units",
    "rank_direction": "Ranking order",
    "rank_encoding": "Tie encoding",
    "multi_active": "Concurrent attributes",
    "capture": "Recording",
}
ENUM_LABELS = {
    "directional": "Directional",
    "preference": "Preference",
    "difference": "Difference",
    "similarity": "Similarity",
    "balanced": "Balanced reference",
    "constant": "Constant reference",
    "intensity": "Intensity",
    "applicability": "Applicability",
    "increasing_intensity": "Increasing intensity",
    "dense": "Dense ranks",
    "cm_equivalent": "cm-equivalent",
    "transitions": "Transitions",
}
CONDITIONS = {
    "reference_sample_id": {"path": "/configuration/reference_mode", "value": "constant"},
    "expected_sample_id": {"path": "/configuration/task", "value": "directional"},
}
MULTILINE = {"instructions", "descriptor_instructions", "ranking_instructions", "start_instruction"}
TRACKED_ATTRIBUTES = {"cata-v1", "rata-v1", "tcata-v1"}


def method_seed(method):
    """Use model defaults; leave required content/settings empty for explicit authoring."""
    model = CONFIGURATIONS[method]
    properties = model.model_json_schema()["properties"]
    configuration = {}
    for key, field in model.model_fields.items():
        if not field.is_required():
            configuration[key] = field.get_default(call_default_factory=True)
        else:
            kind = properties[key].get("type")
            configuration[key] = [] if kind == "array" else "" if kind == "string" else None
    return configuration


def method_form(method, configuration=None, *, creation=True):
    configuration = method_seed(method) if configuration is None else configuration
    schema = CONFIGURATIONS[method].model_json_schema()
    fields, arrays, notes = [], [], []
    for key, spec in schema["properties"].items():
        path = f"/configuration/{key}"
        value = configuration.get(key)
        label = LABELS.get(key, key.replace("_", " ").capitalize())
        if "const" in spec:
            if key != "kind":
                constant = spec["const"]
                text = ENUM_LABELS.get(constant, str(constant))
                if isinstance(constant, bool):
                    text = "Yes" if constant else "No"
                notes.append(f"{label}: {text} (fixed by this method).")
            continue
        field = {"path": path, "label": label, "value": value, "options": []}
        if key == "sample_ids":
            field.update(type="multi", optionsFrom="samples", reactive=True)
            minimum, maximum = spec.get("minItems", 0), spec.get("maxItems", 50)
            if minimum:
                count = str(minimum) if minimum == maximum else f"{minimum}–{maximum}"
                notes.append(f"Choose {count} samples.")
            else:
                notes.append("Sample selection is optional for an unassigned product.")
        elif key in CONDITIONS:
            field.update(type="choice", optionsFrom="selectedSamples", visibleWhen=CONDITIONS[key])
        elif key in {"questions", "attributes"}:
            label = "Questions" if method == "hedonic-9-v1" else "Attributes"
            if creation:
                field.update(type="question-lines", label=label + " · one per line")
            else:
                arrays.append({"path": path, "label": label[:-1], "count": len(value)})
                for index, question in enumerate(value):
                    fields.append(
                        {
                            "path": f"{path}/{index}/prompt",
                            "label": f"{label[:-1]} {index + 1}",
                            "type": "text",
                            "value": question["prompt"],
                            "options": [],
                        }
                    )
                    if method not in TRACKED_ATTRIBUTES:
                        fields.append(
                            {
                                "path": f"{path}/{index}/required",
                                "label": f"Answer {index + 1} required",
                                "type": "choice",
                                "value": question["required"],
                                "options": [
                                    {"value": True, "label": "Yes"},
                                    {"value": False, "label": "No"},
                                ],
                            }
                        )
                continue
        elif key == "scale_labels":
            field.update(type="lines", label="Scale labels · one per line")
            if method == "jar-v1":
                notes.append("JAR: use 3, 5 or 7 categories with just-about-right at the centre.")
            else:
                minimum, maximum = spec.get("minItems"), spec.get("maxItems")
                count = str(minimum) if minimum == maximum else f"{minimum}–{maximum}"
                notes.append(f"Use {count} ordered scale labels; blank labels are invalid.")
        elif "enum" in spec:
            field.update(
                type="choice",
                reactive=key in {"reference_mode", "task"},
                options=[
                    {"value": item, "label": ENUM_LABELS.get(item, str(item))}
                    for item in spec["enum"]
                ],
            )
        elif spec.get("type") == "boolean":
            field.update(
                type="choice",
                options=[{"value": True, "label": "Yes"}, {"value": False, "label": "No"}],
            )
        elif spec.get("type") in {"integer", "number"}:
            if key == "rating_min":
                field.update(
                    type="choice",
                    options=[
                        {"value": n, "label": str(n)}
                        for n in range(spec["minimum"], spec["maximum"] + 1)
                    ],
                )
            else:
                field.update(type="number")
                if "minimum" in spec and "maximum" in spec:
                    notes.append(f"{label}: {spec['minimum']}–{spec['maximum']}.")
        else:
            field.update(type="multiline" if key in MULTILINE else "text")
        fields.append(field)
    return {"fields": fields, "arrays": arrays, "notes": notes}


def normalize_configuration(method, configuration):
    """Clear inapplicable conditional fields before invoking the authoritative validator."""
    result = deepcopy(configuration)
    if method == "duo-trio-v1" and result.get("reference_mode", "balanced") == "balanced":
        result["reference_sample_id"] = None
    if method == "two-afc-v1" and result.get("task", "directional") == "preference":
        result["expected_sample_id"] = None
    return CONFIGURATIONS[method].model_validate(result).model_dump(mode="json")


def guided_configuration(method, values, samples):
    result = method_seed(method)
    editable = {field["path"].split("/")[-1] for field in method_form(method)["fields"]}
    if set(values) - editable:
        raise AuthoringError("Guided forms cannot change fixed method settings")
    result.update(deepcopy(values))
    for key in ("questions", "attributes"):
        if key in result:
            prompts = result[key]
            if isinstance(prompts, str):
                prompts = [line.strip() for line in prompts.splitlines() if line.strip()]
                result[key] = [
                    {"id": "q_" + uuid4().hex[:12], "prompt": prompt, "required": True}
                    for prompt in prompts
                ]
    if isinstance(result.get("scale_labels"), str):
        result["scale_labels"] = result["scale_labels"].splitlines()
    configuration = normalize_configuration(method, result)
    known = {sample["id"] for sample in samples}
    if not set(configuration.get("sample_ids", [])) <= known:
        raise AuthoringError("Choose samples from this study's sample list")
    return configuration
