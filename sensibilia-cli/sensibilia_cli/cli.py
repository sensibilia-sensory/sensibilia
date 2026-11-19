"""Command-line editing of the existing Session flow contract."""

import argparse
import json
import os
import shlex
import subprocess
import sys
import tempfile
from pathlib import Path
from uuid import uuid4

from pydantic import ValidationError

from . import __version__
from .contracts.methods import CONFIGURATIONS, METHOD_INFO
from .document import (
    AuthoringError,
    atomic_json,
    children,
    entries,
    issues,
    load,
    read_json,
    resource,
    save,
    select,
    set_pointer,
)
from .server import Client, create, detached, fetch, prepare, push, version_path

KINDS = (
    "info",
    "consent",
    "question",
    "matrix_question",
    "embedded_method",
    "group",
    "loop_samples",
    "confirm",
    "code_entry",
    "serve_gate",
    "end",
)
LABELS = {
    "info": "Instructions",
    "consent": "Consent",
    "question": "Question",
    "matrix_question": "Question battery",
    "embedded_method": "Sensory test",
    "group": "Group",
    "loop_samples": "Sample loop",
    "confirm": "Acknowledgment",
    "code_entry": "Enter code",
    "serve_gate": "Wait for sample",
    "end": "End",
}


def json_value(value):
    def nonfinite(_):
        raise ValueError("Nonfinite JSON numbers are not accepted")

    try:
        return json.loads(value, parse_constant=nonfinite)
    except ValueError as exc:
        raise AuthoringError(
            "Value must be JSON: quote strings, use true/false/null or a number"
        ) from exc


def node_data(args, document):
    language = document["form"]["default_language"]

    def text(value):
        return {language: value or ""}

    if args.data:
        return read_json(args.data)
    if args.kind == "info":
        return {"body": text(args.body), "continue_label": text("Continue")}
    if args.kind == "consent":
        return {
            "body": text(args.body),
            "accept_label": text("I agree"),
            "decline_label": text("I do not agree"),
        }
    if args.kind == "question":
        result = {
            "prompt": text(args.prompt),
            "answer_type": args.answer_type,
            "required": not args.optional,
            "allow_skip": args.allow_skip,
        }
        if args.answer_type in {"single", "multiple"}:
            options = []
            for option in args.option:
                key, sep, label = option.partition("=")
                if not sep or not key or not label:
                    raise AuthoringError("Use --option code=Label (at least two choices)")
                options.append(
                    {"id": key, "label": text(label), "exclusive": key in args.exclusive}
                )
            if set(args.exclusive) - {o["id"] for o in options}:
                raise AuthoringError("Exclusive codes must match an option")
            result["options"] = options
        elif args.option or args.exclusive:
            raise AuthoringError("Options apply only to single or multiple choice")
        if args.minimum is not None:
            result["min"] = args.minimum
        if args.maximum is not None:
            result["max"] = args.maximum
        if args.max_length is not None:
            result["max_length"] = args.max_length
        return result
    if args.kind == "embedded_method":
        if not args.test:
            raise AuthoringError("Choose a configured sensory test with --test NAME")
        test = resource(document, "tests", args.test)
        in_loop = False
        if args.parent:
            parent = select(document, args.parent)[0]
            loop_ids = {
                n["id"]
                for n, _, _, _ in entries(document["form"]["nodes"])
                if n["kind"] == "loop_samples"
            }
            for node, _, _, _ in entries(document["form"]["nodes"]):
                if node["id"] in loop_ids and any(
                    n["id"] == parent["id"] for n, _, _, _ in entries(node["data"]["children"])
                ):
                    in_loop = True
            in_loop |= parent["kind"] == "loop_samples"
        set_method = test["test_type_id"] in {
            "triangle-v1",
            "duo-trio-v1",
            "two-afc-v1",
            "flash-profile-v1",
            "napping-v1",
        }
        return {
            "study_test_id": test["id"],
            "sample_binding": args.binding
            or ("current" if in_loop else "set" if set_method else "none"),
        }
    if args.kind == "group":
        return {"children": []}
    if args.kind == "loop_samples":
        return {
            "sample_ids": [resource(document, "samples", s)["id"] for s in args.sample],
            "children": [],
        }
    if args.kind == "confirm":
        return {"body": text(args.body), "ack_label": text("I confirm")}
    if args.kind == "code_entry":
        return {
            "prompt": text(args.prompt),
            "source": "sample_code",
            "allow_unknown": False,
            "normalization": "trim_exact",
        }
    if args.kind == "serve_gate":
        return {
            "body": text(args.body),
            "preparation": text(args.preparation),
            "sample_binding": args.binding or "current",
        }
    if args.kind == "end":
        return {"body": text(args.body), "outcome": args.outcome}
    raise AuthoringError("Question batteries require --data with rows and response options")


