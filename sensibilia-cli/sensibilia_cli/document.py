"""Portable authoring files, atomic local edits, and existing contract validation."""

import json
import os
import tempfile
from pathlib import Path
from types import SimpleNamespace
from typing import Literal
from urllib.parse import urlsplit
from uuid import UUID, uuid4

from pydantic import Field, model_validator

from .contracts.flow_semantics import semantic_issues
from .contracts.flow_text import text_issues
from .contracts.flows import DraftFlowV2, FlowV2
from .contracts.methods import CONFIGURATIONS, StrictModel


class AuthoringError(Exception):
    pass


class Test(StrictModel):
    id: UUID = Field(default_factory=uuid4)
    name: str = Field(min_length=1, max_length=250)
    test_type_id: str
    configuration: dict

    @model_validator(mode="after")
    def valid_configuration(self):
        if self.test_type_id not in CONFIGURATIONS:
            raise ValueError(f"Unknown sensory method: {self.test_type_id}")
        self.configuration = (
            CONFIGURATIONS[self.test_type_id]
            .model_validate(self.configuration)
            .model_dump(mode="json")
        )
        return self


class Sample(StrictModel):
    id: UUID = Field(default_factory=uuid4)
    code: str = Field(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9_-]+$")
    label: str = Field(min_length=1, max_length=250)
    ingredient_tags: list[str] | None = Field(default=None, max_length=100)

    @model_validator(mode="after")
    def tags(self):
        if self.ingredient_tags is not None and any(
            not tag.strip() or len(tag) > 100 for tag in self.ingredient_tags
        ):
            raise ValueError("Ingredient tags must contain 1 to 100 nonblank characters")
        return self


