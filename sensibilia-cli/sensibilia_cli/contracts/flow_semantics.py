"""Bounded graph/type checks for guards and fixed sample loops."""

from .flows import All, AnyCondition, Defined, MethodNode


def outline(nodes, ancestors=(), prefix=()):
    result = []
    for i, node in enumerate(nodes):
        number = (*prefix, i + 1)
        result.append((node, ancestors, number))
        if node.kind in {"group", "loop_samples"}:
            result.extend(outline(node.data.children, (*ancestors, str(node.id)), number))
    return result


def variable_catalog(flow, tests):
    variables = {
        "context.language": ("string", None, True),
        "context.booth_number": ("number", None, False),
        "context.table_number": ("number", None, False),
        "context.returning_code_hashes": ("set", None, True),
    }
    inventory = {t.id: t for t in tests}
    for node, _, _ in outline(flow.nodes):
        key = f"answer.{node.id}"
        data = node.data
        if node.kind == "consent":
            variables[key] = ("boolean", str(node.id), True)
        elif node.kind == "question":
            kind = {"single": "string", "multiple": "set", "text": "string", "integer": "number"}
            variables[key] = (
                kind[data.answer_type],
                str(node.id),
                data.required and not data.allow_skip,
            )
        elif node.kind == "matrix_question":
            for row in data.rows:
                variables[f"{key}.{row.id}"] = (
                    "string",
                    str(node.id),
                    row.required and not data.allow_skip,
                )
        elif node.kind == "code_entry":
            variables[key] = ("string", str(node.id), True)
            variables[f"{key}.matched"] = ("boolean", str(node.id), True)
        elif isinstance(node, MethodNode) and str(data.study_test_id) in inventory:
            config = inventory[str(data.study_test_id)].configuration
            for question in (
                config.get("questions", [])
                if inventory[str(data.study_test_id)].test_type_id in {"hedonic-9-v1", "jar-v1"}
                else []
            ):
                variables[f"{key}.{question['id']}"] = (
                    "number",
                    str(node.id),
                    question.get("required", True) and not config.get("allow_skips", False),
                )
    if flow.restriction_source_id:
        source = next(
            (n for n, _, _ in outline(flow.nodes) if n.id == flow.restriction_source_id), None
        )
        if source and source.kind == "question" and source.data.answer_type == "multiple":
            variables["assessor.restrictions"] = (
                "set",
                str(source.id),
                source.data.required and not source.data.allow_skip,
            )
    variables.update(
        {
            "sample.code": ("string", None, True),
            "sample.position": ("number", None, True),
            "sample.ingredient_tags": ("set", None, True),
            "derived.sample_conflicts_restriction": (
                "boolean",
                str(flow.restriction_source_id) if flow.restriction_source_id else None,
                True,
            ),
        }
    )
    return variables


def literal_type(value):
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list) and all(isinstance(v, str) for v in value):
        return "set"
    return "invalid"


def constant_result(condition, languages):
    """Only provable constants/contradictions; never solve arbitrary predicates."""
    if condition is None:
        return True
    if isinstance(condition, (All, AnyCondition)):
        children = getattr(condition, "all", getattr(condition, "any", []))
        results = [constant_result(c, languages) for c in children]
        if isinstance(condition, All):
            if False in results:
                return False
            # A fixed equality can disprove another conjunct on the same variable.
            predicates = [c for c in children if hasattr(c, "operator")]
            for fixed in predicates:
                if fixed.operator == "eq":
                    for other in predicates:
                        if other.variable == fixed.variable and not evaluate_condition(
                            other, {fixed.variable: fixed.value}
                        ):
                            return False
            return True if all(r is True for r in results) else None
        if True in results:
            return True
        return False if all(r is False for r in results) else None
    if condition.variable == "context.language":
        results = [evaluate_condition(condition, {"context.language": lang}) for lang in languages]
        if all(results):
            return True
        if not any(results):
            return False
    if getattr(condition, "operator", None) in {"in", "intersects"} and condition.value == []:
        return False
    return None


