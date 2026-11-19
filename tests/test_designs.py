from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from uuid import uuid4

import pytest
from sqlalchemy import text
from test_flow_guards import save
from test_sample_loop import loop_study

from sensibilia.designs import sequences


@pytest.mark.parametrize("n", [2, 3, 4, 5, 6, 7, 8])
def test_design_balance_and_seed(n):
    ids = [str(i) for i in range(n)]
    for algorithm in ("latin", "williams"):
        rows = sequences(ids, algorithm, 42, 24)
        assert rows == sequences(ids, algorithm, 42, 24)
        assert all(set(row) == set(ids) and len(row) == n for row in rows)
        for p in range(n):
            assert len(set(Counter(row[p] for row in rows).values())) == 1
        if algorithm == "williams":
            pairs = Counter((a, b) for row in rows for a, b in zip(row, row[1:], strict=False))
            assert len(pairs) == n * (n - 1)
            assert set(pairs.values()) == {2 if n % 2 else 1}
    shuffled = sequences(ids, "shuffle", 42, 24)
    assert shuffled == sequences(ids, "shuffle", 42, 24)
    assert shuffled != sequences(ids, "shuffle", 43, 24)
    assert sequences(ids, "fixed", 42, 24) == [ids]


def setup_design(client, h, algorithm="williams"):
    study, version, flow, base, samples = loop_study(client, h)
    review = save(client, h, base, flow)
    body = dict(
        revision_hash=review["revision_hash"],
        loop_id=flow["nodes"][1]["id"],
        algorithm=algorithm,
        seed=42,
        sequence_count=24,
        allocation_basis="provisioned",
        replacement_policy="retain_and_allocate_next",
        block="complete",
        replicates=1,
    )
    response = client.post(base + "/designs", headers=h, json=body)
    assert response.status_code == 200, response.text
    return study, version, flow, base, samples, response.json(), body


def release(client, h, study, version, base):
    review = client.get(base + "/validation", headers=h).json()
    assert review["valid"], review
    response = client.post(
        f"/studies/{study['id']}/publish",
        headers=h,
        json={"study_version_id": version["id"], "revision_hash": review["revision_hash"]},
    )
    assert response.status_code == 200, response.text


def test_edit_blinding_stale_foreign_delete_and_audit(client, researcher_headers):
    h = researcher_headers
    study, _, _, base, samples, _, body = setup_design(client, h)
    original = client.get(base, headers=h).json()
    url = base + "/samples/" + samples[0]["id"]
    payload = {k: samples[0][k] for k in ("code", "label", "ingredient_tags")}
    payload.update(label="Changed private label", revision_hash=original["revision_hash"])
    edited = client.put(url, headers=h, json=payload)
    assert edited.status_code == 200, edited.text
    assert client.put(url, headers=h, json=payload).status_code == 409
    payload["revision_hash"] = client.get(base, headers=h).json()["revision_hash"]
    assert client.put(base + "/samples/" + str(uuid4()), headers=h, json=payload).status_code == 404
    assert (
        client.delete(
            url, headers=h, params={"revision_hash": payload["revision_hash"]}
        ).status_code
        == 409
    )
    assert client.post(base + "/designs", headers=h, json=body).status_code == 409
    b = {"seed": 17, "revision_hash": payload["revision_hash"]}
    blinded = client.post(base + "/blinding", headers=h, json=b)
    assert blinded.status_code == 200, blinded.text
    codes = [s["code"] for s in blinded.json()]
    assert len(set(codes)) == 4 and all(100 <= int(c) <= 999 for c in codes)
    b["revision_hash"] = client.get(base, headers=h).json()["revision_hash"]
    assert client.post(base + "/blinding", headers=h, json=b).json() == blinded.json()
    audit = client.get(base + "/audit", headers=h).json()
    assert any(a["action"].endswith("/blinding") for a in audit)
    # Unreferenced samples can be removed, without erasing prior audited metadata.
    spare = client.post(
        f"/studies/{study['id']}/samples",
        headers=h,
        json={"code": "SPARE", "label": "Spare", "ingredient_tags": []},
    ).json()
    rev = client.get(base, headers=h).json()["revision_hash"]
    assert (
        client.delete(
            base + "/samples/" + spare["id"], headers=h, params={"revision_hash": rev}
        ).status_code
        == 204
    )


