"""Server causal replay of the bounded flow, using the existing outline/predicate semantics.

The browser evaluator remains the execution driver. This verifier trusts neither its
path reasons nor cursor, and only advances through audited submissions.
"""

from copy import deepcopy

from fastapi import HTTPException
from sqlalchemy import select

from sensibilia.flow_answers import normalized, validate_answer
from sensibilia.flow_semantics import evaluate_condition, outline
from sensibilia.flows import DraftFlowV2
from sensibilia.models import FormEvent, Observation, PathEvent, StudyTest, StudyVersion
from sensibilia.schemas import ProgressRead


def collected_path(db, session):
    return list(
        db.scalars(
            select(PathEvent).where(PathEvent.session_id == session.id).order_by(PathEvent.seq)
        )
    )


def replay(db, session, supplied=None):
    flow = DraftFlowV2.model_validate(db.get(StudyVersion, session.study_version_id).form)
    rows = collected_path(db, session) if supplied is None else supplied
    submitted = {(r.step_id, r.occurrence_id): r for r in rows if r.kind == "submitted"}
    entries = outline(flow.nodes)
    ends = []
    for i, (node, _, _) in enumerate(entries):
        end = i + 1
        while end < len(entries) and str(node.id) in entries[end][1]:
            end += 1
        ends.append(end)
    variables = {f"context.{k}": v for k, v in session.context.items()}
    variables.setdefault("context.language", flow.default_language)
    variables.setdefault("context.returning_code_hashes", [])
    assignments = {a["loop_id"]: a["samples"] for a in session.loop_assignments}
    answers, visited, expected = {}, [], []
    index, loop, review, outcome = 0, None, None, None

    def scope():
        if loop is None:
            return "study", None
        sample = assignments[loop["id"]][loop["position"]]
        return f"{loop['id']}:{sample['sample_id']}", sample["sample_id"]

    def emit(node, kind, reason=None, target=None, ids=None):
        occurrence, sample = scope()
        expected.append(
            dict(
                step_id=str(node.id),
                occurrence_id=occurrence,
                sample_id=sample,
                kind=kind,
                reason=reason,
                target_id=target,
                answer_event_ids=ids or [],
            )
        )

    def sample_scope():
        nonlocal variables, answers, visited
        sample = assignments[loop["id"]][loop["position"]]
        variables, answers, visited = (
            deepcopy(loop["variables"]),
            deepcopy(loop["answers"]),
            list(loop["visited"]),
        )
        variables.update(
            {f"sample.{k}": sample[k] for k in ("code", "position", "ingredient_tags")}
        )
        if "assessor.restrictions" in variables:
            tags = [
                tag
                for choice in variables["assessor.restrictions"]
                for tag in flow.restriction_tag_map.get(choice, [])
            ]
            variables["derived.sample_conflicts_restriction"] = any(
                tag in sample["ingredient_tags"] for tag in tags
            )

    def conflict(condition):
        children = getattr(condition, "all", getattr(condition, "any", None))
        if children is not None:
            if hasattr(condition, "all"):
                return any(not evaluate_condition(c, variables) and conflict(c) for c in children)
            return all(not evaluate_condition(c, variables) for c in children) and any(
                conflict(c) for c in children
            )
        return (
            condition.variable == "derived.sample_conflicts_restriction"
            and not evaluate_condition(condition, variables)
        )

    # At most 100 structural nodes x 50 samples, with bounded review detours.
    for _ in range(20000):
        if review:
            prior, resume = review
            emit(next(n for n, _, _ in entries if str(n.id) == prior), "reviewed")
            if len(rows) < len(expected):
                break
            review, index = None, resume
            continue
        if loop and index >= loop["exit"]:
            if loop["position"] + 1 < len(assignments[loop["id"]]):
                loop["position"] += 1
                index = loop["start"]
                sample_scope()
            else:
                variables, answers, visited = loop["variables"], loop["answers"], loop["visited"]
                loop = None
        if index >= len(entries):
            raise HTTPException(422, "Flow has no terminal path")
        node = entries[index][0]
        if node.guard and not evaluate_condition(node.guard, variables):
            action = node.otherwise.action
            reason = (
                "restriction"
                if action == "next_sample"
                and variables.get("derived.sample_conflicts_restriction") is True
                and conflict(node.guard)
                else "guard_false"
            )
            emit(
                node,
                "skipped",
                reason,
                str(node.otherwise.target_id) if hasattr(node.otherwise, "target_id") else None,
            )
            for n, _, _ in entries[index + 1 : ends[index]]:
                emit(n, "skipped", "not_shown")
            next_index = ends[index]
            if action in {"skip_to", "end_study"}:
                next_index = next(
                    i for i, (n, _, _) in enumerate(entries) if n.id == node.otherwise.target_id
                )
                for n, _, _ in entries[ends[index] : next_index]:
                    emit(n, "skipped", "jumped")
                if action == "end_study" and loop:
                    variables, answers, visited = (
                        loop["variables"],
                        loop["answers"],
                        loop["visited"],
                    )
                    loop = None
            elif action == "next_sample":
                next_index = loop["exit"]
                for n, _, _ in entries[ends[index] : next_index]:
                    emit(n, "skipped", "jumped")
            elif action == "previous_question":
                prior = next(
                    (
                        id
                        for id in reversed(visited)
                        if reviewable(answers.get(id))
                        and (
                            not loop
                            or loop["id"] in next(a for n, a, _ in entries if str(n.id) == id)
                        )
                    ),
                    None,
                )
                if not prior:
                    raise HTTPException(422, "No eligible previous answer")
                review = (prior, next_index)
            index = next_index
            continue
        if node.kind == "serve_gate" and node.data.sample_binding == "set":
            from sensibilia.booths import gate_slots

            variables["serving.codes"] = [s.code for s in gate_slots(db, session, node, "study")]
        emit(node, "entered")
        if node.kind == "group":
            index += 1
            continue
        if node.kind == "loop_samples":
            loop = dict(
                id=str(node.id),
                start=index + 1,
                exit=ends[index],
                position=0,
                variables=deepcopy(variables),
                answers=deepcopy(answers),
                visited=list(visited),
            )
            index += 1
            sample_scope()
            continue
        if node.kind == "end":
            emit(node, "ended")
            outcome = node.data.outcome if len(rows) >= len(expected) else None
            break
        occurrence, sample = scope()
        submission = submitted.get((str(node.id), occurrence))
        if submission is None:
            # An optional manual review is permitted only for an immutable eligible
            # answer in the current occurrence, and leaves execution unchanged.
            while len(rows) > len(expected) and rows[len(expected)].kind == "reviewed":
                candidate = rows[len(expected)]
                prior = candidate.step_id
                if (
                    prior not in visited
                    or not reviewable(answers.get(prior))
                    or (
                        loop
                        and loop["id"] not in next(a for n, a, _ in entries if str(n.id) == prior)
                    )
                ):
                    raise HTTPException(422, "Invalid previous-answer review")
                emit(next(n for n, _, _ in entries if str(n.id) == prior), "reviewed")
            break
        answer, ids = answer_for(db, session, node, occurrence, sample, variables)
        if submission.answer_event_ids != ids:
            raise HTTPException(422, "Submission must reference exactly its stored answer events")
        emit(node, "submitted", ids=ids)
        apply_answer(flow, node, answer, variables)
        answers[str(node.id)] = answer
        visited.append(str(node.id))
        index += 1
    else:
        raise HTTPException(422, "Flow replay exceeds its bounded limit")
    for i, row in enumerate(rows):
        if (
            i >= len(expected)
            or row.seq != i + 1
            or any(getattr(row, k) != v for k, v in expected[i].items())
        ):
            raise HTTPException(
                422, "Path sequence, occurrence, reason, target or causality is invalid"
            )
    return dict(
        node=node,
        variables=variables,
        occurrence_id=scope()[0],
        sample_id=scope()[1],
        expected=expected,
        outcome=outcome,
        visited=visited,
        review=review,
    )


