"""Explicit, bounded conversion; legacy publications and default cloning stay v1."""

from itertools import combinations
from uuid import NAMESPACE_URL, uuid5

from sensibilia.flows import DraftFlowV2
from sensibilia.forms import StudyForm


def convert_legacy(form, mapping, study_id):
    legacy = StudyForm.model_validate(form)
    ids = {
        s.id: str(uuid5(NAMESPACE_URL, f"sensibilia:{study_id}:legacy:{s.id}"))
        for s in legacy.steps
    }
    ids.update(
        {
            key: str(uuid5(NAMESPACE_URL, f"sensibilia:{study_id}:legacy:{key}"))
            for key in ("complete", "screen_out")
        }
    )

    def combine(key, parts):
        if key == "all" and any(p is False for p in parts):
            return False
        if key == "any" and any(p is True for p in parts):
            return True
        neutral = True if key == "all" else False
        flat = []
        for part in parts:
            if part is neutral:
                continue
            if isinstance(part, dict) and key in part:
                flat.extend(part[key])
            else:
                flat.append(part)
        return flat[0] if len(flat) == 1 else {key: flat} if flat else neutral

    incoming = {legacy.steps[0].id: [True]}
    nodes = []
    for i, step in enumerate(legacy.steps):
        reach = combine("any", incoming.get(step.id, []))
        localized = lambda value: {"en": value}  # noqa: E731
        node = {"id": ids[step.id], "title": localized(step.title)}
        if reach is not True:
            node["guard"] = reach
        if step.kind == "instruction":
            node.update(
                kind="confirm" if step.acknowledgement_label else "info",
                data={
                    "body": localized(step.text),
                    "ack_label" if step.acknowledgement_label else "continue_label": localized(
                        step.acknowledgement_label or step.continue_label
                    ),
                },
            )
        elif step.kind == "choice":
            node.update(
                kind="question",
                data={
                    "prompt": localized((step.text + "\n" + step.prompt).strip()),
                    "answer_type": "multiple" if step.multiple else "single",
                    "required": True,
                    "allow_skip": False,
                    "options": [
                        {"id": o.id, "label": localized(o.label), "exclusive": o.exclusive}
                        for o in step.options
                    ],
                },
            )
        elif step.kind == "matrix":
            node.update(
                kind="matrix_question",
                data={
                    "instructions": localized(step.instructions),
                    "allow_skip": step.allow_skips,
                    "rows": [
                        {"id": r.id, "prompt": localized(r.prompt), "required": r.required}
                        for r in step.rows
                    ],
                    "options": [
                        {"id": o.id, "label": localized(o.label), "score": o.score}
                        for o in step.scale
                    ],
                },
            )
        else:
            node.update(
                kind="embedded_method",
                data={"study_test_id": mapping[step.study_test_id], "sample_binding": "none"},
            )
        nodes.append(node)
        route = step.route
        branches = [(route.otherwise, True)]
        if route.condition:
            c = route.condition
            source = next(s for s in legacy.steps if s.id == c.source_step_id)
            variable = f"answer.{ids[source.id]}"
            defined = {"variable": variable, "operator": "is_defined"}
            if not source.multiple:
                yes = {"variable": variable, "operator": "in", "value": c.option_ids}
                no = {
                    "variable": variable,
                    "operator": "in",
                    "value": [o.id for o in source.options if o.id not in c.option_ids],
                }
            else:
                yes = (
                    {"variable": variable, "operator": "intersects", "value": c.option_ids}
                    if c.match == "any"
                    else combine(
                        "all",
                        [
                            {"variable": variable, "operator": "contains", "value": option}
                            for option in c.option_ids
                        ],
                    )
                )
                # The closed v2 language has no NOT/set-not-membership operator.
                # Enumerate only bounded valid complementary selections; never invent one.
                ordinary = [o.id for o in source.options if not o.exclusive]
                if len(ordinary) > 4:
                    raise ValueError(
                        "Legacy multi-choice route exceeds bounded conversion; "
                        "retain v1 or author v2 explicitly"
                    )
                selections = [[o.id] for o in source.options if o.exclusive]
                selections += [
                    list(items)
                    for size in range(1, len(ordinary) + 1)
                    for items in combinations(ordinary, size)
                ]
                negative = [
                    items
                    for items in selections
                    if not (
                        bool(set(items) & set(c.option_ids))
                        if c.match == "any"
                        else set(c.option_ids) <= set(items)
                    )
                ]
                no = combine(
                    "any",
                    [
                        {"variable": variable, "operator": "eq", "value": items}
                        for items in negative
                    ],
                )
            branches = [
                (route.then, combine("all", [defined, yes])),
                (route.otherwise, combine("all", [defined, no])),
            ]
        for target, predicate in branches:
            if target == "next":
                target = legacy.steps[i + 1].id if i + 1 < len(legacy.steps) else "complete"
            condition = combine("all", [reach, predicate])
            if condition is not False:
                incoming.setdefault(target, []).append(condition)
    for terminal, message, outcome in [
        ("complete", legacy.completion_message, "completed"),
        ("screen_out", legacy.screen_out_message, "screened_out"),
    ]:
        if terminal not in incoming:
            continue
        reach = combine("any", incoming[terminal])
        node = {
            "id": ids[terminal],
            "kind": "end",
            "title": {"en": outcome},
            "data": {"body": {"en": message}, "outcome": outcome},
        }
        if terminal == "complete" and "screen_out" in incoming and reach is not True:
            node["guard"] = reach
        nodes.append(node)
    return DraftFlowV2.model_validate(
        {"schema_version": 2, "languages": ["en"], "default_language": "en", "nodes": nodes}
    ).model_dump(mode="json")
