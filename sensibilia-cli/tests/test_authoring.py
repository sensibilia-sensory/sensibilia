import io
import json
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

from sensibilia_cli.cli import main
from sensibilia_cli.document import load


class AuthoringTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.folder = Path(self.temporary.name)
        self.file = self.folder / "study.json"
        self.command("new", self.file, "--title", "Laboratory study")

    def command(self, *args, expected=0):
        output, errors = io.StringIO(), io.StringIO()
        with redirect_stdout(output), redirect_stderr(errors):
            code = main([str(arg) for arg in args])
        self.assertEqual(code, expected, errors.getvalue() + output.getvalue())
        return output.getvalue(), errors.getvalue()

    def test_create_edit_reorder_export_and_invalid_edit_preserves_file(self):
        self.command("add", self.file, "info", "--title", "Welcome", "--body", "Read this")
        self.command(
            "add",
            self.file,
            "question",
            "--title",
            "Age",
            "--prompt",
            "Age?",
            "--answer-type",
            "integer",
            "--min",
            0,
            "--max",
            120,
        )
        before = load(self.file)
        self.command("set", self.file, "Age", "/data/min", "--value", "2")
        self.command(
            "set", self.file, "Welcome", "/data/body/en", "--text", "Please read carefully"
        )
        self.command("move", self.file, "Age", "--before", "Welcome")
        after = load(self.file)
        self.assertEqual(after["form"]["nodes"][0]["id"], before["form"]["nodes"][1]["id"])
        unchanged = self.file.read_bytes()
        self.command("set", self.file, "Age", "/data/min", "--value", "999", expected=2)
        self.assertEqual(unchanged, self.file.read_bytes())
        self.command("export", self.file, self.folder / "flow.json")
        self.assertEqual(json.loads((self.folder / "flow.json").read_text()), after["form"])
        self.command("new", self.file, "--title", "Oops", expected=2)
        self.assertEqual(unchanged, self.file.read_bytes())

    def test_choices_zero_scores_missing_and_skipped_remain_distinct(self):
        self.command(
            "add",
            self.file,
            "question",
            "--title",
            "Restrictions",
            "--prompt",
            "Choose",
            "--answer-type",
            "multiple",
            "--option",
            "milk=Milk",
            "--option",
            "none=None",
            "--exclusive",
            "none",
            "--allow-skip",
        )
        self.command(
            "add",
            self.file,
            "question",
            "--title",
            "Count",
            "--prompt",
            "How many?",
            "--answer-type",
            "integer",
            "--min",
            0,
        )
        nodes = load(self.file)["form"]["nodes"]
        self.assertTrue(nodes[0]["data"]["allow_skip"])
        self.assertTrue(nodes[0]["data"]["options"][1]["exclusive"])
        self.assertEqual(nodes[1]["data"]["min"], 0)
        self.assertIsNone(nodes[1]["data"]["max"])
        self.command("set", self.file, "Count", "/data/min", "--value", "false", expected=2)

    def test_groups_loop_movement_cannot_create_cycle_or_invalid_binding(self):
        self.command(
            "sample",
            self.file,
            "add",
            "--code",
            "123",
            "--label",
            "Private product",
            "--no-ingredients",
        )
        self.command("add", self.file, "loop_samples", "--title", "Samples", "--sample", "123")
        self.command("add", self.file, "group", "--title", "Questions", "--parent", "Samples")
        self.command("add", self.file, "info", "--title", "Taste", "--parent", "Questions")
        unchanged = self.file.read_bytes()
        self.command("move", self.file, "Samples", "--parent", "Questions", expected=2)
        self.assertEqual(unchanged, self.file.read_bytes())
        self.command("move", self.file, "Taste")
        self.assertEqual(load(self.file)["form"]["nodes"][1]["title"], {"en": "Taste"})

    def test_dangling_guards_cannot_silently_change_after_removal(self):
        self.command(
            "add",
            self.file,
            "question",
            "--title",
            "Eligible",
            "--prompt",
            "Eligible?",
            "--option",
            "yes=Yes",
            "--option",
            "no=No",
        )
        self.command("add", self.file, "info", "--title", "Notice", "--body", "Proceed")
        source = load(self.file)["form"]["nodes"][0]["id"]
        guard = json.dumps({"variable": f"answer.{source}", "operator": "eq", "value": "yes"})
        self.command("set", self.file, "Notice", "/guard", "--value", guard)
        unchanged = self.file.read_bytes()
        self.command("remove", self.file, "Eligible", expected=2)
        self.assertEqual(unchanged, self.file.read_bytes())

    def test_registered_method_validation_and_complete_flow(self):
        config = self.folder / "hedonic.json"
        config.write_text(
            json.dumps(
                {
                    "instructions": "Rate the sample",
                    "questions": [
                        {"id": "liking", "prompt": "Overall liking", "required": True},
                    ],
                }
            )
        )
        self.command(
            "test",
            self.file,
            "add",
            "--name",
            "Liking",
            "--type",
            "hedonic-9-v1",
            "--config",
            config,
        )
        self.command(
            "add", self.file, "embedded_method", "--title", "Evaluation", "--test", "Liking"
        )
        self.command("add", self.file, "end", "--title", "Done", "--body", "Thank you")
        self.command("check", self.file, "--complete")
        self.command(
            "set",
            self.file,
            "Evaluation",
            "/guard",
            "--value",
            '{"variable":"sample.position","operator":"eq","value":1}',
        )
        output, _ = self.command("check", self.file, "--complete", "--json", expected=1)
        self.assertIn("sample_scope", output)
        config.write_text(
            json.dumps(
                {
                    "instructions": "Test",
                    "questions": [
                        {"id": "same", "prompt": "One"},
                        {"id": "same", "prompt": "Two"},
                    ],
                }
            )
        )
        unchanged = self.file.read_bytes()
        self.command(
            "test", self.file, "replace", "--name", "Liking", "--config", config, expected=2
        )
        self.assertEqual(unchanged, self.file.read_bytes())

    def test_matrix_scores_and_draft_vs_complete_validation(self):
        data = self.folder / "matrix.json"
        data.write_text(
            json.dumps(
                {
                    "instructions": {"en": "Choose a score"},
                    "allow_skip": True,
                    "rows": [{"id": "r1", "prompt": {"en": "Statement"}, "required": True}],
                    "options": [
                        {"id": "zero", "label": {"en": "Never"}, "score": 0},
                        {"id": "one", "label": {"en": "Sometimes"}, "score": 1},
                    ],
                }
            )
        )
        self.command("add", self.file, "matrix_question", "--title", "Battery", "--data", data)
        self.assertEqual(load(self.file)["form"]["nodes"][0]["data"]["options"][0]["score"], 0)
        self.command("check", self.file)
        self.command("check", self.file, "--complete", expected=1)

    def test_copy_remaps_resources_and_exports_preserve_original(self):
        self.command("sample", self.file, "add", "--code", "123", "--label", "Product")
        self.command("add", self.file, "loop_samples", "--title", "Samples", "--sample", "123")
        output = self.folder / "copy.json"
        original = load(self.file)
        self.command("copy", self.file, output)
        copied = load(output)
        self.assertNotEqual(original["samples"][0]["id"], copied["samples"][0]["id"])
        self.assertEqual(
            copied["samples"][0]["id"], copied["form"]["nodes"][0]["data"]["sample_ids"][0]
        )
        self.assertEqual(original, load(self.file))

    def test_duplicate_json_keys_and_nonfinite_values_rejected(self):
        self.file.write_text('{"title":"one","title":"two"}')
        self.command("show", self.file, expected=2)
        self.file.write_text('{"title":NaN}')
        self.command("show", self.file, expected=2)

    def test_external_editor_keeps_rejected_text_and_original_document(self):
        script = self.folder / "example editor.py"
        script.write_text(
            "from pathlib import Path\nimport sys\nPath(sys.argv[1]).write_text('invalid JSON')\n"
        )
        original = self.file.read_bytes()
        command = subprocess.list2cmdline([sys.executable, str(script)])
        self.command("edit", self.file, "--editor", command, expected=2)
        self.assertEqual(self.file.read_bytes(), original)
        self.assertEqual(
            self.file.with_name(self.file.name + ".rejected.json").read_text(), "invalid JSON"
        )


if __name__ == "__main__":
    unittest.main()