def outline(document, details=False):
    language = document["form"]["default_language"]
    print(document["title"])
    print(f"{'Step':<9} {'Type':<20} Title")
    for node, _, _, number in entries(document["form"]["nodes"]):
        print(f"{number:<9} {LABELS[node['kind']]:<20} {node['title'].get(language, '')}")
        if details:
            print(f"          ID: {node['id']}")
    if document["tests"]:
        print("\nSensory tests")
        for test in document["tests"]:
            print(f"  {test['name']} ({test['test_type_id']})")
            if details:
                print(f"    ID: {test['id']}")
    if document["samples"]:
        print("\nSamples (researcher labels)")
        for sample in document["samples"]:
            tags = (
                "unreviewed"
                if sample["ingredient_tags"] is None
                else ", ".join(sample["ingredient_tags"]) or "none"
            )
            print(f"  {sample['code']}: {sample['label']} [ingredients: {tags}]")
            if details:
                print(f"    ID: {sample['id']}")
    source = document["source"]
    if source:
        print(
            "\nPublished copy (read-only on server)"
            if source["published_at"]
            else "\nLoaded server draft"
        )
        if details:
            print(json.dumps(source, indent=2))
    print("\nNext: check --complete, then push (or create for a new local study).")


def editor(filename, document, command):
    command = command or os.environ.get("VISUAL") or os.environ.get("EDITOR")
    if not command:
        command = "notepad.exe" if os.name == "nt" else "vi"
    with tempfile.TemporaryDirectory(prefix="sensibilia-edit-") as folder:
        temporary = Path(folder) / "study.json"
        save(temporary, document)
        try:
            arguments = shlex.split(command, posix=os.name != "nt")
            if os.name == "nt":
                arguments = [
                    part[1:-1]
                    if len(part) >= 2 and part[0] == part[-1] and part[0] in "\"'"
                    else part
                    for part in arguments
                ]
            subprocess.run([*arguments, str(temporary)], check=True)
            return save(filename, read_json(temporary))
        except (ValidationError, ValueError, AuthoringError, subprocess.CalledProcessError):
            recovery = Path(filename).with_name(Path(filename).name + ".rejected.json")
            recovery.write_bytes(temporary.read_bytes())
            print(f"Edited text retained in {recovery}; original file preserved.", file=sys.stderr)
            raise


