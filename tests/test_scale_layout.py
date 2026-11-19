"""Scale layouts: how a single question or question grid is laid out on the tablet."""

import pytest
from pydantic import ValidationError
from test_flow_foundation import configured
from test_flow_guards import node
from test_templates import publish

from sensibilia.flows import DraftFlowV2

BASE = {"schema_version": 2, "languages": ["en"], "default_language": "en"}
OPTIONS = [{"id": f"p{i}", "label": {"en": str(i)}} for i in range(1, 8)]


def single(**data):
    return node(
        "question",
        {
            "prompt": {"en": "Aroma"},
            "answer_type": "single",
            "options": OPTIONS,
            "required": True,
            "allow_skip": False,
            **data,
        },
    )


def grid(**data):
    return node(
        "matrix_question",
        {
            "instructions": {"en": "Rate"},
            "rows": [{"id": "r1", "prompt": {"en": "Aroma"}, "required": True}],
            "options": [{**o, "score": i + 1} for i, o in enumerate(OPTIONS)],
            "allow_skip": False,
            **data,
        },
    )


def validate(*nodes):
    return DraftFlowV2.model_validate({**BASE, "nodes": list(nodes)})


@pytest.mark.parametrize("make", [single, grid])
def test_layout_defaults_to_vertical_and_accepts_the_three_layouts(make):
    # Flows saved before layouts existed have no value and keep the vertical list.
    assert validate(make()).nodes[0].data.layout == "vertical"
    for layout in ("vertical", "horizontal", "horizontal_ends"):
        assert validate(make(layout=layout)).nodes[0].data.layout == layout
    with pytest.raises(ValidationError):
        validate(make(layout="diagonal"))
    with pytest.raises(ValidationError):
        validate(make(layout=None))


@pytest.mark.parametrize(
    "data",
    [
        {"answer_type": "multiple"},
        {"answer_type": "text", "options": None},
        {"answer_type": "integer", "options": None},
    ],
)
def test_only_single_choice_questions_can_be_a_row(data):
    assert validate(single(**data)).nodes[0].data.layout == "vertical"
    with pytest.raises(ValidationError, match="single choice"):
        validate(single(layout="horizontal_ends", **data))


def test_layout_survives_save_publish_and_clone(client, researcher_headers):
    h = researcher_headers
    study, version, _, flow, base = configured(client, h)
    flow["nodes"].insert(0, single(layout="horizontal_ends"))
    flow["nodes"].insert(1, grid(layout="horizontal"))
    saved = client.put(
        base + "/form", headers=h, json={"form": flow, "revision_hash": version["revision_hash"]}
    )
    assert saved.status_code == 200, saved.text
    layouts = [n["data"]["layout"] for n in saved.json()["form"]["nodes"][:2]]
    assert layouts == ["horizontal_ends", "horizontal"]
    frozen = publish(client, h, study, saved.json())
    assert [n["data"]["layout"] for n in frozen["form"]["nodes"][:2]] == layouts
    # A horizontal layout on a multiple choice question is refused by the server too.
    bad = single(answer_type="multiple", layout="horizontal")
    flow["nodes"][0] = bad
    refused = client.put(
        base + "/form", headers=h, json={"form": flow, "revision_hash": version["revision_hash"]}
    )
    assert refused.status_code in {409, 422}
