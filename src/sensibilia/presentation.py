"""Frozen session serving plans. Private product keys never enter tablet packages."""

import secrets
from collections import Counter

from sqlalchemy import select

from sensibilia.methods import (
    CONFIGURATIONS,
    AttributeConfiguration,
    DuoTrioConfiguration,
    TCATAConfiguration,
    TriangleConfiguration,
    TwoAFCConfiguration,
    sample_ids,
)
from sensibilia.models import Sample, SessionTestAssignment, StudyVersion


def version_samples(db, version_id):
    return list(
        db.scalars(
            select(Sample).where(Sample.study_version_id == version_id).order_by(Sample.code)
        )
    )


def validate_samples(db, version_id, configuration):
    available = {sample.id for sample in version_samples(db, version_id)}
    if not set(sample_ids(configuration)) <= available:
        raise ValueError("Configured samples must belong to this draft study version")


def assignment_for(db, session_id, test_id):
    return db.scalar(
        select(SessionTestAssignment).where(
            SessionTestAssignment.session_id == session_id,
            SessionTestAssignment.study_test_id == test_id,
        )
    )


def provision_assignments(db, session, tests):
    products = {s.id: s for s in version_samples(db, session.study_version_id)}
    form = db.get(StudyVersion, session.study_version_id).form
    entries = []
    if form and form.get("schema_version") == 2:
        from sensibilia.flow_semantics import outline
        from sensibilia.flows import DraftFlowV2

        entries = outline(DraftFlowV2.model_validate(form).nodes)
    for test in tests:
        config = CONFIGURATIONS[test.test_type_id].model_validate(test.configuration)
        ids = sample_ids(config)
        loop_samples = None
        if entries and isinstance(config, (AttributeConfiguration, TCATAConfiguration)):
            binding = next(
                (
                    e
                    for e in entries
                    if e[0].kind == "embedded_method" and str(e[0].data.study_test_id) == test.id
                ),
                None,
            )
            if binding and binding[0].data.sample_binding == "current":
                loop_id = next(
                    a
                    for a in reversed(binding[1])
                    if any(str(n.id) == a and n.kind == "loop_samples" for n, _, _ in entries)
                )
                loop_samples = next(
                    a["samples"] for a in session.loop_assignments if a["loop_id"] == loop_id
                )
                ids = [s["sample_id"] for s in loop_samples]
        if not ids:
            continue
        plan = {"kind": config.kind, "samples": [], "reference": None}
        if isinstance(config, (TriangleConfiguration, TwoAFCConfiguration)):
            if isinstance(config, TwoAFCConfiguration):
                patterns = [(None, ids), (None, ids[::-1])]
            elif isinstance(config, DuoTrioConfiguration):
                refs = (
                    ids
                    if config.reference_mode == "balanced"
                    else [str(config.reference_sample_id)]
                )
                patterns = [(ref, order) for ref in refs for order in (ids, ids[::-1])]
            else:
                patterns = [
                    (None, [ids[0] if char == "A" else ids[1] for char in sequence])
                    for sequence in ("AAB", "ABA", "BAA", "ABB", "BAB", "BBA")
                ]
            counts = Counter(
                a.plan["sequence_key"]
                for a in db.scalars(
                    select(SessionTestAssignment).where(
                        SessionTestAssignment.study_test_id == test.id
                    )
                )
            )
            keys = [f"{ref or ''}|{','.join(order)}" for ref, order in patterns]
            lowest = min(counts[key] for key in keys)
            index = secrets.choice([i for i, key in enumerate(keys) if counts[key] == lowest])
            reference, order = patterns[index]
            # Distinct random codes even when two servings contain the same product.
            codes = secrets.SystemRandom().sample(range(100, 1000), len(order) + bool(reference))
            plan["sequence_key"] = keys[index]
            for i, sample in enumerate(order):
                plan["samples"].append(
                    {
                        "slot_id": f"s{i + 1}",
                        "code": str(codes[i]),
                        "sample_id": sample,
                        "label": products[sample].label,
                    }
                )
            if reference:
                plan["reference"] = {
                    "slot_id": "reference",
                    "code": str(codes[-1]),
                    "sample_id": reference,
                    "label": products[reference].label,
                }
                correct = order.index(reference)
            elif isinstance(config, TwoAFCConfiguration):
                # Preference tests have no correct answer, so no key is stored.
                correct = (
                    order.index(str(config.expected_sample_id))
                    if config.task == "directional"
                    else None
                )
            else:
                correct = next(i for i, sample in enumerate(order) if order.count(sample) == 1)
            if correct is not None:
                plan["correct_slot_id"] = f"s{correct + 1}"
        else:
            order = ids.copy()
            if loop_samples is None:
                secrets.SystemRandom().shuffle(order)
            plan["samples"] = [
                {
                    "slot_id": sample,
                    "sample_id": sample,
                    "code": products[sample].code,
                    "label": products[sample].label,
                }
                for sample in order
            ]
        db.add(SessionTestAssignment(session_id=session.id, study_test_id=test.id, plan=plan))
        db.flush()


def public_assignment(assignment):
    plan = assignment.plan
    discrimination = plan["kind"] in {"triangle", "duo_trio", "two_afc"}

    def public_slot(slot):
        fields = {"slot_id": slot["slot_id"], "code": slot["code"]}
        if not discrimination:
            fields["sample_id"] = slot["sample_id"]
        return fields

    return {
        "study_test_id": assignment.study_test_id,
        "kind": plan["kind"],
        "samples": [public_slot(slot) for slot in plan["samples"]],
        "reference": public_slot(plan["reference"]) if plan["reference"] else None,
    }
