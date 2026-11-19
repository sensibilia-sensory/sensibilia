"""Shared cloning and attributed draft snapshots, never assessment history."""

from copy import deepcopy

from sqlalchemy import select

from sensibilia.designs import clone_designs, version_designs
from sensibilia.flow_service import clone_flow, is_v2, revision_hash
from sensibilia.models import DraftAudit, Sample, StudyTest


def snapshot(db, version):
    from sensibilia.assets import asset_read, version_assets

    return {
        "title": version.title,
        "description": version.description,
        "form": deepcopy(version.form),
        "samples": [
            {"id": s.id, "code": s.code, "label": s.label, "ingredient_tags": s.ingredient_tags}
            for s in db.scalars(
                select(Sample).where(Sample.study_version_id == version.id).order_by(Sample.id)
            )
        ],
        "designs": [
            {"id": d.id, "loop_id": d.loop_id, "settings": d.settings, "sequences": d.sequences}
            for d in version_designs(db, version.id)
        ],
        "assets": [
            asset_read(db, a).model_dump(mode="json", exclude={"url"})
            for a in version_assets(db, version.id)
        ],
        "tests": [
            {"id": t.id, "test_type_id": t.test_type_id, "configuration": deepcopy(t.configuration)}
            for t in db.scalars(
                select(StudyTest)
                .where(StudyTest.study_version_id == version.id)
                .order_by(StudyTest.position)
            )
        ],
    }


def clone_content(db, previous, version):
    from sensibilia.assets import clone_assets

    asset_mapping = clone_assets(db, previous, version)
    sample_mapping = {}
    for sample in db.scalars(
        select(Sample).where(Sample.study_version_id == previous.id).order_by(Sample.id)
    ):
        cloned = Sample(
            study_version_id=version.id,
            code=sample.code,
            label=sample.label,
            ingredient_tags=deepcopy(sample.ingredient_tags),
        )
        db.add(cloned)
        db.flush()
        sample_mapping[sample.id] = cloned.id
    mapping = {}
    for test in db.scalars(
        select(StudyTest)
        .where(StudyTest.study_version_id == previous.id)
        .order_by(StudyTest.position)
    ):
        configuration = deepcopy(test.configuration)
        if "sample_ids" in configuration:
            configuration["sample_ids"] = [sample_mapping[s] for s in configuration["sample_ids"]]
        for key in ("reference_sample_id", "expected_sample_id"):
            if configuration.get(key):
                configuration[key] = sample_mapping[configuration[key]]
        cloned = StudyTest(
            study_version_id=version.id,
            test_type_id=test.test_type_id,
            position=test.position,
            configuration=configuration,
        )
        db.add(cloned)
        db.flush()
        mapping[test.id] = cloned.id
    if is_v2(previous.form):
        version.form = clone_flow(previous.form, mapping, sample_mapping, asset_mapping)
    clone_designs(db, previous, version, sample_mapping)
    return mapping


def record_changes(db):
    context = db.info.get("draft_audit")
    if not context:
        return
    db.flush()
    from sensibilia.models import StudyVersion

    for version in db.scalars(
        select(StudyVersion).where(StudyVersion.study_id == context["study_id"])
    ):
        current = revision_hash(version)
        if context["before"].get(version.id) == (current, version.published_at):
            continue
        previous = context.get("snapshots", {}).get(version.id)
        if previous and not db.scalar(
            select(DraftAudit.id).where(DraftAudit.study_version_id == version.id).limit(1)
        ):
            db.add(
                DraftAudit(
                    study_version_id=version.id,
                    principal=context["principal"],
                    action="baseline before " + context["action"],
                    revision_hash=context["before"][version.id][0],
                    snapshot=previous,
                )
            )
        db.add(
            DraftAudit(
                study_version_id=version.id,
                principal=context["principal"],
                action=context["action"],
                revision_hash=current,
                snapshot=snapshot(db, version),
            )
        )
        context["before"][version.id] = (current, version.published_at)
