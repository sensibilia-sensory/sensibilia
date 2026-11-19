from sqlalchemy import text
from test_flow_foundation import DEFAULT_LABELS
from test_method_library import configuration

HEDONIC = {
    "test_type_id": "hedonic-9-v1",
    "configuration": {
        "instructions": "Taste the sample",
        "questions": [{"id": "liking", "prompt": "Overall liking", "required": True}],
        "scale_labels": DEFAULT_LABELS,
        "allow_skips": False,
    },
}
CATA = {"test_type_id": "cata-v1", "configuration": configuration("cata", [])}
CHEESES = [{"code": f"C{i}", "label": f"Cheese {i}"} for i in range(1, 5)]


def body(**changes):
    return {
        "title": "Cheese battery",
        "samples": CHEESES,
        "methods": [HEDONIC, CATA],
        **changes,
    }


def count(client, table):
    with client.app.state.engine.begin() as connection:
        return connection.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar()


def test_battery_becomes_a_loop_of_methods(client, researcher_headers):
    response = client.post("/studies/from-samples", headers=researcher_headers, json=body())
    assert response.status_code == 201, response.text
    study = response.json()
    version = client.get(
        f"/studies/{study['id']}/versions/{study['versions'][0]['id']}", headers=researcher_headers
    ).json()
    samples = client.get(
        f"/studies/{study['id']}/versions/{version['id']}/samples", headers=researcher_headers
    ).json()
    tests = client.get(
        f"/studies/{study['id']}/versions/{version['id']}/tests", headers=researcher_headers
    ).json()
    loop, end = version["form"]["nodes"]
    assert end["kind"] == "end"
    assert loop["kind"] == "loop_samples"
    by_code = {s["code"]: s["id"] for s in samples}
    assert loop["data"]["sample_ids"] == [by_code[c["code"]] for c in CHEESES]
    assert [c["data"]["sample_binding"] for c in loop["data"]["children"]] == ["current"] * 2
    assert [c["data"]["study_test_id"] for c in loop["data"]["children"]] == [
        t["id"] for t in tests
    ]
    assert [t["test_type_id"] for t in tests] == ["hedonic-9-v1", "cata-v1"]
    assert all(s["ingredient_tags"] is None for s in samples)
    check = client.get(
        f"/studies/{study['id']}/versions/{version['id']}/validation", headers=researcher_headers
    )
    assert check.status_code == 200, check.text
    assert {i["code"] for i in check.json()["issues"]} == {"missing_ingredient_tags"}


def test_failures_leave_nothing_behind(client, researcher_headers):
    bad_method = {
        "test_type_id": "cata-v1",
        "configuration": {**configuration("cata", []), "questions": []},
    }
    triangle = {"test_type_id": "triangle-v1", "configuration": configuration("triangle", [])}
    cases = [
        body(methods=[HEDONIC, bad_method]),
        body(methods=[triangle]),
        body(samples=[CHEESES[0], CHEESES[0]]),
        body(samples=CHEESES[:1]),
        body(methods=[]),
    ]
    for case in cases:
        response = client.post("/studies/from-samples", headers=researcher_headers, json=case)
        assert response.status_code == 422, response.text
    for table in ("studies", "study_versions", "samples", "study_tests"):
        assert count(client, table) == 0, table