def semantic_issues(flow, tests):
    entries = outline(flow.nodes)
    if not entries:
        return []
    positions = {str(n.id): i for i, (n, _, _) in enumerate(entries)}
    catalog = variable_catalog(flow, tests)
    issues = []
    loops = {
        str(n.id): (i, ancestors)
        for i, (n, ancestors, _) in enumerate(entries)
        if n.kind == "loop_samples"
    }
    scope = {
        str(n.id): next((a for a in ancestors if a in loops), None) for n, ancestors, _ in entries
    }

    def error(node, code, message, field, severity="error"):
        issues.append(
            {
                "severity": severity,
                "node_id": str(node.id),
                "study_test_id": None,
                "path": ["nodes", str(node.id), field],
                "code": code,
                "message": message,
            }
        )

    ends = []
    for i, (node, ancestors, _) in enumerate(entries):
        end = i + 1
        while end < len(entries) and str(node.id) in entries[end][1]:
            end += 1
        ends.append(end)
        action = node.otherwise
        if action.action in {"skip_to", "end_study"}:
            target = positions.get(str(action.target_id))
            if (
                target is None
                or target < end
                or entries[target][1] != ancestors[: len(entries[target][1])]
            ):
                error(
                    node,
                    "illegal_target",
                    "Target must be a later sibling or ancestor-sibling, never an interior",
                    "otherwise",
                )
            elif action.action == "end_study" and (
                entries[target][0].kind != "end"
                or entries[target][0].data.outcome != "screened_out"
                or entries[target][0].guard is not None
            ):
                error(
                    node,
                    "illegal_end",
                    "End study must target a later unguarded screened-out end",
                    "otherwise",
                )
        if node.kind == "embedded_method":
            test = next((t for t in tests if t.id == str(node.data.study_test_id)), None)
            if test:
                config = test.configuration
                set_method = test.test_type_id in {
                    "triangle-v1",
                    "duo-trio-v1",
                    "two-afc-v1",
                    "flash-profile-v1",
                    "napping-v1",
                }
                if set_method != (node.data.sample_binding == "set"):
                    error(
                        node,
                        "method_binding",
                        "Set methods require set binding; attribute methods use none/current",
                        "data",
                    )
                if set_method and flow.restriction_source_id:
                    error(
                        node,
                        "unsafe_method_set",
                        "Restriction-aware set tasks require a reviewed exclusion protocol; "
                        "use a separate eligible assessment",
                        "data",
                    )
                ids = set(config.get("sample_ids", []))
                loop_node = next(
                    (n for n, _, _ in entries if str(n.id) == scope[str(node.id)]), None
                )
                if not set_method and ids:
                    if loop_node is None or not set(map(str, loop_node.data.sample_ids)) <= ids:
                        error(
                            node,
                            "method_samples",
                            "Configured attribute samples must cover the containing sample loop",
                            "data",
                        )
        if action.action == "next_sample" and not scope[str(node.id)]:
            error(node, "sample_scope", "Next sample requires a containing loop", "otherwise")
        if (
            node.kind == "code_entry"
            and node.data.source == "sample_code"
            and not scope[str(node.id)]
        ):
            error(node, "sample_scope", "Sample code requires a containing loop", "data")
        if (
            node.kind == "serve_gate"
            and node.data.sample_binding == "set"
            and flow.restriction_source_id
        ):
            error(
                node,
                "unsafe_serving_set",
                "Restriction-aware set serving awaits the set-method capability; "
                "use guarded sample loops",
                "data",
            )
        if node.kind == "serve_gate" and scope[str(node.id)] and flow.restriction_source_id:

            def safe_guard(condition):
                if condition is None:
                    return False
                if hasattr(condition, "all"):
                    return any(safe_guard(c) for c in condition.all)
                if hasattr(condition, "any"):
                    return all(safe_guard(c) for c in condition.any)
                return (
                    condition.variable == "derived.sample_conflicts_restriction"
                    and condition.operator == "eq"
                    and condition.value is False
                )

            candidates = [node, *[entries[positions[a]][0] for a in ancestors]]
            if not any(
                safe_guard(n.guard) and n.otherwise.action == "next_sample" for n in candidates
            ):
                error(
                    node,
                    "unsafe_serving",
                    "Guard serving against declared sample restrictions, with Next sample",
                    "guard",
                )
        if node.kind == "end" and scope[str(node.id)]:
            error(node, "loop_end", "Terminal nodes must be outside sample loops", "data")
        if (
            action.action == "skip_to"
            and str(action.target_id) in positions
            and scope[str(action.target_id)] != scope[str(node.id)]
        ):
            error(node, "sample_scope", "Skip to cannot cross a sample loop boundary", "otherwise")
    if flow.restriction_source_id:
        source = next((n for n, _, _ in entries if n.id == flow.restriction_source_id), None)
        if (
            not source
            or source.kind != "question"
            or source.data.answer_type != "multiple"
            or not source.data.required
            or source.data.allow_skip
        ):
            error(
                entries[0][0],
                "restriction_source",
                "Restrictions require a required multiple choice question without skipping",
                "restriction_source_id",
            )
        elif len([o for o in source.data.options if o.exclusive]) != 1:
            error(
                source,
                "restriction_none",
                "Restrictions require one explicit exclusive none option",
                "data",
            )

    if loops and flow.restriction_source_id:
        source = next((n for n, _, _ in entries if n.id == flow.restriction_source_id), None)
        if source and source.kind == "question":
            expected = {o.id for o in source.data.options if not o.exclusive}
            if set(flow.restriction_tag_map) != expected or any(
                not tags or any(not tag.strip() for tag in tags)
                for tags in flow.restriction_tag_map.values()
            ):
                error(
                    source,
                    "restriction_tags",
                    "Map every restriction option to explicit nonblank ingredient tags",
                    "restriction_tag_map",
                )
            if scope[str(source.id)]:
                error(
                    source,
                    "restriction_source",
                    "Restrictions must be declared before the sample loop",
                    "data",
                )

    gates = {}
    for gate, _, _ in entries:
        if gate.kind == "serve_gate":
            gates.setdefault(scope[str(gate.id)], []).append(str(gate.id))
    for loop_id, ids in gates.items():
        if loop_id and len(ids) > 1:
            error(
                entries[positions[ids[1]]][0],
                "repeated_serving",
                "Use separate sample loops for repeated serving rounds",
                "data",
            )
    incoming = {
        0: [
            (
                set(
                    k
                    for k, (_, source, required) in catalog.items()
                    if source is None and required and not k.startswith(("sample.", "derived."))
                ),
                False,
            )
        ]
    }
    serving_incoming = {0: [set()]}

    def omission_target(index, node, loop_id):
        target = ends[index]
        if node.otherwise.action == "next_sample" and loop_id:
            target = ends[loops[loop_id][0]]
        if node.otherwise.action in {"skip_to", "end_study"}:
            target = positions.get(str(node.otherwise.target_id), len(entries))
        return target

    for i, (node, _, _) in enumerate(entries):
        paths = incoming.get(i, [])
        before = set.intersection(*(p[0] for p in paths)) if paths else set()
        loop_id = scope[str(node.id)]
        before = {
            k
            for k in before
            if not (
                k.startswith(("sample.", "derived."))
                or (catalog.get(k, (None, None, False))[1] and scope.get(catalog[k][1]))
            )
            or (
                loop_id
                and (k.startswith(("sample.", "derived.")) or scope.get(catalog[k][1]) == loop_id)
            )
        }
        if loop_id:
            before.update({"sample.code", "sample.position", "sample.ingredient_tags"})
            if "assessor.restrictions" in before:
                before.add("derived.sample_conflicts_restriction")
        reviewed = bool(paths) and all(p[1] for p in paths)
        if loop_id:
            reviewed = reviewed and any(
                source and scope.get(source) == loop_id and required and key in before
                for key, (_, source, required) in catalog.items()
            )

        def check(condition, available, node=node, i=i, loop_id=loop_id, paths=paths):
            if isinstance(condition, All):
                current = set(available)
                for child in condition.all:
                    current |= check(child, current)
                return current - available
            if isinstance(condition, AnyCondition):
                results = [check(child, set(available)) for child in condition.any]
                return set.intersection(*results)
            variable = condition.variable
            declared = catalog.get(variable)
            if declared is None:
                error(node, "unknown_variable", f"Unknown variable: {variable}", "guard")
                return set()
            kind, source, _ = declared
            if (variable.startswith(("sample.", "derived.")) and not loop_id) or (
                source and scope.get(source) and scope[source] != loop_id
            ):
                error(
                    node,
                    "sample_scope",
                    "Sample variables/answers cannot escape their loop",
                    "guard",
                )
            if (
                variable == "derived.sample_conflicts_restriction"
                and not flow.restriction_source_id
            ):
                error(
                    node,
                    "restriction_source",
                    "Conflict checks require declared restrictions",
                    "guard",
                )
            if source is not None and positions[source] >= i:
                error(
                    node,
                    "prior_definition",
                    "An entry guard must read an earlier answer; never its own answer",
                    "guard",
                )
            if isinstance(condition, Defined):
                return {variable}
            if paths and variable not in available:
                error(
                    node,
                    "undefined_variable",
                    f"{variable} may be missing/skipped; gate it with is_defined AND",
                    "guard",
                )
            value_kind = literal_type(condition.value)
            op = condition.operator
            valid = (
                (op in {"eq", "neq"} and kind == value_kind)
                or (op in {"lt", "lte", "gt", "gte"} and kind == value_kind == "number")
                or (op == "contains" and kind == "set" and value_kind == "string")
                or (op == "intersects" and kind == value_kind == "set")
                or (
                    op == "in"
                    and kind != "set"
                    and isinstance(condition.value, list)
                    and all(literal_type(v) == kind for v in condition.value)
                )
            )
            if not valid:
                error(node, "predicate_type", f"Operator/literal incompatible with {kind}", "guard")
            return set()

        gate_paths = serving_incoming.get(i, [])
        gate_before = set.intersection(*gate_paths) if gate_paths else set()
        if node.kind == "serve_gate" and node.data.study_test_id:
            test = next((t for t in tests if t.id == str(node.data.study_test_id)), None)
            if not test or "questions" in test.configuration or node.data.sample_ids:
                error(
                    node,
                    "serving_method",
                    "Choose one set method serving plan without explicit samples",
                    "data",
                )
        if node.kind == "embedded_method" and gate_paths:
            required_gates = gates.get(loop_id, [])
            if node.data.sample_binding == "set":
                linked = [
                    n
                    for n, _, _ in entries
                    if n.kind == "serve_gate"
                    and n.data.study_test_id
                    and str(n.data.study_test_id) == str(node.data.study_test_id)
                ]
                required_gates = [str(n.id) for n in linked]
                unrelated = [
                    n
                    for n, _, _ in entries
                    if n.kind == "serve_gate"
                    and n.data.sample_binding == "set"
                    and not n.data.study_test_id
                ]
                if unrelated and not linked:
                    error(
                        node,
                        "serving_method",
                        "Set tasks with serving gates must explicitly use their frozen method plan",
                        "data",
                    )
            if required_gates and not any(id in gate_before for id in required_gates):
                error(
                    node,
                    "serving_bypass",
                    "Place serving before tasting on every permitted path",
                    "data",
                )
        gate_after = gate_before | ({str(node.id)} if node.kind == "serve_gate" else set())
        if gate_paths:
            if node.kind != "end" and i + 1 < len(entries):
                serving_incoming.setdefault(i + 1, []).append(gate_after)
            if node.guard:
                target = omission_target(i, node, loop_id)
                if i < target < len(entries):
                    serving_incoming.setdefault(target, []).append(gate_before)
        proof = check(node.guard, before) if node.guard else set()
        if node.otherwise.action == "previous_question" and not reviewed:
            error(
                node,
                "previous_missing",
                "Review needs an earlier guaranteed answered question",
                "otherwise",
            )
        after = (
            before
            | proof
            | {
                k
                for k, (_, source, required) in catalog.items()
                if source == str(node.id) and required
            }
        )
        after_review = (
            reviewed
            or (node.kind in {"consent", "code_entry"})
            or (node.kind == "question" and node.data.required and not node.data.allow_skip)
            or (
                node.kind == "matrix_question"
                and any(r.required for r in node.data.rows)
                and not node.data.allow_skip
            )
            or (
                node.kind == "embedded_method"
                and any(
                    source == str(node.id) and required for _, source, required in catalog.values()
                )
            )
        )
        verdict = constant_result(node.guard, flow.languages)
        if not paths:
            error(
                node,
                "unreachable_node",
                "No structural execution path reaches this node",
                "title",
                "warning",
            )
        elif verdict is False:
            error(
                node,
                "contradictory_guard",
                "This guard is provably false; review the intended omission",
                "guard",
                "warning",
            )
        if paths:
            if node.kind != "end" and verdict is not False:
                if i + 1 >= len(entries):
                    error(
                        node,
                        "missing_end",
                        "Every execution path must reach an explicit end",
                        "data",
                    )
                else:
                    incoming.setdefault(i + 1, []).append((after, after_review))
            if node.guard and verdict is not True:
                target = omission_target(i, node, loop_id)
                if target > i and target < len(entries):
                    incoming.setdefault(target, []).append((before, reviewed))
                else:
                    error(
                        node,
                        "missing_end",
                        "Guard-false path must reach an explicit end",
                        "otherwise",
                    )
    if not any(n.kind == "end" for n, _, _ in entries):
        error(entries[0][0], "missing_end", "Add an explicit end", "nodes")
    return issues


