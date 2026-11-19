"""Refresh API contracts; changes to a published method schema require a new version."""

import json
from pathlib import Path

from sensibilia.api import create_app
from sensibilia.flows import DraftFlowV2, FlowV2
from sensibilia.forms import StudyForm
from sensibilia.methods import CONFIGURATIONS, HedonicConfiguration

root = Path(__file__).resolve().parents[1]
contracts = root / "docs" / "contracts"
contracts.mkdir(parents=True, exist_ok=True)
schema = HedonicConfiguration.model_json_schema()
snapshot = root / "migrations" / "versions" / "hedonic_v1.json"
if snapshot.exists() and json.loads(snapshot.read_text(encoding="utf-8")) != schema:
    raise RuntimeError("Hedonic v1 schema changed; add a new method version and migration")
snapshot.write_text(json.dumps(schema, indent=2) + "\n", encoding="utf-8")
method_snapshot = root / "migrations" / "versions" / "methods_v1.json"
for method in json.loads(method_snapshot.read_text(encoding="utf-8")):
    if CONFIGURATIONS[method["id"]].model_json_schema() != method["configuration_schema"]:
        raise RuntimeError(f"Published {method['id']} schema changed; add a new method version")
form_schema = StudyForm.model_json_schema()
form_snapshot = root / "docs" / "contracts" / "form_v1.json"
if form_snapshot.exists() and json.loads(form_snapshot.read_text(encoding="utf-8")) != form_schema:
    raise RuntimeError("Form v1 schema changed; introduce a new form schema version")
form_snapshot.write_text(json.dumps(form_schema, indent=2) + "\n", encoding="utf-8")
(contracts / "openapi.json").write_text(
    json.dumps(create_app().openapi(), indent=2) + "\n", encoding="utf-8"
)

for name, model in (("flow_v2", FlowV2), ("draft_flow_v2", DraftFlowV2)):
    (contracts / f"{name}.json").write_text(
        json.dumps(model.model_json_schema(), indent=2)
        + "\
",
        encoding="utf-8",
    )
