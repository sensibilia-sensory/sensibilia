"""Private JSON-lines adapter for the optional TUI; all validation stays in the CLI."""

import hashlib
import io
import json
import os
import sys
from contextlib import redirect_stderr, redirect_stdout
from copy import deepcopy
from pathlib import Path
from uuid import uuid4

from pydantic import ValidationError

from .cli import KINDS, LABELS, node_data, parser, run, server_command
from .contracts.flow_text import localized_configuration
from .contracts.methods import CONFIGURATIONS, HEDONIC_ID, METHOD_INFO
from .document import (
    AuthoringError,
    children,
    entries,
    issues,
    load,
    parse_json,
    resource,
    save,
    select,
    set_pointer,
)
from .method_forms import guided_configuration, method_form, normalize_configuration
from .server import Client, version_path

NAMES = {
    "body": "Text",
    "prompt": "Question",
    "continue_label": "Continue button",
    "accept_label": "Accept button",
    "decline_label": "Decline button",
    "ack_label": "Acknowledgment",
    "required": "Answer required",
    "allow_skip": "Allow a skip",
    "allow_skips": "Allow skips",
    "answer_type": "Answer format",
    "min": "Minimum",
    "max": "Maximum",
    "max_length": "Maximum characters",
    "exclusive": "Exclusive choice",
    "score": "Exported score",
    "sample_binding": "Samples used",
    "sample_ids": "Samples",
    "study_test_id": "Sensory test",
    "timeout_seconds": "Wait timeout (seconds)",
    "allow_unknown": "Accept unknown codes",
    "normalization": "Code matching",
    "preparation": "Staff preparation",
    "instructions": "Instructions",
    "outcome": "Outcome",
    "source": "Code source",
    "kind": "Method",
    "questions": "Question",
    "rows": "Statement",
    "options": "Choice",
    "scale_labels": "Scale label",
    "attributes": "Attribute",
    "ingredient_tags": "Reviewed ingredient tags",
    "code": "Blind code",
    "label": "Label",
    "name": "Name",
    "title": "Title",
    "description": "Description",
}
CHOICES = {
    "answer_type": {
        "single": "Single choice",
        "multiple": "Multiple choices",
        "text": "Free text",
        "integer": "Whole number",
    },
    "sample_binding": {
        "none": "No sample",
        "current": "Current sample in loop",
        "set": "Sample set",
    },
    "outcome": {"completed": "Completed", "screened_out": "Screened out"},
    "source": {"sample_code": "Current sample code", "returning_codes": "Returning assessor code"},
    "normalization": {
        "trim_exact": "Trim spaces; exact match",
        "trim_upper_ascii": "Trim; uppercase",
    },
}


def local_hash(filename):
    return hashlib.sha256(Path(filename).read_bytes()).hexdigest()


def target(document, selection):
    section = selection.get("section", "study")
    if section == "flow":
        return select(document, selection["id"])[0]
    if section in {"tests", "samples"}:
        return resource(document, section, selection["id"])
    return document