def parser():
    root = argparse.ArgumentParser(
        prog="sensibilia-flow",
        description="Author Sensibilia Session flows locally or through its researcher API.",
    )
    root.add_argument("--version", action="version", version=__version__)
    commands = root.add_subparsers(dest="command", required=True)
    tui = commands.add_parser("tui", help="Open the optional terminal flow workbench")
    tui.add_argument("file", nargs="?")
    tui.add_argument(
        "--no-install", action="store_true", help="Refuse first-run TUI dependency installation"
    )
    new = commands.add_parser("new", help="Create a local, empty study")
    new.add_argument("file")
    new.add_argument("--title", required=True)
    new.add_argument("--description", default="")
    new.add_argument("--language", default="en")

    for name, help_text in (
        ("show", "Print the ordered flow"),
        ("check", "Validate references, or a complete flow"),
        ("edit", "Edit the portable JSON in your text editor"),
        ("export", "Export a raw Flow v2 or a form-update request"),
        ("copy", "Copy to a new, detached local study"),
    ):
        sub = commands.add_parser(name, help=help_text)
        sub.add_argument("file")
        if name == "show":
            sub.add_argument("--details", action="store_true")
            sub.add_argument("--json", action="store_true")
        elif name == "check":
            sub.add_argument("--complete", action="store_true")
            sub.add_argument("--json", action="store_true")
        elif name == "edit":
            sub.add_argument("--editor")
        else:
            sub.add_argument("output")
            if name == "export":
                sub.add_argument("--request", action="store_true")

    add = commands.add_parser("add", help="Insert a questionnaire or flow block")
    add.add_argument("file")
    add.add_argument("kind", choices=KINDS)
    add.add_argument("--title", required=True)
    add.add_argument("--parent", help="Parent group or sample loop, by title or outline number")
    add.add_argument("--before", help="Insert before this sibling; otherwise append")
    add.add_argument("--data", help="JSON file containing the existing node data contract")
    add.add_argument("--body")
    add.add_argument("--prompt")
    add.add_argument(
        "--answer-type", choices=("single", "multiple", "text", "integer"), default="single"
    )
    add.add_argument("--option", action="append", default=[], metavar="CODE=LABEL")
    add.add_argument("--exclusive", action="append", default=[], metavar="CODE")
    add.add_argument("--optional", action="store_true")
    add.add_argument("--allow-skip", action="store_true")
    add.add_argument("--min", dest="minimum", type=int)
    add.add_argument("--max", dest="maximum", type=int)
    add.add_argument("--max-length", type=int)
    add.add_argument("--sample", action="append", default=[], help="Sample code (repeatable)")
    add.add_argument("--test", help="Name of a configured sensory test")
    add.add_argument("--binding", choices=("none", "current", "set"))
    add.add_argument("--preparation")
    add.add_argument("--outcome", choices=("completed", "screened_out"), default="completed")

    for name in ("set", "remove", "move"):
        sub = commands.add_parser(
            name,
            help={
                "set": "Set a JSON field",
                "remove": "Remove a local block",
                "move": "Move a local block",
            }[name],
        )
        sub.add_argument("file")
        sub.add_argument(
            "block", help="Title, outline number or UUID; use study for document fields"
        )
        if name == "set":
            sub.add_argument("pointer", help="JSON pointer, e.g. /data/prompt/en")
            value = sub.add_mutually_exclusive_group(required=True)
            value.add_argument("--value", help="JSON value")
            value.add_argument("--text", help="Literal text value (no JSON quoting)")
            value.add_argument("--from-file", help="JSON value read from a file")
        elif name == "move":
            sub.add_argument("--parent")
            sub.add_argument("--before")

    tests = commands.add_parser(
        "test", help="List, add, edit or remove local sensory configurations"
    )
    tests.add_argument("file")
    tests.add_argument("action", choices=("list", "add", "replace", "remove"))
    tests.add_argument("--name")
    tests.add_argument("--type", dest="method", choices=sorted(CONFIGURATIONS))
    tests.add_argument("--config")
    samples = commands.add_parser("sample", help="List or add local sample definitions")
    samples.add_argument("file")
    samples.add_argument("action", choices=("list", "add"))
    samples.add_argument("--code")
    samples.add_argument("--label")
    samples.add_argument("--tag", action="append", default=None)
    samples.add_argument(
        "--no-ingredients", action="store_true", help="Explicitly reviewed empty ingredient list"
    )
    commands.add_parser("methods", help="List bundled registered sensory methods")

    for name, help_text in (
        ("studies", "Browse server studies"),
        ("pull", "Load a server draft or publication"),
        ("push", "Atomically save flow, wording and existing tests"),
        ("prepare", "Create new server samples/tests with local checkpoints"),
        ("create", "Create a server study, prepare resources and save the flow"),
        ("draft", "Clone a server publication into a new draft and load it"),
        ("server-check", "Request the authoritative server validation report"),
    ):
        sub = commands.add_parser(name, help=help_text)
        if name != "studies":
            sub.add_argument("file")
        sub.add_argument("--url", help="Server base URL; defaults to file origin or SENSIBILIA_URL")
        sub.add_argument(
            "--allow-http", action="store_true", help="Allow an unencrypted network server"
        )
        if name in {"pull", "draft"}:
            sub.add_argument("--study", required=True, help="Study UUID from studies --details")
        if name == "pull":
            sub.add_argument("--version-id", help="Omit to select the draft, or latest publication")
        if name == "studies":
            sub.add_argument("--search", default="")
            sub.add_argument("--details", action="store_true")
    return root