def reviewable(answer):
    if not answer:
        return False
    if answer["state"] in {"answered", "code"}:
        return True
    if answer["state"] == "matrix":
        return any(a["state"] == "selected" for a in answer["answers"].values())
    if answer["state"] == "method":
        return any(a != "skipped" for a in answer["answers"].values())
    if answer["state"] == "method_values":
        return any(a["state"] != "skipped" for a in answer["answers"].values())
    return False


def answer_for(db, session, node, occurrence, sample, variables):
    if node.kind == "embedded_method":
        test = db.get(StudyTest, str(node.data.study_test_id))
        if test.test_type_id == "tcata-v1":
            from sensibilia.models import TemporalRun

            run = db.scalar(
                select(TemporalRun).where(
                    TemporalRun.session_id == session.id,
                    TemporalRun.step_id == str(node.id),
                    TemporalRun.occurrence_id == occurrence,
                )
            )
            if run is None:
                raise HTTPException(422, "Store the temporal run before submitting its path")
            return {"state": "temporal", "value": run.payload["value"]}, [run.client_event_id]
        events = list(
            db.scalars(
                select(Observation).where(
                    Observation.session_id == session.id,
                    Observation.step_id == str(node.id),
                    Observation.occurrence_id == occurrence,
                )
            )
        )
        by_question = {e.question_id: e for e in events}
        if any(
            q.get("required", True) and q["id"] not in by_question
            for q in test.configuration.get("questions", [])
        ):
            raise HTTPException(422, "Required method answers are missing")
        if not test.configuration.get("questions"):
            from sensibilia.methods import CONFIGURATIONS, required_observations

            required = {
                q
                for _, q in required_observations(
                    CONFIGURATIONS[test.test_type_id].model_validate(test.configuration)
                )
            }
            if set(by_question) != required:
                raise HTTPException(422, "Required set-level method answer is missing")
        if test.test_type_id != "hedonic-9-v1":
            return {
                "state": "method_values",
                "answers": {id: e.value for id, e in by_question.items()},
            }, sorted(e.client_event_id for e in events)
        answer = {
            "state": "method",
            "answers": {
                id: e.value["rating"] if e.value["state"] == "rated" else "skipped"
                for id, e in by_question.items()
            },
        }
        return answer, sorted(e.client_event_id for e in events)
    event = db.scalar(
        select(FormEvent).where(
            FormEvent.session_id == session.id,
            FormEvent.step_id == str(node.id),
            FormEvent.occurrence_id == occurrence,
        )
    )
    if event is None:
        raise HTTPException(422, "Store the ordinary answer before submitting its path event")
    try:
        validate_answer(node, event.value, variables)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return event.value, [event.client_event_id]


