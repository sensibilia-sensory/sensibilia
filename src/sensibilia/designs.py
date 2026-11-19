"""Bounded serving-order designs; reuse loop identity and immutable session packages."""

import hashlib
from copy import deepcopy
from itertools import combinations
from math import comb

from fastapi import HTTPException
from sqlalchemy import func, select

from sensibilia.flows import DraftFlowV2, walk
from sensibilia.models import DesignAllocation, Sample, StudyDesign

GENERATOR = "orders-sha256-v1"


def keyed(seed, value):
    return hashlib.sha256((str(seed) + ":" + str(value)).encode()).digest()


def sequences(ids, algorithm, seed, count, block_size=None):
    """Latin positions and Williams ordered-pair balance over a complete cycle.

    Williams EJ (1949), Experimental designs balanced for the estimation of
    residual effects of treatments. Australian Journal of Scientific Research A 2,
    149–168. Odd treatment counts use the reversed second square.
    """
    n = len(ids)
    if not 2 <= n <= 50 or len(set(ids)) != n:
        raise ValueError("Design requires 2–50 distinct loop samples")
    if algorithm == "incomplete":
        if block_size is None or not 2 <= block_size < n:
            raise ValueError("Incomplete blocks require 2 <= block size < sample count")
        if comb(n, block_size) * block_size > 1000:
            raise ValueError(
                "Complete subset cycle exceeds 1000 sequences; reduce sample/block counts"
            )
        labels = sorted(ids, key=lambda i: keyed(seed, ids.index(i)))
        return [
            list(group[shift:] + group[:shift])
            for group in combinations(labels, block_size)
            for shift in range(block_size)
        ]
    if algorithm == "fixed":
        return [ids.copy()]
    if algorithm == "shuffle":
        return [sorted(ids, key=lambda i: keyed(seed, f"{row}:{i}")) for row in range(count)]
    labels = sorted(range(n), key=lambda i: keyed(seed, i))
    if algorithm == "latin":
        base = list(range(n))
    elif algorithm == "williams":
        base = [0]
        for i in range(1, n):
            base.append((i + 1) // 2 if i % 2 else n - i // 2)
    else:
        raise ValueError("Unknown design algorithm")
    rows = [[ids[labels[(i + shift) % n]] for i in base] for shift in range(n)]
    if algorithm == "williams" and n % 2:
        rows += [row[::-1] for row in rows]
    return rows


def loop_for(version, loop_id):
    if not version.form or version.form.get("schema_version") != 2:
        raise HTTPException(422, "Designs require a v2 sample loop")
    loop = next(
        (
            n
            for n in walk(DraftFlowV2.model_validate(version.form).nodes)
            if n.kind == "loop_samples" and str(n.id) == str(loop_id)
        ),
        None,
    )
    if loop is None:
        raise HTTPException(422, "Design loop does not belong to this version")
    return loop


def version_designs(db, version_id):
    return list(
        db.scalars(
            select(StudyDesign)
            .where(StudyDesign.study_version_id == version_id)
            .order_by(StudyDesign.loop_id)
        )
    )


def design_issues(db, version, flow):
    loops = {
        str(n.id): [str(s) for s in n.data.sample_ids]
        for n in walk(flow.nodes)
        if n.kind == "loop_samples"
    }
    issues = []
    for d in version_designs(db, version.id):
        if loops.get(d.loop_id) != d.settings["sample_ids"]:
            issues.append(
                {
                    "severity": "error",
                    "node_id": d.loop_id,
                    "study_test_id": None,
                    "path": ["nodes", d.loop_id, "data", "sample_ids"],
                    "code": "stale_design",
                    "message": "Loop samples changed. Regenerate or remove its design.",
                }
            )
    return issues


def generate(db, version, payload):
    loop = loop_for(version, payload.loop_id)
    ids = [str(s) for s in loop.data.sample_ids]
    if any(db.get(Sample, s).ingredient_tags is None for s in ids):
        raise HTTPException(422, "Review ingredient tags before generating a design")
    try:
        rows = sequences(
            ids, payload.algorithm, payload.seed, payload.sequence_count, payload.block_size
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    if (payload.algorithm == "incomplete") != (payload.block == "incomplete") or (
        payload.algorithm != "incomplete" and payload.block_size is not None
    ):
        raise HTTPException(422, "Block policy must match the selected design algorithm")
    settings = payload.model_dump(mode="json", exclude={"revision_hash", "loop_id"})
    settings.update(
        sample_ids=ids,
        generator_version=GENERATOR,
        objective={
            "fixed": "none",
            "shuffle": "independent randomisation",
            "latin": "position balance",
            "williams": "first-order carryover balance",
            "incomplete": "pair incidence and position balance",
        }[payload.algorithm],
    )
    d = db.scalar(
        select(StudyDesign).where(
            StudyDesign.study_version_id == version.id, StudyDesign.loop_id == str(loop.id)
        )
    )
    if d is None:
        d = StudyDesign(study_version_id=version.id, loop_id=str(loop.id))
        db.add(d)
    d.settings, d.sequences = settings, rows
    db.flush()
    return d


def allocate(db, version, session):
    designs = {d.loop_id: d for d in version_designs(db, version.id)}
    assignments = []
    for loop in walk(DraftFlowV2.model_validate(version.form).nodes):
        if loop.kind != "loop_samples" and not (
            loop.kind == "serve_gate" and loop.data.sample_binding == "set"
        ):
            continue
        ids = [str(s) for s in loop.data.sample_ids]
        meta = {}
        if d := designs.get(str(loop.id)):
            if ids != d.settings["sample_ids"]:
                raise HTTPException(422, "Published design does not match its loop")
            ordinal = db.scalar(
                select(func.count())
                .select_from(DesignAllocation)
                .where(DesignAllocation.design_id == d.id)
            )
            index = ordinal % len(d.sequences)
            ids = d.sequences[index]
            db.add(
                DesignAllocation(
                    design_id=d.id, session_id=session.id, ordinal=ordinal, sequence_index=index
                )
            )
            meta = {
                "design_id": d.id,
                "design_seed": d.settings["seed"],
                "design_algorithm": d.settings["algorithm"],
                "design_block": d.settings["block"],
                "design_block_size": d.settings.get("block_size"),
                "generator_version": d.settings["generator_version"],
                "allocation_ordinal": ordinal,
                "sequence_index": index,
            }
        samples = []
        for position, sample_id in enumerate(ids, 1):
            sample = db.get(Sample, sample_id)
            if not sample or sample.ingredient_tags is None:
                raise HTTPException(422, "Loop samples require reviewed ingredient tags")
            samples.append(
                {
                    "sample_id": sample.id,
                    "code": sample.code,
                    "position": position,
                    "ingredient_tags": deepcopy(sample.ingredient_tags),
                }
            )
        assignments.append({"loop_id": str(loop.id), "samples": samples, **meta})
    return assignments


def clone_designs(db, previous, version, mapping):
    for d in version_designs(db, previous.id):
        settings = deepcopy(d.settings)
        settings["sample_ids"] = [mapping[s] for s in settings["sample_ids"]]
        db.add(
            StudyDesign(
                study_version_id=version.id,
                loop_id=d.loop_id,
                settings=settings,
                sequences=[[mapping[s] for s in row] for row in d.sequences],
            )
        )


def blind_codes(db, version, seed):
    samples = list(
        db.scalars(select(Sample).where(Sample.study_version_id == version.id).order_by(Sample.id))
    )
    if not samples or len(samples) > 900:
        raise HTTPException(422, "Blinding requires 1–900 samples")
    codes = sorted(range(100, 1000), key=lambda i: keyed(seed, i))[: len(samples)]
    # A flush between phases avoids unique-code conflicts when codes are permuted.
    for s in samples:
        s.code = "tmp_" + s.id
    db.flush()
    for s, code in zip(samples, codes, strict=True):
        s.code = str(code)
    db.flush()
    return samples
