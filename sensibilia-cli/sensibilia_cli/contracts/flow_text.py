"""Reviewed assessor text, fixed method pointers and escaped display tokens."""

import re
from copy import deepcopy
from uuid import UUID

from pydantic import ValidationError

from .flow_semantics import outline
from .methods import CONFIGURATIONS

TEXT_FIELDS = {
    "title",
    "body",
    "prompt",
    "label",
    "instructions",
    "continue_label",
    "accept_label",
    "decline_label",
    "ack_label",
    "preparation",
}
TOKEN = re.compile(r"{{\s*([^{}]+?)\s*}}")


def method_fields(configuration):
    fields = {"/instructions": configuration.get("instructions", "")}
    fields.update(
        {
            f"/questions/{i}/prompt": q["prompt"]
            for i, q in enumerate(configuration.get("questions", []))
        }
    )
    fields.update(
        {
            f"/scale_labels/{i}": label
            for i, label in enumerate(configuration.get("scale_labels", []))
        }
    )
    fields.update(
        {
            f"/{key}": configuration[key]
            for key in ("descriptor_instructions", "ranking_instructions")
            if key in configuration
        }
    )
    fields.update(
        {
            f"/attributes/{i}/prompt": a["prompt"]
            for i, a in enumerate(configuration.get("attributes", []))
        }
    )
    if "start_instruction" in configuration:
        fields["/start_instruction"] = configuration["start_instruction"]
    return fields


def localized_configuration(configuration, overlays, language):
    result = deepcopy(configuration)
    for pointer in method_fields(configuration):
        if pointer in overlays and language in overlays[pointer]:
            parts = pointer.strip("/").split("/")
            target = result
            for part in parts[:-1]:
                target = target[int(part)] if isinstance(target, list) else target[part]
            key = int(parts[-1]) if isinstance(target, list) else parts[-1]
            target[key] = overlays[pointer][language]
    return result


def text_issues(flow, tests):
    issues = []
    entries = outline(flow.nodes)
    loops = {str(n.id) for n, _, _ in entries if n.kind == "loop_samples"}
    inventory = {t.id: t for t in tests}
    bindings = {
        str(n.data.study_test_id): (n, ancestors)
        for n, ancestors, _ in entries
        if n.kind == "embedded_method"
    }

    def issue(code, message, path, node=None, test=None):
        issues.append(
            {
                "severity": "error",
                "node_id": str(node.id) if node else None,
                "study_test_id": test,
                "path": path,
                "code": code,
                "message": message,
            }
        )

    def check(localized, path, node, in_loop, test=None):
        for language in flow.languages:
            value = localized.get(language, "")
            if not value.strip():
                issue(
                    "missing_translation",
                    f"Review nonblank {language} text",
                    [*path, language],
                    node,
                    test,
                )
            for token in TOKEN.findall(value) if flow.text_version == 1 else []:
                if token not in {"sample_code", "sample_position"}:
                    issue(
                        "unknown_token",
                        f"Unknown display token: {token}",
                        [*path, language],
                        node,
                        test,
                    )
                elif not in_loop:
                    issue(
                        "token_scope",
                        f"{token} requires sample scope",
                        [*path, language],
                        node,
                        test,
                    )
            if flow.text_version == 1 and (
                "{{" in TOKEN.sub("", value) or "}}" in TOKEN.sub("", value)
            ):
                issue("unknown_token", "Malformed display token", [*path, language], node, test)
        if set(localized) - set(flow.languages):
            issue("undeclared_language", "Text contains an undeclared language", path, node, test)

    def visit(value, path, node, in_loop):
        if isinstance(value, dict):
            for key, child in value.items():
                if key in TEXT_FIELDS:
                    check(child, [*path, key], node, in_loop)
                elif key != "children":
                    visit(child, [*path, key], node, in_loop)
        elif isinstance(value, list):
            for i, child in enumerate(value):
                visit(child, [*path, i], node, in_loop)

    for node, ancestors, _ in entries:
        in_loop = any(a in loops for a in ancestors)
        visit(node.model_dump(mode="json"), ["nodes", str(node.id)], node, in_loop)
    for test_id, test in inventory.items():
        node, ancestors = bindings.get(test_id, (None, ()))
        in_loop = any(a in loops for a in ancestors)
        overlays = flow.method_text.get(UUID(test_id), {})
        fields = method_fields(test.configuration)
        for pointer in overlays.keys() - fields.keys():
            issue(
                "invalid_pointer",
                "Only assessor text fields may be translated",
                ["method_text", test_id, pointer],
                node,
                test_id,
            )
        for pointer, default in fields.items():
            text = overlays.get(pointer, {flow.default_language: default})
            check(text, ["method_text", test_id, pointer], node, in_loop, test_id)
            if text.get(flow.default_language) != default:
                issue(
                    "default_overlay",
                    "Default-language text must match the method configuration",
                    ["method_text", test_id, pointer, flow.default_language],
                    node,
                    test_id,
                )
        for language in flow.languages:
            try:
                CONFIGURATIONS[test.test_type_id].model_validate(
                    localized_configuration(test.configuration, overlays, language)
                )
            except (KeyError, ValidationError) as exc:
                issue(
                    "invalid_method_translation",
                    str(exc),
                    ["method_text", test_id, language],
                    node,
                    test_id,
                )
    return issues