def apply_answer(flow, node, answer, variables):
    key, state = f"answer.{node.id}", answer["state"]
    if state == "answered":
        variables[key] = answer["value"]
    elif state == "matrix":
        for id, value in answer["answers"].items():
            if value["state"] == "selected":
                variables[f"{key}.{id}"] = value["option_id"]
    elif state == "method":
        for id, value in answer["answers"].items():
            if value != "skipped":
                variables[f"{key}.{id}"] = value
    elif state == "method_values":
        for id, value in answer["answers"].items():
            if value.get("kind") == "jar" and value["state"] == "rated":
                variables[f"{key}.{id}"] = value["rating"]
    elif state == "code":
        variables[key] = answer["normalized_code"]
        variables[f"{key}.matched"] = (
            answer["normalized_code"]
            == normalized(variables.get("sample.code", ""), node.data.normalization)
            if node.data.source == "sample_code"
            else answer["code_hash"] in variables.get("context.returning_code_hashes", [])
        )
    if node.id == flow.restriction_source_id and state == "answered":
        variables["assessor.restrictions"] = [
            id
            for id in answer["value"]
            if not next(o for o in node.data.options if o.id == id).exclusive
        ]


def current_for_write(db, session, step_id, occurrence_id, sample_id):
    state = replay(db, session)
    if (
        session.status not in ("in_progress", "ended")
        or state["outcome"]
        or state["review"]
        or len(collected_path(db, session)) != len(state["expected"])
    ):
        raise HTTPException(
            409, "Synchronise the entered path before submitting the current answer"
        )
    if (
        str(state["node"].id) != step_id
        or state["occurrence_id"] != occurrence_id
        or state["sample_id"] != sample_id
    ):
        raise HTTPException(409, "Answer is not for the current assigned occurrence")
    return state


def progress_v2(db, session):
    state = replay(db, session)
    return ProgressRead(
        current_step_id=None
        if state["outcome"]
        else state["review"][0]
        if state["review"]
        else str(state["node"].id),
        outcome=state["outcome"],
        visited_step_ids=state["visited"],
        occurrence_id=state["occurrence_id"],
        next_seq=len(collected_path(db, session)) + 1,
    )