class Source(StrictModel):
    url: str
    study_id: UUID
    version_id: UUID
    revision_hash: str = Field(min_length=1)
    published_at: str | None = None

    @model_validator(mode="after")
    def safe_origin(self):
        parsed = urlsplit(self.url)
        if (
            parsed.scheme not in {"https", "http"}
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError("Server origin must be HTTP(S) without credentials, query or fragment")
        return self


class Document(StrictModel):
    format_version: Literal[1] = 1
    title: str = Field(min_length=1, max_length=250)
    description: str = Field(default="", max_length=10000)
    form: DraftFlowV2
    tests: list[Test] = Field(default_factory=list, max_length=100)
    samples: list[Sample] = Field(default_factory=list, max_length=50)
    source: Source | None = None

    @model_validator(mode="after")
    def unique_resources(self):
        for items, key in ((self.tests, "id"), (self.samples, "id"), (self.samples, "code")):
            values = [getattr(item, key) for item in items]
            if len(set(values)) != len(values):
                raise ValueError(f"Duplicate resource {key}")
        return self


def parse_json(text):
    def unique_pairs(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise AuthoringError(f"Duplicate JSON key: {key}")
            result[key] = value
        return result

    def invalid_constant(value):
        raise AuthoringError(f"Nonfinite JSON number: {value}")

    return json.loads(
        text,
        object_pairs_hook=unique_pairs,
        parse_constant=invalid_constant,
    )


def read_json(path):
    return parse_json(Path(path).read_text(encoding="utf-8-sig"))


def load(path):
    return Document.model_validate(read_json(path)).model_dump(mode="json")


def atomic_json(path, value, *, overwrite=True):
    path = Path(path)
    content = json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    # New documents use exclusive creation so a typo never overwrites another study.
    if not overwrite:
        with path.open("x", encoding="utf-8", newline="\n") as stream:
            stream.write(content)
        return
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def save(path, value, *, overwrite=True):
    validated = Document.model_validate(value).model_dump(mode="json")
    atomic_json(path, validated, overwrite=overwrite)
    return validated


def entries(nodes, prefix=()):
    for index, node in enumerate(nodes):
        number = (*prefix, index + 1)
        yield node, nodes, index, ".".join(map(str, number))
        if node["kind"] in {"group", "loop_samples"}:
            yield from entries(node["data"]["children"], number)


def select(document, selector):
    language = document["form"]["default_language"]
    matches = [
        entry
        for entry in entries(document["form"]["nodes"])
        if selector in (entry[0]["id"], entry[3], entry[0]["title"].get(language))
    ]
    if len(matches) != 1:
        raise AuthoringError(f"Block '{selector}' must match one title, outline number, or UUID")
    return matches[0]


def resource(document, collection, selector):
    matches = [
        item
        for item in document[collection]
        if selector in (item["id"], item.get("name"), item.get("code"))
    ]
    if len(matches) != 1:
        raise AuthoringError(f"'{selector}' must match one {collection} name, code, or UUID")
    return matches[0]


def children(document, parent):
    if parent is None:
        return document["form"]["nodes"]
    node = select(document, parent)[0]
    if node["kind"] not in {"group", "loop_samples"}:
        raise AuthoringError("The parent must be a group or sample loop")
    return node["data"]["children"]


def set_pointer(value, pointer, replacement):
    if not pointer.startswith("/"):
        raise AuthoringError("Use a JSON pointer starting with /, such as /data/prompt/en")
    parts = [part.replace("~1", "/").replace("~0", "~") for part in pointer[1:].split("/")]
    target = value
    try:
        for part in parts[:-1]:
            target = target[int(part)] if isinstance(target, list) else target[part]
        if isinstance(target, list):
            index = int(parts[-1])
            if index < 0:
                raise IndexError
            target[index] = replacement
        else:
            target[parts[-1]] = replacement
    except (KeyError, IndexError, ValueError, TypeError) as exc:
        raise AuthoringError(f"Invalid JSON pointer: {pointer}") from exc


def issues(document, *, complete=False):
    validated = Document.model_validate(document)
    flow = validated.form
    tests = [
        SimpleNamespace(id=str(t.id), test_type_id=t.test_type_id, configuration=t.configuration)
        for t in validated.tests
    ]
    result = []

    def add(code, message, path):
        result.append({"severity": "error", "code": code, "message": message, "path": path})

    sample_ids = {s.id for s in validated.samples}
    test_ids = {t.id for t in validated.tests}
    for node, _, _, _ in entries(document["form"]["nodes"]):
        data = node["data"]
        if "study_test_id" in data and data["study_test_id"] is not None:
            if UUID(data["study_test_id"]) not in test_ids:
                add("foreign_test", "Block refers to a missing sensory test", [node["id"]])
        if any(UUID(s) not in sample_ids for s in data.get("sample_ids", [])):
            add("foreign_sample", "Block refers to a missing sample", [node["id"]])
    for test in validated.tests:
        config = test.configuration
        refs = [*config.get("sample_ids", [])]
        refs.extend(
            config[key] for key in ("reference_sample_id", "expected_sample_id") if config.get(key)
        )
        if any(UUID(s) not in sample_ids for s in refs):
            add(
                "foreign_sample", "Sensory configuration refers to a missing sample", [str(test.id)]
            )
    if not complete:
        return result
    # Complete-text, scope, guard typing and graph rules come from the platform snapshot.
    from pydantic import ValidationError

    try:
        FlowV2.model_validate(document["form"])
    except ValidationError as exc:
        for error in exc.errors():
            add("incomplete_flow", error["msg"], list(error["loc"]))
    if not tests:
        add("empty_methods", "The server requires a registered sensory method", ["tests"])
    embedded = {
        UUID(n["data"]["study_test_id"])
        for n, _, _, _ in entries(document["form"]["nodes"])
        if n["kind"] == "embedded_method"
    }
    if embedded != test_ids:
        add("test_coverage", "Place every configured sensory test once in the flow", ["nodes"])
    result.extend(text_issues(flow, tests))
    result.extend(semantic_issues(flow, tests))
    for node, _, _, _ in entries(document["form"]["nodes"]):
        if node["kind"] == "loop_samples":
            for sample in validated.samples:
                if str(sample.id) in node["data"]["sample_ids"] and sample.ingredient_tags is None:
                    add(
                        "missing_ingredient_tags",
                        "Review this sample's ingredient tags",
                        [sample.code],
                    )
    return result


def require_references(document):
    errors = issues(document)
    if errors:
        raise AuthoringError("; ".join(issue["message"] for issue in errors))
