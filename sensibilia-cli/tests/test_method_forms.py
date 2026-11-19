import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from uuid import uuid4

from method_cases import METHODS, guided_values
from pydantic import ValidationError

from sensibilia_cli.contracts.methods import CONFIGURATIONS, DEFAULT_LABELS, JAR_LABELS
from sensibilia_cli.document import AuthoringError, load
from sensibilia_cli.method_forms import guided_configuration, method_form, method_seed
from sensibilia_cli.tui_backend import Session


class GuidedMethodTests(unittest.TestCase):
    def setUp(self):
        self.samples = [
            {
                "id": str(uuid4()),
                "code": str(code),
                "label": f"Product {code}",
                "ingredient_tags": [],
            }
            for code in (123, 456)
        ]

    def test_every_registered_method_has_guided_fields_and_valid_configuration(self):
        self.assertEqual(set(METHODS), set(CONFIGURATIONS))
        for method in METHODS:
            with self.subTest(method=method):
                form = method_form(method)
                self.assertTrue(form["fields"])
                self.assertFalse(any(field["type"] == "json" for field in form["fields"]))
                configuration = guided_configuration(
                    method, guided_values(method, self.samples), self.samples
                )
                CONFIGURATIONS[method].model_validate(configuration)
                schema = CONFIGURATIONS[method].model_json_schema()
                fixed = {key for key, value in schema["properties"].items() if "const" in value}
                offered = {field["path"].split("/")[-1] for field in form["fields"]}
                self.assertFalse(fixed & offered)
                for key in fixed:
                    self.assertEqual(configuration[key], schema["properties"][key]["const"])

    def test_defaults_are_the_contract_defaults_and_required_timing_is_explicit(self):
        self.assertEqual(method_seed("hedonic-9-v1")["scale_labels"], DEFAULT_LABELS)
        self.assertEqual(method_seed("jar-v1")["scale_labels"], JAR_LABELS)
        self.assertIsNone(method_seed("tcata-v1")["duration_ms"])
        self.assertIsNone(method_seed("tcata-v1")["required_tolerance_ms"])
        self.assertIsNone(method_seed("two-afc-v1")["expected_sample_id"])

    def test_rata_zero_unrated_and_jar_scale_lengths_stay_explicit(self):
        rata = guided_configuration("rata-v1", guided_values("rata-v1", self.samples), self.samples)
        self.assertEqual(rata["rating_min"], 0)
        self.assertFalse(rata["require_ratings"])
        for labels in (["Low"], [""] * 3):
            with self.subTest(labels=labels), self.assertRaises(ValidationError):
                guided_configuration(
                    "rata-v1",
                    {**guided_values("rata-v1", self.samples), "scale_labels": labels},
                    self.samples,
                )
        for count in (3, 5, 7):
            values = {
                **guided_values("jar-v1", self.samples),
                "scale_labels": [f"Category {i}" for i in range(count)],
            }
            self.assertEqual(
                len(guided_configuration("jar-v1", values, self.samples)["scale_labels"]), count
            )
        with self.assertRaises(ValidationError):
            guided_configuration(
                "jar-v1",
                {**guided_values("jar-v1", self.samples), "scale_labels": ["A", "B", "C", "D"]},
                self.samples,
            )

    def test_set_sample_limits_references_temporal_bounds_and_fixed_settings(self):
        for method in (
            "triangle-v1",
            "duo-trio-v1",
            "two-afc-v1",
            "flash-profile-v1",
            "napping-v1",
        ):
            with self.subTest(method=method), self.assertRaises(ValidationError):
                guided_configuration(
                    method,
                    {**guided_values(method, self.samples), "sample_ids": [self.samples[0]["id"]]},
                    self.samples,
                )
        for method, changes in (
            ("duo-trio-v1", {"reference_sample_id": str(uuid4())}),
            ("two-afc-v1", {"expected_sample_id": None}),
            ("tcata-v1", {"duration_ms": 999}),
            ("tcata-v1", {"required_tolerance_ms": 0}),
            ("flash-profile-v1", {"min_attributes": 30, "max_attributes": 2}),
        ):
            with self.subTest(method=method, changes=changes), self.assertRaises(ValidationError):
                guided_configuration(
                    method, {**guided_values(method, self.samples), **changes}, self.samples
                )
        with self.assertRaises(AuthoringError):
            guided_configuration(
                "napping-v1",
                {**guided_values("napping-v1", self.samples), "canvas_width": 100},
                self.samples,
            )
        with self.assertRaises(AuthoringError):
            guided_configuration(
                "cata-v1",
                {**guided_values("cata-v1", self.samples), "sample_ids": [str(uuid4())]},
                self.samples,
            )

    def test_guided_creation_and_editing_are_atomic_and_preserve_attribute_ids(self):
        with tempfile.TemporaryDirectory() as folder:
            filename = Path(folder) / "study.json"
            session = Session()
            snapshot = session.dispatch({"action": "new", "file": str(filename), "title": "Guided"})

            def request(action, **values):
                nonlocal snapshot
                snapshot = session.dispatch(
                    {
                        "action": action,
                        "file": str(filename),
                        "hash": snapshot["hash"],
                        "selection": snapshot["selection"],
                        **values,
                    }
                )
                return snapshot

            for sample in self.samples:
                request(
                    "add", section="samples", code=sample["code"], label=sample["label"], tags=[]
                )
            samples = snapshot["document"]["samples"]
            for method in METHODS:
                with self.subTest(method=method):
                    request(
                        "add",
                        section="tests",
                        method=method,
                        name=method,
                        guided=guided_values(method, samples),
                    )
                    original = deepcopy(snapshot["document"]["tests"][-1])
                    if method == "rata-v1":
                        self.assertIn("0. Low", snapshot["view"]["preview"])
                    if method == "two-afc-v1":
                        self.assertIn("Which sample is sweeter?", snapshot["view"]["preview"])
                    if method == "flash-profile-v1":
                        self.assertIn("Describe the differences.", snapshot["view"]["preview"])
                        self.assertIn("Rank by increasing intensity.", snapshot["view"]["preview"])
                    if method == "tcata-v1":
                        self.assertIn(
                            "Begin after the staff instruction.", snapshot["view"]["preview"]
                        )
                    request("apply", changes={"/configuration/instructions": "Edited instructions"})
                    edited = snapshot["document"]["tests"][-1]
                    self.assertEqual(edited["id"], original["id"])
                    for key in ("questions", "attributes"):
                        if key in original["configuration"]:
                            self.assertEqual(
                                edited["configuration"][key], original["configuration"][key]
                            )
            original_bytes = filename.read_bytes()
            with self.assertRaises(ValidationError):
                request("apply", changes={"/configuration/duration_ms": -1})
            self.assertEqual(filename.read_bytes(), original_bytes)
            self.assertEqual(len(load(filename)["tests"]), 10)


if __name__ == "__main__":
    unittest.main()