def server_command(args):
    document = (
        load(args.file) if args.command in {"push", "prepare", "create", "server-check"} else None
    )
    origin = document["source"]["url"] if document and document["source"] else None
    url = args.url or origin or os.environ.get("SENSIBILIA_URL", "http://127.0.0.1:8000")
    # Refuse a local overwrite before creating a draft or doing network work.
    if args.command in {"pull", "draft"} and Path(args.file).exists():
        raise AuthoringError("Output file already exists; choose a new filename")
    client = Client(url, allow_http=args.allow_http)
    if args.command == "studies":
        from urllib.parse import urlencode

        offset = 0
        while True:
            rows = client.request(
                "GET",
                "/studies?" + urlencode({"search": args.search, "limit": 100, "offset": offset}),
            )
            for study in rows:
                print(f"{study['title']} [{study['status']}]")
                if args.details:
                    print(f"  Study: {study['id']}")
                    for version in study["versions"]:
                        status = "Published" if version["published_at"] else "Draft"
                        print(f"  {status}: {version['id']}")
            if len(rows) < 100:
                break
            offset += len(rows)
    elif args.command == "pull":
        save(args.file, fetch(client, args.study, args.version_id), overwrite=False)
        print(f"Loaded {args.file}")
    elif args.command == "draft":
        from uuid import UUID

        result = client.request(
            "POST", f"/studies/{UUID(args.study)}/drafts", {"convert_legacy_flow": True}
        )
        save(args.file, fetch(client, args.study, result["id"]), overwrite=False)
        print(f"Created and loaded a new draft in {args.file}")
    elif args.command == "server-check":
        if not document["source"] or document["source"]["url"] != client.url:
            raise AuthoringError("Load a study from this server first")
        source = document["source"]
        report = client.request(
            "GET", version_path(source["study_id"], source["version_id"]) + "/validation"
        )
        print(json.dumps(report, indent=2, ensure_ascii=False))
        if report["revision_hash"] != source["revision_hash"]:
            print(
                "Report is for a different server revision; local edits are not checked.",
                file=sys.stderr,
            )
            return 1
        print(
            "Server report covers the saved server draft; unsaved local edits are excluded.",
            file=sys.stderr,
        )
        return 0 if report["valid"] else 1
    else:
        {"push": push, "prepare": prepare, "create": create}[args.command](client, args.file)
        print(
            "Resources prepared; use push to save the flow."
            if args.command == "prepare"
            else f"Saved {args.file} to the server draft."
        )
    return 0


