"""Snapshot validation and revision preconditions for the bounded flow slices."""

import hashlib
import json
from copy import deepcopy

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import object_session

from sensibilia.assets import asset_issues, asset_read, version_assets
from sensibilia.flow_semantics import semantic_issues
from sensibilia.flow_text import text_issues
from sensibilia.flows import DraftFlowV2, LoopNode, MethodNode, walk
from sensibilia.methods import CONFIGURATIONS
from sensibilia.models import Sample, StudyDesign, StudyTest


def is_v2(form):
    return form is not None and form.get("schema_version") == 2


def revision_hash(version):
    db = object_session(version)
    configured = (
        list(
            db.scalars(
                select(StudyTest)
                .where(StudyTest.study_version_id == version.id)
                .order_by(StudyTest.position)
            )
        )
        if db
        else []
    )
    assets = (
        [
            asset_read(db, a).model_dump(mode="json", exclude={"url"})
            for a in version_assets(db, version.id)
        ]
        if db
        else []
    )
    snapshot = {
        **({"assets": assets} if assets else {}),
        "id": version.id,
        "revision": version.revision,
        "title": version.title,
        "description": version.description,
        "form": version.form,
        **(
            {
                "designs": [
                    {
                        "id": d.id,
                        "loop_id": d.loop_id,
                        "settings": d.settings,
                        "sequences": d.sequences,
                    }
                    for d in db.scalars(
                        select(StudyDesign)
                        .where(StudyDesign.study_version_id == version.id)
                        .order_by(StudyDesign.loop_id)
                    )
                ]
            }
            if db
            and db.scalar(
                select(StudyDesign.id).where(StudyDesign.study_version_id == version.id).limit(1)
            )
            else {}
        ),
        "samples": [
            {
                "id": sample.id,
                "code": sample.code,
                "label": sample.label,
                "ingredient_tags": sample.ingredient_tags,
            }
            for sample in db.scalars(
                select(Sample).where(Sample.study_version_id == version.id).order_by(Sample.id)
            )
        ]
        if db
        else [],
        "tests": [
            {
                "id": t.id,
                "type": t.test_type_id,
                "position": t.position,
                "configuration": t.configuration,
            }
            for t in configured
        ],
    }
    return hashlib.sha256(
        json.dumps(snapshot, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()
    ).hexdigest()


def precondition(version, expected):
    if version.published_at:
        raise HTTPException(409, "Published versions are immutable")
    if expected != revision_hash(version):
        raise HTTPException(409, "Draft changed; reload and review before saving")


def validate_references(db, version, flow):
    test_ids = set(db.scalars(select(StudyTest.id).where(StudyTest.study_version_id == version.id)))
    sample_ids = set(db.scalars(select(Sample.id).where(Sample.study_version_id == version.id)))
    asset_ids = {a.id for a in version_assets(db, version.id)}
    for node in walk(flow.nodes):
        if node.kind == "info" and not {str(i) for i in node.data.asset_ids} <= asset_ids:
            raise HTTPException(422, "Image does not belong to this version")
        if (
            node.kind == "serve_gate"
            and node.data.study_test_id
            and str(node.data.study_test_id) not in test_ids
        ):
            raise HTTPException(422, "Serving method does not belong to this version")
        if node.kind == "serve_gate" and not {str(i) for i in node.data.sample_ids} <= sample_ids:
            raise HTTPException(422, "Serving sample does not belong to this version")
        if isinstance(node, MethodNode) and str(node.data.study_test_id) not in test_ids:
            raise HTTPException(
                422,
                [
                    {
                        "loc": ["body", "form", "nodes", str(node.id), "data", "study_test_id"],
                        "msg": "Test does not belong to this version",
                        "type": "foreign_reference",
                    }
                ],
            )
        if isinstance(node, LoopNode) and not {str(i) for i in node.data.sample_ids} <= sample_ids:
            raise HTTPException(422, "Sample does not belong to this version")
    if not {str(i) for i in flow.method_text} <= test_ids:
        raise HTTPException(422, "Method translation references a foreign test")


def report(db, version):
    issues = []

    def issue(code, message, path, node_id=None):
        issues.append(
            {
                "severity": "error",
                "node_id": node_id,
                "study_test_id": None,
                "path": path,
                "code": code,
                "message": message,
            }
        )

    try:
        flow = DraftFlowV2.model_validate(version.form)
        validate_references(db, version, flow)
    except ValidationError as exc:
        for error in exc.errors():
            issue("invalid_flow", error["msg"], ["form", *error["loc"]])
        flow = None
    except HTTPException as exc:
        issue("foreign_reference", str(exc.detail), ["form"])
        flow = None
    if flow:
        configured = list(
            db.scalars(select(StudyTest).where(StudyTest.study_version_id == version.id))
        )
        if not configured:
            issue("empty_methods", "Add a registered sensory method", ["nodes"])
        refs = {str(n.data.study_test_id) for n in walk(flow.nodes) if isinstance(n, MethodNode)}
        if refs != {t.id for t in configured}:
            issue("test_coverage", "Include each configured method exactly once", ["nodes"])
        if any(t.test_type_id not in CONFIGURATIONS for t in configured):
            issue(
                "planned_method",
                "Method implementation is unavailable",
                ["nodes"],
            )
        for t in configured:
            if (
                t.test_type_id == "tcata-v1"
                and t.configuration.get("sample_ids")
                and not any(
                    n.kind == "embedded_method"
                    and str(n.data.study_test_id) == t.id
                    and n.data.sample_binding == "current"
                    for n in walk(flow.nodes)
                )
            ):
                issue(
                    "temporal_sample_scope",
                    "TCATA samples require a current-sample loop",
                    ["nodes"],
                )
        issues.extend(asset_issues(db, version, flow))
        issues.extend(text_issues(flow, configured))
        issues.extend(semantic_issues(flow, configured))
        from sensibilia.designs import design_issues

        issues.extend(design_issues(db, version, flow))
        if not flow.nodes:
            issue("empty_flow", "Add a method and explicit end", ["nodes"])
        for node in walk(flow.nodes):
            if (
                node.kind == "serve_gate"
                and node.data.sample_binding == "set"
                and not node.data.sample_ids
                and not node.data.study_test_id
            ):
                issue(
                    "empty_serving_set",
                    "Choose the samples to serve",
                    ["nodes", str(node.id), "data", "sample_ids"],
                    str(node.id),
                )
            if node.kind in {"group", "loop_samples"} and not node.data.children:
                issue(
                    "empty_container",
                    "Published containers need children",
                    ["nodes", str(node.id), "data", "children"],
                    str(node.id),
                )
            if isinstance(node, LoopNode) and not node.data.sample_ids:
                issue(
                    "empty_samples",
                    "Published loops need samples",
                    ["nodes", str(node.id), "data", "sample_ids"],
                    str(node.id),
                )
        for node in walk(flow.nodes):
            if isinstance(node, LoopNode):
                for sample_id in node.data.sample_ids:
                    sample = db.get(Sample, str(sample_id))
                    if sample.ingredient_tags is None:
                        issue(
                            "missing_ingredient_tags",
                            "Review ingredient tags for each loop sample "
                            "(empty list means reviewed none)",
                            ["nodes", str(node.id), "data", "sample_ids"],
                            str(node.id),
                        )
    return {
        "study_version_id": version.id,
        "revision_hash": revision_hash(version),
        "valid": not any(i["severity"] == "error" for i in issues),
        "issues": issues,
    }


def clone_flow(form, mapping, sample_mapping, asset_mapping=None):
    flow = deepcopy(form)

    def remap(nodes):
        for node in nodes:
            if node["kind"] == "info" and node["data"].get("asset_ids"):
                node["data"]["asset_ids"] = [asset_mapping[i] for i in node["data"]["asset_ids"]]
            if node["kind"] == "embedded_method":
                node["data"]["study_test_id"] = mapping[node["data"]["study_test_id"]]
            if node["kind"] in {"group", "loop_samples"}:
                remap(node["data"]["children"])
            if node["kind"] == "serve_gate" and node["data"].get("study_test_id"):
                node["data"]["study_test_id"] = mapping[node["data"]["study_test_id"]]
            if node["kind"] == "serve_gate" and node["data"]["sample_binding"] == "set":
                node["data"]["sample_ids"] = [sample_mapping[i] for i in node["data"]["sample_ids"]]
            if node["kind"] == "loop_samples":
                node["data"]["sample_ids"] = [sample_mapping[i] for i in node["data"]["sample_ids"]]

    remap(flow["nodes"])
    flow["method_text"] = {mapping[k]: v for k, v in flow.get("method_text", {}).items()}
    return DraftFlowV2.model_validate(flow).model_dump(mode="json")
