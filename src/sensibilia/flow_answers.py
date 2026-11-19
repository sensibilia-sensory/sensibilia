"""Closed v2 collection values and node-specific validation."""

import hashlib
import re
from typing import Annotated, Literal

from pydantic import Field

from sensibilia.flows import Scalar
from sensibilia.forms import ContinueValue, SelectionValue
from sensibilia.methods import StrictModel


class Answered(StrictModel):
    state: Literal["answered"]
    value: Scalar | list[str]


class Omitted(StrictModel):
    state: Literal["missing", "skipped"]


class MatrixAnswer(StrictModel):
    state: Literal["matrix"]
    answers: dict[str, SelectionValue] = Field(max_length=100)


class CodeAnswer(StrictModel):
    state: Literal["code"]
    normalized_code: str = Field(max_length=100)
    code_hash: str = Field(pattern=r"^[a-f0-9]{64}$")


class DeliveryAnswer(StrictModel):
    state: Literal["delivery"]
    mode: Literal["served", "manual"]
    codes: list[str] = Field(min_length=1, max_length=50)
    reason: str = Field(max_length=500)
    elapsed_ms: int = Field(ge=0)
    clock_quality: Literal["monotonic", "wall_estimate"] = "wall_estimate"
    offline: bool


FlowAnswer = Annotated[
    Answered | Omitted | MatrixAnswer | CodeAnswer | ContinueValue | DeliveryAnswer,
    Field(discriminator="state"),
]


def normalized(value, normalization):
    value = value.strip()
    return (
        re.sub(r"[a-z]", lambda m: m[0].upper(), value)
        if normalization == "trim_upper_ascii"
        else value
    )


def validate_answer(node, value, variables):
    data, state = node.data, value["state"]
    valid = False
    if node.kind == "serve_gate":
        expected = variables.get("serving.codes", [variables.get("sample.code")])
        valid = (
            state == "delivery"
            and value["codes"] == expected
            and (
                value["mode"] != "manual"
                or (
                    bool(value["reason"].strip())
                    and value["elapsed_ms"] >= data.timeout_seconds * 1000
                )
            )
        )
    elif node.kind in {"info", "confirm"}:
        valid = state == "continued" and value["acknowledged"] is True
    elif node.kind == "consent":
        valid = state == "answered" and type(value["value"]) is bool
    elif node.kind == "code_entry" and state == "code":
        code = value["normalized_code"]
        digest = hashlib.sha256(code.encode()).hexdigest()
        matched = (
            code == normalized(variables.get("sample.code", ""), data.normalization)
            if data.source == "sample_code"
            else digest in variables.get("context.returning_code_hashes", [])
        )
        valid = (
            code == normalized(code, data.normalization)
            and digest == value["code_hash"]
            and (data.allow_unknown or (bool(code) and matched))
        )
    elif node.kind == "question":
        if state == "missing":
            valid = not data.required
        elif state == "skipped":
            valid = data.allow_skip
        elif state == "answered":
            answer = value["value"]
            if data.answer_type == "integer":
                valid = (
                    type(answer) is int
                    and (data.min is None or answer >= data.min)
                    and (data.max is None or answer <= data.max)
                )
            elif data.answer_type == "text":
                valid = (
                    isinstance(answer, str)
                    and (not data.required or bool(answer.strip()))
                    and len(answer) <= (data.max_length or 30000)
                )
            elif data.answer_type == "single":
                valid = isinstance(answer, str) and answer in {o.id for o in data.options}
            else:
                valid = (
                    isinstance(answer, list)
                    and len(set(answer)) == len(answer)
                    and (not data.required or bool(answer))
                    and set(answer) <= {o.id for o in data.options}
                    and not (
                        len(answer) > 1
                        and any(o.exclusive and o.id in answer for o in data.options)
                    )
                )
    elif node.kind == "matrix_question":
        if state == "missing":
            valid = all(not r.required for r in data.rows)
        elif state == "matrix":
            answers = value["answers"]
            valid = set(answers) <= {r.id for r in data.rows} and all(
                (not r.required)
                if r.id not in answers
                else data.allow_skip
                if answers[r.id]["state"] == "skipped"
                else answers[r.id]["option_id"] in {o.id for o in data.options}
                for r in data.rows
            )
    if not valid:
        raise ValueError("Answer does not match the configured node or required/skip policy")