def describe(document, selection):
    section = selection.get("section", "study")
    value = target(document, selection)
    language = document["form"]["default_language"]
    fields, arrays, notes = [], [], []
    sample_options = [
        {"value": s["id"], "label": f"{s['code']} — {s['label']}"} for s in document["samples"]
    ]
    test_options = [{"value": t["id"], "label": t["name"]} for t in document["tests"]]

    def field(path, label, kind, current, options=None):
        fields.append(
            {"path": path, "label": label, "type": kind, "value": current, "options": options or []}
        )

    def visit(current, path, label, key=""):
        if key in {"id", "kind", "children", "asset_ids"}:
            return
        if section == "flow" and value["kind"] == "question":
            answer_type = value["data"]["answer_type"]
            if key in {"min", "max"} and answer_type != "integer":
                return
            if key == "max_length" and answer_type != "text":
                return
            if key == "options" and answer_type not in {"single", "multiple"}:
                return
            if key == "score" or (key == "exclusive" and answer_type != "multiple"):
                return
        if key == "sample_ids":
            field(path, label, "multi", current, sample_options)
        elif key in {"reference_sample_id", "expected_sample_id"}:
            field(
                path,
                label,
                "choice",
                current,
                [{"value": None, "label": "Choose sample"}, *sample_options],
            )
        elif key == "study_test_id":
            options = test_options
            if value.get("kind") == "serve_gate":
                options = [{"value": None, "label": "Explicit samples"}, *options]
            field(path, label, "choice", current, options)
        elif key in CHOICES:
            field(
                path,
                label,
                "choice",
                current,
                [{"value": v, "label": name} for v, name in CHOICES[key].items()],
            )
        elif isinstance(current, bool):
            field(
                path,
                label,
                "choice",
                current,
                [{"value": True, "label": "Yes"}, {"value": False, "label": "No"}],
            )
        elif isinstance(current, (int, float)) or key in {"min", "max", "max_length", "score"}:
            field(path, label, "number", current)
        elif isinstance(current, str):
            field(
                path,
                label,
                "multiline" if key in {"body", "instructions", "preparation"} else "text",
                current,
            )
        elif isinstance(current, dict):
            for child, item in current.items():
                child_label = (
                    f"{label} ({child})"
                    if child in document["form"]["languages"]
                    else NAMES.get(child, child.replace("_", " ").capitalize())
                )
                visit(item, f"{path}/{child}", child_label, child)
        elif isinstance(current, list) and key in {
            "questions",
            "rows",
            "options",
            "attributes",
            "scale_labels",
        }:
            arrays.append({"path": path, "label": NAMES.get(key, key), "count": len(current)})
            for index, item in enumerate(current):
                item_label = f"{NAMES.get(key, key)} {index + 1}"
                if isinstance(item, dict):
                    for child, content in item.items():
                        visit(
                            content,
                            f"{path}/{index}/{child}",
                            item_label
                            if child in {"label", "prompt"}
                            else f"{item_label} · {NAMES.get(child, child)}",
                            child,
                        )
                else:
                    visit(item, f"{path}/{index}", item_label, key)
        else:
            field(path, label, "json", current)

    if section == "flow":
        visit(value["title"], "/title", "Title")
        for key, item in value["data"].items():
            visit(item, f"/data/{key}", NAMES.get(key, key.replace("_", " ").capitalize()), key)
        title = value["title"].get(language, LABELS[value["kind"]])
        details = {"Block ID": value["id"], "Type": value["kind"]}
        advanced = {k: v for k, v in value.items() if k != "id"}
    elif section == "tests":
        field("/name", "Name", "text", value["name"])
        form = method_form(value["test_type_id"], value["configuration"], creation=False)
        fields.extend(form["fields"])
        arrays.extend(form["arrays"])
        notes.extend(form["notes"])
        title, details = value["name"], {"Test ID": value["id"], "Method": value["test_type_id"]}
        advanced = {k: v for k, v in value.items() if k != "id"}
    elif section == "samples":
        for key in ("code", "label", "ingredient_tags"):
            field(
                f"/{key}",
                "Private label" if key == "label" else NAMES[key],
                "json" if key == "ingredient_tags" else "text",
                value[key],
            )
        title, details = value["code"], {"Sample ID": value["id"]}
        advanced = {k: v for k, v in value.items() if k != "id"}
    else:
        field("/title", "Study title", "text", document["title"])
        field("/description", "Description", "multiline", document["description"])
        field("/form/languages", "Reviewed languages", "json", document["form"]["languages"])
        field(
            "/form/default_language",
            "Default language",
            "choice",
            language,
            [{"value": name, "label": name} for name in document["form"]["languages"]],
        )
        title, details = document["title"], document["source"] or {"Origin": "Local file"}
        advanced = {k: v for k, v in document.items() if k != "source"}
    return {
        "title": title,
        "fields": fields,
        "arrays": arrays,
        "details": details,
        "advanced": advanced,
        "preview": preview(document, selection),
        "notes": notes,
    }


def preview(document, selection):
    """Wording inventory, never a second assessor evaluator or an execution simulation."""
    value = target(document, selection)
    language = document["form"]["default_language"]
    section = selection.get("section", "study")
    if section == "flow" and value["kind"] == "embedded_method":
        test = resource(document, "tests", value["data"]["study_test_id"])
        return preview(document, {"section": "tests", "id": test["id"]})
    if section == "tests":
        config = localized_configuration(
            value["configuration"], document["form"]["method_text"].get(value["id"], {}), language
        )
        lines = [value["name"], "", config.get("instructions", "")]
        for key in (
            "question",
            "descriptor_instructions",
            "ranking_instructions",
            "start_instruction",
        ):
            if key in config:
                lines.extend(["", config[key]])
        for question in config.get("questions", config.get("attributes", [])):
            lines.extend(["", question["prompt"]])
        if "scale_labels" in config:
            lines.extend(
                [
                    "",
                    *[
                        f"{index + config.get('rating_min', 1)}. {label}"
                        for index, label in enumerate(config["scale_labels"])
                    ],
                ]
            )
        return "\n".join(lines)
    if section != "flow":
        return (
            document["description"]
            if section == "study"
            else f"Blind code: {value['code']}\n\nPrivate label: {value['label']}"
        )
    data = value["data"]
    lines = [value["title"].get(language, ""), ""]
    for key in ("body", "prompt", "instructions"):
        if key in data:
            lines.append(data[key].get(language, ""))
    for row in data.get("rows", []):
        lines.append(row["prompt"].get(language, ""))
    for option in data.get("options") or []:
        lines.append(f"[ ] {option['label'].get(language, '')}")
    for key in ("continue_label", "accept_label", "decline_label", "ack_label"):
        if key in data:
            lines.extend(["", f"[ {data[key].get(language, '')} ]"])
    if value["kind"] == "loop_samples":
        lines.append(
            "Repeats for: "
            + ", ".join(resource(document, "samples", s)["code"] for s in data["sample_ids"])
        )
    return "\n".join(lines)