def evaluate_condition(condition, variables):
    """Pure predicate parity vectors; undefined includes missing/skipped values."""
    if isinstance(condition, All):
        return all(evaluate_condition(c, variables) for c in condition.all)
    if isinstance(condition, AnyCondition):
        return any(evaluate_condition(c, variables) for c in condition.any)
    if isinstance(condition, Defined):
        return condition.variable in variables
    if condition.variable not in variables:
        return False
    actual, expected = variables[condition.variable], condition.value
    op = condition.operator

    def equal(a, b):
        if isinstance(a, list) and isinstance(b, list):
            return all(any(equal(v, w) for w in b) for v in a) and all(
                any(equal(w, v) for v in a) for w in b
            )
        return literal_type(a) == literal_type(b) and a == b

    if op in {"eq", "neq"}:
        return equal(actual, expected) if op == "eq" else not equal(actual, expected)
    if op in {"lt", "lte", "gt", "gte"}:
        if literal_type(actual) != "number" or literal_type(expected) != "number":
            return False
        return {
            "lt": actual < expected,
            "lte": actual <= expected,
            "gt": actual > expected,
            "gte": actual >= expected,
        }[op]
    if op == "in":
        return isinstance(expected, list) and any(equal(actual, v) for v in expected)
    if op == "contains":
        return isinstance(actual, list) and any(equal(v, expected) for v in actual)
    return (
        isinstance(actual, list)
        and isinstance(expected, list)
        and any(equal(v, w) for v in actual for w in expected)
    )