def run(args):
    if args.command == "tui":
        from .tui_launcher import launch

        return launch(args.file, install=not args.no_install)
    if args.command in {"studies", "pull", "push", "prepare", "create", "draft", "server-check"}:
        return server_command(args)
    if args.command == "methods":
        for method in CONFIGURATIONS:
            name = (
                "Nine-point hedonic acceptance"
                if method == "hedonic-9-v1"
                else METHOD_INFO[method][1]
            )
            print(f"{method:<20} {name}")
        return 0
    if args.command == "new":
        save(
            args.file,
            {
                "title": args.title,
                "description": args.description,
                "form": {
                    "schema_version": 2,
                    "text_version": 1,
                    "languages": [args.language],
                    "default_language": args.language,
                    "nodes": [],
                },
            },
            overwrite=False,
        )
        print(f"Created {args.file}. Next: add questionnaire blocks and sensory tests.")
        return 0
    document = load(args.file)
    if args.command == "show":
        print(json.dumps(document, indent=2, ensure_ascii=False)) if args.json else outline(
            document, args.details
        )
        return 0
    if args.command == "check":
        report = issues(document, complete=args.complete)
        if args.json:
            print(
                json.dumps(
                    {"valid": not any(i["severity"] == "error" for i in report), "issues": report},
                    indent=2,
                )
            )
        else:
            for issue in report:
                path = "/".join(map(str, issue["path"]))
                print(f"{issue['severity']}: {issue['code']}: {issue['message']} ({path})")
            if not report:
                print(
                    "Local checks passed. Server validation is required before publication."
                    if args.complete
                    else "Draft structure and references passed; "
                    "use check --complete for text and routing checks."
                )
        return 1 if any(i["severity"] == "error" for i in report) else 0
    if args.command == "export":
        result = document["form"]
        if args.request:
            result = {
                "form": result,
                "revision_hash": document["source"]["revision_hash"]
                if document["source"]
                else None,
            }
        if Path(args.output).resolve() == Path(args.file).resolve():
            raise AuthoringError("Export must use a different output file")
        atomic_json(args.output, result, overwrite=False)
        return 0
    if args.command == "copy":
        save(args.output, detached(document), overwrite=False)
        return 0
    if args.command == "edit":
        editor(args.file, document, args.editor)
        return 0
    if args.command == "add":
        target = children(document, args.parent)
        node = {
            "id": str(uuid4()),
            "kind": args.kind,
            "title": {document["form"]["default_language"]: args.title},
            "data": node_data(args, document),
        }
        index = len(target)
        if args.before:
            _, siblings, index, _ = select(document, args.before)
            if siblings is not target:
                raise AuthoringError("--before must name a sibling in the chosen parent")
        target.insert(index, node)
    elif args.command == "set":
        value = (
            args.text
            if args.text is not None
            else read_json(args.from_file)
            if args.from_file
            else json_value(args.value)
        )
        target = document if args.block == "study" else select(document, args.block)[0]
        if args.block == "study" and args.pointer.startswith("/source"):
            raise AuthoringError("Server origin and revision metadata are managed by pull and push")
        set_pointer(target, args.pointer, value)
    elif args.command == "remove":
        _, siblings, index, _ = select(document, args.block)
        siblings.pop(index)
    elif args.command == "move":
        node, siblings, index, _ = select(document, args.block)
        target = children(document, args.parent)
        if target is node.get("data", {}).get("children") or any(
            target is n.get("data", {}).get("children")
            for n, _, _, _ in entries(node.get("data", {}).get("children", []))
        ):
            raise AuthoringError("A block cannot move inside itself or one of its descendants")
        before = select(document, args.before)[0] if args.before else None
        if before is node:
            raise AuthoringError("A block cannot move before itself")
        if before is not None and before not in target:
            raise AuthoringError("--before must name a sibling in the chosen parent")
        siblings.pop(index)
        target.insert(target.index(before) if before else len(target), node)
    elif args.command == "test":
        if args.action == "list":
            for test in document["tests"]:
                print(f"{test['name']} ({test['test_type_id']})")
            return 0
        if not args.name:
            raise AuthoringError("Use --name to select or name a sensory test")
        if args.action == "remove":
            document["tests"].remove(resource(document, "tests", args.name))
        else:
            if not args.config:
                raise AuthoringError("Use --config with a method configuration JSON file")
            if args.action == "add":
                if not args.method:
                    raise AuthoringError("Choose the registered method with --type")
                if any(t["name"] == args.name for t in document["tests"]):
                    raise AuthoringError("Choose a distinct sensory test name")
                document["tests"].append(
                    {
                        "id": str(uuid4()),
                        "name": args.name,
                        "test_type_id": args.method,
                        "configuration": read_json(args.config),
                    }
                )
            else:
                test = resource(document, "tests", args.name)
                test["configuration"] = read_json(args.config)
                if args.method:
                    test["test_type_id"] = args.method
    elif args.command == "sample":
        if args.action == "list":
            for sample in document["samples"]:
                print(f"{sample['code']}: {sample['label']}")
            return 0
        if not args.code or not args.label:
            raise AuthoringError("A sample needs --code and --label")
        if args.tag and args.no_ingredients:
            raise AuthoringError("Use either ingredient tags or explicitly reviewed no ingredients")
        document["samples"].append(
            {
                "id": str(uuid4()),
                "code": args.code,
                "label": args.label,
                "ingredient_tags": [] if args.no_ingredients else args.tag,
            }
        )
    save(args.file, document)
    print(f"Saved {args.file}")
    return 0


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        return run(args)
    except ValidationError as exc:
        print("Invalid authoring document (the invalid edit was not saved):", file=sys.stderr)
        for error in exc.errors():
            print(f"  {'/'.join(map(str, error['loc']))}: {error['msg']}", file=sys.stderr)
        return 2
    except (AuthoringError, OSError, ValueError, KeyError, TypeError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print(
            "Interrupted. Inspect the server before retrying an interrupted write.", file=sys.stderr
        )
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