def schema_example(schema, definitions):
    """Seed required editor fields from the existing configuration schema."""
    if "$ref" in schema:
        return schema_example(definitions[schema["$ref"].split("/")[-1]], definitions)
    if "default" in schema:
        return deepcopy(schema["default"])
    if "anyOf" in schema:
        return schema_example(schema["anyOf"][0], definitions)
    kind = schema.get("type")
    if kind == "object":
        return {
            key: schema_example(schema["properties"][key], definitions)
            for key in schema.get("required", [])
        }
    if kind == "array":
        return [
            schema_example(schema["items"], definitions) for _ in range(schema.get("minItems", 0))
        ]
    if "const" in schema:
        return schema["const"]
    if "enum" in schema:
        return schema["enum"][0]
    if kind in {"number", "integer"}:
        return schema.get("minimum", 0)
    if kind == "boolean":
        return True
    if schema.get("format") == "uuid":
        return ""
    return "" if kind == "string" else None


class Session:
    def __init__(self):
        self.history = {}
        self.history_hashes = {}

    def snapshot(self, filename, selection=None):
        document = load(filename)
        selection = selection or {"section": "study"}
        try:
            view = describe(document, selection)
        except AuthoringError:
            selection = {"section": "study"}
            view = describe(document, selection)
        return {
            "file": str(Path(filename).resolve()),
            "document": document,
            "hash": local_hash(filename),
            "selection": selection,
            "view": view,
            "canUndo": bool(self.history.get(str(Path(filename).resolve())))
            and self.history_hashes.get(str(Path(filename).resolve())) == local_hash(filename),
        }

    def dispatch(self, request):
        action = request["action"]
        if action == "catalog":
            return {
                "kinds": [{"value": kind, "label": LABELS[kind]} for kind in KINDS],
                "methods": [
                    {
                        "value": key,
                        "label": "Nine-point hedonic acceptance"
                        if key == HEDONIC_ID
                        else METHOD_INFO[key][1],
                    }
                    for key in CONFIGURATIONS
                ],
                "methodForms": {key: method_form(key) for key in CONFIGURATIONS},
            }
        if action == "method-template":
            schema = CONFIGURATIONS[request["method"]].model_json_schema()
            return schema_example(schema, schema.get("$defs", {}))
        filename = str(Path(request["file"]).resolve())
        selection = request.get("selection", {"section": "study"})
        if action == "read":
            return self.snapshot(filename, selection)
        if action == "new":
            save(
                filename,
                {
                    "title": request["title"],
                    "form": {
                        "schema_version": 2,
                        "text_version": 1,
                        "languages": [request.get("language", "en")],
                        "default_language": request.get("language", "en"),
                        "nodes": [],
                    },
                },
                overwrite=False,
            )
            return self.snapshot(filename)
        if action == "server-studies":
            client = self.client(request)
            from urllib.parse import urlencode

            rows = client.request(
                "GET", "/studies?" + urlencode({"search": request.get("search", ""), "limit": 1000})
            )
            return [{k: row[k] for k in ("id", "title", "status", "versions")} for row in rows]
        if action == "server-load":
            return self.server(request, filename)
        if local_hash(filename) != request.get("hash"):
            raise AuthoringError(
                "File changed outside this TUI. Open it again before applying edits."
            )
        if action == "check":
            return {"issues": issues(load(filename), complete=True)}
        if action == "file-export":
            operation = request["operation"]
            if operation not in {"copy", "export"}:
                raise AuthoringError("Choose copy or export")
            with redirect_stdout(io.StringIO()):
                run(parser().parse_args([operation, filename, request["output"]]))
            if operation == "copy":
                return self.snapshot(request["output"])
            return {"message": "Exported the raw flow to " + request["output"]}
        if action == "server":
            return self.server(request, filename)
        if action == "undo":
            if not self.history.get(filename) or self.history_hashes.get(filename) != local_hash(
                filename
            ):
                raise AuthoringError("Nothing to undo")
            previous = self.history[filename][-1]
            save(filename, previous)
            self.history[filename].pop()
            self.history_hashes[filename] = local_hash(filename)
            return self.snapshot(filename, selection)
        document = load(filename)
        before = deepcopy(document)
        if action == "apply":
            value = target(document, selection)
            previous_answer_type = value.get("data", {}).get("answer_type")
            changes = parse_json(request["raw"]) if "raw" in request else request["changes"]
            for pointer, replacement in changes.items():
                if pointer.startswith(("/id", "/source")):
                    raise AuthoringError("Stable identifiers and server origin are read-only")
                set_pointer(value, pointer, replacement)
            if (
                value.get("kind") == "question"
                and value["data"]["answer_type"] != previous_answer_type
            ):
                data = value["data"]
                answer_type = data["answer_type"]
                if answer_type not in {"single", "multiple"}:
                    data["options"] = None
                elif data.get("options") is None:
                    language = document["form"]["default_language"]
                    data["options"] = [
                        {"id": "option_" + uuid4().hex[:12], "label": {language: label}}
                        for label in ("First choice", "Second choice")
                    ]
                if answer_type == "single":
                    for option in data["options"]:
                        option["exclusive"] = False
                if answer_type != "integer":
                    data["min"] = data["max"] = None
                if answer_type != "text":
                    data["max_length"] = None
            if selection.get("section") == "tests":
                value["configuration"] = normalize_configuration(
                    value["test_type_id"], value["configuration"]
                )
        elif action == "advanced":
            value = target(document, selection)
            replacement = parse_json(request["raw"]) if "raw" in request else request["value"]
            protected = {k: value[k] for k in ("id", "source") if k in value}
            value.clear()
            value.update(replacement)
            value.update(protected)
        elif action == "add":
            selection = self.add(document, request)
        elif action == "remove":
            if selection["section"] == "flow":
                _, siblings, index, _ = select(document, selection["id"])
                siblings.pop(index)
            elif selection["section"] in {"tests", "samples"}:
                document[selection["section"]].remove(target(document, selection))
            else:
                raise AuthoringError("Select a block, test or sample to remove")
            selection = {"section": "study"}
        elif action == "move":
            self.move(document, selection["id"], request["direction"])
        elif action in {"array-add", "array-remove"}:
            value = target(document, selection)
            parts = request["pointer"].strip("/").split("/")
            array = value
            for part in parts:
                array = array[int(part)] if isinstance(array, list) else array[part]
            if action == "array-remove":
                array.pop(request["index"])
            else:
                code = "item_" + uuid4().hex[:12]
                language = document["form"]["default_language"]
                key = parts[-1]
                if key == "scale_labels":
                    item = "New label"
                elif key == "options":
                    item = {"id": code, "label": {language: "New choice"}}
                elif key == "rows":
                    item = {"id": code, "prompt": {language: "New statement"}, "required": True}
                else:
                    item = {"id": code, "prompt": "New question", "required": True}
                array.append(item)
        else:
            raise AuthoringError("Unsupported TUI action")
        save(filename, document)
        self.history.setdefault(filename, []).append(before)
        self.history[filename] = self.history[filename][-30:]
        self.history_hashes[filename] = local_hash(filename)
        return self.snapshot(filename, selection)

    def add(self, document, request):
        section = request.get("section", "flow")
        identifier = str(uuid4())
        if section == "samples":
            document[section].append(
                {
                    "id": identifier,
                    "code": request["code"],
                    "label": request["label"],
                    "ingredient_tags": request.get("tags"),
                }
            )
        elif section == "tests":
            document[section].append(
                {
                    "id": identifier,
                    "name": request["name"],
                    "test_type_id": request["method"],
                    "configuration": parse_json(request["configuration_raw"])
                    if "configuration_raw" in request
                    else guided_configuration(
                        request["method"], request["guided"], document["samples"]
                    )
                    if "guided" in request
                    else request["configuration"],
                }
            )
        else:
            kind = request["kind"]
            arguments = [
                "add",
                "unused.json",
                kind,
                "--title",
                request.get("title") or LABELS[kind],
            ]
            parent = request.get("parent")
            if parent:
                arguments.extend(["--parent", parent])
            if kind == "question":
                arguments.extend(
                    ["--option", "option_1=First choice", "--option", "option_2=Second choice"]
                )
            if kind == "embedded_method":
                if not document["tests"]:
                    raise AuthoringError("Add a sensory test in Tests first")
                arguments.extend(["--test", request.get("test") or document["tests"][0]["id"]])
            args = parser().parse_args(arguments)
            if kind == "matrix_question":
                language = document["form"]["default_language"]
                data = {
                    "instructions": {language: ""},
                    "allow_skip": False,
                    "rows": [{"id": "row_1", "prompt": {language: ""}, "required": True}],
                    "options": [
                        {"id": "option_1", "label": {language: "First choice"}},
                        {"id": "option_2", "label": {language: "Second choice"}},
                    ],
                }
            else:
                data = node_data(args, document)
            language = document["form"]["default_language"]
            node = {"id": identifier, "kind": kind, "title": {language: args.title}, "data": data}
            siblings = children(document, parent)
            after = request.get("after")
            index = len(siblings)
            if after:
                _, current_siblings, position, _ = select(document, after)
                if current_siblings is siblings:
                    index = position + 1
            siblings.insert(index, node)
        return {"section": section, "id": identifier}

    @staticmethod
    def move(document, identifier, direction):
        node, siblings, index, _ = select(document, identifier)
        if direction in {"up", "down"}:
            destination = index + (-1 if direction == "up" else 1)
            if not 0 <= destination < len(siblings):
                raise AuthoringError("Already at the edge of this group")
            siblings[index], siblings[destination] = siblings[destination], siblings[index]
        elif direction == "indent":
            if index == 0 or siblings[index - 1]["kind"] not in {"group", "loop_samples"}:
                raise AuthoringError("Move the block after a group or sample loop before indenting")
            siblings[index - 1]["data"]["children"].append(siblings.pop(index))
        elif direction == "outdent":
            parent = next(
                (
                    entry
                    for entry in entries(document["form"]["nodes"])
                    if entry[0]["data"].get("children") is siblings
                ),
                None,
            )
            if parent is None:
                raise AuthoringError("This block is already at the top level")
            parent[1].insert(parent[2] + 1, siblings.pop(index))
        else:
            raise AuthoringError("Unknown move direction")

    @staticmethod
    def client(request):
        if not os.environ.get("SENSIBILIA_RESEARCHER_TOKEN"):
            raise AuthoringError(
                "Set SENSIBILIA_RESEARCHER_TOKEN before launching the TUI. "
                "The key is never displayed or saved."
            )
        return Client(request["url"], allow_http=request.get("allowHttp", False))

    def server(self, request, filename):
        self.client(request)  # Avoid an invisible getpass prompt while the terminal is in raw mode.
        operation = request["operation"]
        if operation == "server-check":
            document = load(filename)
            source = document["source"]
            if not source or source["url"] != request["url"].rstrip("/"):
                raise AuthoringError("Load a draft from this server first")
            report = self.client(request).request(
                "GET", version_path(source["study_id"], source["version_id"]) + "/validation"
            )
            return {"report": report, "stale": report["revision_hash"] != source["revision_hash"]}
        if operation not in {"pull", "draft", "push", "prepare", "create"}:
            raise AuthoringError("Unsupported server operation")
        arguments = [operation, filename, "--url", request["url"]]
        if operation in {"pull", "draft"}:
            arguments.extend(["--study", request["study"]])
        if request.get("allowHttp"):
            arguments.append("--allow-http")
        output, errors = io.StringIO(), io.StringIO()
        with redirect_stdout(output), redirect_stderr(errors):
            server_command(parser().parse_args(arguments))
        self.history.pop(filename, None)
        self.history_hashes.pop(filename, None)
        result = self.snapshot(filename)
        result["message"] = output.getvalue().strip()
        return result


def main():
    session = Session()
    for line in sys.stdin:
        request = {}
        try:
            incoming = parse_json(line)
            if not isinstance(incoming, dict):
                raise AuthoringError("A TUI request must be a JSON object")
            request = incoming
            result = {"id": request.get("id"), "ok": True, "result": session.dispatch(request)}
        except ValidationError as exc:
            result = {
                "id": request.get("id"),
                "ok": False,
                "error": "\n".join(
                    f"{'/'.join(map(str, item['loc']))}: {item['msg']}" for item in exc.errors()
                ),
            }
        except (AuthoringError, OSError, ValueError, KeyError, TypeError, IndexError) as exc:
            result = {"id": request.get("id"), "ok": False, "error": str(exc)}
        print(json.dumps(result, ensure_ascii=False, allow_nan=False), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