def test_allocation_concurrency_freeze_clone_private_and_export(client, researcher_headers):
    h = researcher_headers
    study, version, _, base, samples, design, body = setup_design(client, h)
    release(client, h, study, version, base)

    def provision(i):
        response = client.post(
            "/sessions",
            headers=h,
            json={"study_version_id": version["id"], "assessor_code": str(i)},
        )
        assert response.status_code == 201, response.text
        return response.json()

    with ThreadPoolExecutor(max_workers=4) as pool:
        sessions = list(pool.map(provision, range(8)))
    allocations = client.get(base + "/design-allocations", headers=h).json()
    assert [a["ordinal"] for a in allocations] == list(range(8))
    assert [a["sequence_index"] for a in allocations] == [i % 4 for i in range(8)]
    assert client.get(base + "/design-allocations").status_code == 401
    packages = []
    for session in sessions:
        credential = {"Authorization": "Bearer " + session["session_token"]}
        package = client.get(f"/sessions/{session['id']}/test", headers=credential).json()
        a = package["loop_assignments"][0]
        assert [s["sample_id"] for s in a["samples"]] == design["sequences"][a["sequence_index"]]
        assert a["design_seed"] == 42
        assert "Private product" not in str(package)
        packages.append(package)
    assert client.post(base + "/designs", headers=h, json=body).status_code == 409
    assert (
        client.post(
            base + "/blinding", headers=h, json={"seed": 42, "revision_hash": body["revision_hash"]}
        ).status_code
        == 409
    )
    clone = client.post(f"/studies/{study['id']}/drafts", headers=h).json()
    cloned_base = f"/studies/{study['id']}/versions/{clone['id']}"
    cloned = client.get(cloned_base + "/designs", headers=h).json()[0]
    assert cloned["id"] != design["id"]
    assert not set(cloned["settings"]["sample_ids"]) & {s["id"] for s in samples}
    assert client.get(cloned_base + "/design-allocations", headers=h).json() == []
    assert (
        client.get(
            f"/sessions/{sessions[0]['id']}/test",
            headers={"Authorization": "Bearer " + sessions[0]["session_token"]},
        ).json()
        == packages[0]
    )
    rows = client.get(f"/studies/{study['id']}/data", headers=h, params={"limit": 1000}).json()
    designed = [r for r in rows if r["design_id"]]
    assert designed and all(
        r["sample_position"] and r["serving_slot_id"] and r["design_seed"] == 42 for r in designed
    )
    csv = client.get(f"/studies/{study['id']}/export", headers=h).text
    assert "allocation_ordinal" in csv and design["id"] in csv
    with client.app.state.engine.begin() as connection:
        with pytest.raises(Exception, match="immutable"):
            connection.execute(
                text("UPDATE study_designs SET loop_id='bad' WHERE id=:id"), {"id": design["id"]}
            )
    with client.app.state.engine.begin() as connection:
        with pytest.raises(Exception, match="retained"):
            connection.execute(text("DELETE FROM design_allocations"))


def test_changed_loop_blocks_release_and_foreign_design(client, researcher_headers):
    h = researcher_headers
    _, _, flow, base, _, design, body = setup_design(client, h)
    body["revision_hash"] = client.get(base, headers=h).json()["revision_hash"]
    foreign = deepcopy(body)
    foreign["loop_id"] = str(uuid4())
    assert client.post(base + "/designs", headers=h, json=foreign).status_code == 422
    flow["nodes"][1]["data"]["sample_ids"].reverse()
    review = save(client, h, base, flow)
    assert "stale_design" in {i["code"] for i in review["issues"]}
    assert (
        client.delete(
            base + "/designs/" + design["id"],
            headers=h,
            params={"revision_hash": review["revision_hash"]},
        ).status_code
        == 204
    )
    assert client.get(base + "/validation", headers=h).json()["valid"]


@pytest.mark.parametrize(
    "field,value",
    [
        ("algorithm", "invented"),
        ("allocation_basis", "completed"),
        ("block", "invented"),
        ("replicates", 2),
        ("seed", -1),
    ],
)
def test_unsupported_design_conventions_are_closed(client, researcher_headers, field, value):
    _, _, _, base, _, _, body = setup_design(client, researcher_headers)
    body[field] = value
    assert client.post(base + "/designs", headers=researcher_headers, json=body).status_code == 422


@pytest.mark.parametrize("n,k", [(4, 2), (5, 3), (6, 3)])
def test_incomplete_block_incidence_positions_and_bounds(n, k):
    from itertools import combinations
    from math import comb

    ids = [str(i) for i in range(n)]
    rows = sequences(ids, "incomplete", 42, 24, k)
    assert len(rows) == comb(n, k) * k
    assert all(len(r) == len(set(r)) == k for r in rows)
    assert set(Counter(i for r in rows for i in r).values()) == {comb(n - 1, k - 1) * k}
    assert set(Counter(pair for r in rows for pair in combinations(sorted(r), 2)).values()) == {
        comb(n - 2, k - 2) * k
    }
    for p in range(k):
        assert set(Counter(r[p] for r in rows).values()) == {comb(n - 1, k - 1)}
    with pytest.raises(ValueError):
        sequences([str(i) for i in range(50)], "incomplete", 42, 24, 25)


def test_incomplete_frozen_subset_expected_slots_and_clone(client, researcher_headers):
    h = researcher_headers
    study, version, flow, base, samples, design, body = setup_design(client, h)
    body.update(
        algorithm="incomplete",
        block="incomplete",
        block_size=2,
        revision_hash=client.get(base, headers=h).json()["revision_hash"],
    )
    generated = client.post(base + "/designs", headers=h, json=body)
    assert generated.status_code == 200, generated.text
    design = generated.json()
    assert len(design["sequences"]) == 12
    release(client, h, study, version, base)
    session = client.post(
        "/sessions", headers=h, json={"study_version_id": version["id"], "assessor_code": "SUBSET"}
    ).json()
    credential = {"Authorization": "Bearer " + session["session_token"]}
    package = client.get(f"/sessions/{session['id']}/test", headers=credential).json()
    assigned = package["loop_assignments"][0]["samples"]
    assert [s["sample_id"] for s in assigned] == design["sequences"][0]
    assert len(assigned) == 2 and "Private product" not in str(package)
    rows = client.get(f"/studies/{study['id']}/data", headers=h).json()
    method_slots = [r for r in rows if r["row_kind"] == "expected_missing" and r["study_test_id"]]
    assert len(method_slots) == 2
    assert {r["sample_id_json"] for r in method_slots} == {
        '"' + s["sample_id"] + '"' for s in assigned
    }
    clone = client.post(f"/studies/{study['id']}/drafts", headers=h).json()
    copied = client.get(f"/studies/{study['id']}/versions/{clone['id']}/designs", headers=h).json()[
        0
    ]
    assert copied["settings"]["block_size"] == 2 and len(copied["sequences"]) == 12
