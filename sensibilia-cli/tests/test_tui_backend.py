import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from pydantic import ValidationError

from sensibilia_cli.document import AuthoringError, load
from sensibilia_cli.tui_backend import Session, main


class TuiBackendTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.file = Path(temporary.name) / "study.json"
        self.session = Session()
        self.snapshot = self.session.dispatch(
            {"action": "new", "file": str(self.file), "title": "Workbench"}
        )

    def action(self, action, **kwargs):
        result = self.session.dispatch(
            {
                "action": action,
                "file": str(self.file),
                "hash": self.snapshot["hash"],
                "selection": self.snapshot["selection"],
                **kwargs,
            }
        )
        if "document" in result:
            self.snapshot = result
        return result

    def test_apply_is_atomic_preserves_ids_and_undo_is_checked(self):
        self.action("add", section="flow", kind="question", title="Frequency")
        identifier = self.snapshot["selection"]["id"]
        original = self.file.read_bytes()
        with self.assertRaises(ValidationError):
            self.action(
                "apply", changes={"/title/en": "Must not persist", "/data/answer_type": "unknown"}
            )
        self.assertEqual(self.file.read_bytes(), original)
        self.action("apply", changes={"/title/en": "Edited", "/data/prompt/en": "How often?"})
        self.assertEqual(self.snapshot["selection"]["id"], identifier)
        self.assertEqual(load(self.file)["form"]["nodes"][0]["title"], {"en": "Edited"})
        self.action("undo")
        self.assertEqual(self.file.read_bytes(), original)
        self.file.write_text(self.file.read_text().replace("Frequency", "Changed elsewhere"))
        with self.assertRaisesRegex(AuthoringError, "outside this TUI"):
            self.action("apply", changes={"/title/en": "Overwrites colleague"})

    def test_question_format_changes_preserve_prompt_and_clear_inapplicable_fields(self):
        self.action("add", section="flow", kind="question", title="Count")
        self.action(
            "apply",
            changes={"/data/answer_type": "integer", "/data/prompt/en": "Count?", "/data/min": 0},
        )
        node = load(self.file)["form"]["nodes"][0]
        self.assertEqual(node["data"]["min"], 0)
        self.assertIsNone(node["data"]["options"])
        self.action("apply", changes={"/data/answer_type": "multiple"})
        node = load(self.file)["form"]["nodes"][0]
        self.assertEqual(node["data"]["prompt"]["en"], "Count?")
        self.assertEqual(len(node["data"]["options"]), 2)
        self.assertIsNone(node["data"]["min"])

    def test_matrix_zero_scores_choices_move_and_dangling_guards(self):
        self.action("add", section="flow", kind="matrix_question", title="Battery")
        self.action("apply", changes={"/data/options/0/score": 0})
        self.action("array-add", pointer="/data/options")
        self.assertEqual(len(load(self.file)["form"]["nodes"][0]["data"]["options"]), 3)
        self.assertEqual(load(self.file)["form"]["nodes"][0]["data"]["options"][0]["score"], 0)
        self.action("add", section="flow", kind="group", title="Group")
        self.action("move", direction="up")
        battery = load(self.file)["form"]["nodes"][1]["id"]
        self.action("move", selection={"section": "flow", "id": battery}, direction="indent")
        self.assertEqual(load(self.file)["form"]["nodes"][0]["data"]["children"][0]["id"], battery)
        self.action("move", direction="outdent")
        self.assertEqual(load(self.file)["form"]["nodes"][1]["id"], battery)

    def test_every_block_has_a_valid_draft_template(self):
        self.action(
            "add",
            section="tests",
            name="Liking",
            method="hedonic-9-v1",
            configuration={
                "instructions": "Rate it",
                "questions": [{"id": "q1", "prompt": "Liking?"}],
            },
        )
        loop = None
        for item in self.session.dispatch({"action": "catalog"})["kinds"]:
            kind = item["value"]
            self.action(
                "add",
                section="flow",
                kind=kind,
                title=item["label"],
                parent=loop if kind in {"serve_gate", "code_entry"} else None,
            )
            if kind == "loop_samples":
                loop = self.snapshot["selection"]["id"]
        self.assertEqual(len(load(self.file)["form"]["nodes"]), 9)

    def test_credentials_are_never_prompted_inside_the_tui_and_stdin_errors_recover(self):
        with patch.dict("os.environ", {"SENSIBILIA_RESEARCHER_TOKEN": ""}):
            with self.assertRaisesRegex(AuthoringError, "Set SENSIBILIA_RESEARCHER_TOKEN"):
                self.session.dispatch(
                    {
                        "action": "server-studies",
                        "file": str(self.file),
                        "url": "https://lab.example",
                    }
                )
        requests = "invalid JSON\n[]\n" + json.dumps({"id": 2, "action": "catalog"}) + "\n"
        output = io.StringIO()
        with patch("sys.stdin", io.StringIO(requests)), patch("sys.stdout", output):
            main()
        replies = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertFalse(replies[0]["ok"])
        self.assertFalse(replies[1]["ok"])
        self.assertTrue(replies[2]["ok"])
        self.assertEqual(replies[2]["id"], 2)

    def test_duplicate_keys_in_advanced_edits_and_overwrite_exports_are_refused(self):
        self.action("add", section="flow", kind="question", title="Question")
        original = self.file.read_bytes()
        with self.assertRaisesRegex(AuthoringError, "Duplicate JSON key"):
            self.action("advanced", raw='{"kind":"question","kind":"info"}')
        self.assertEqual(self.file.read_bytes(), original)
        with self.assertRaises(FileExistsError):
            self.action("file-export", operation="copy", output=str(self.file))
        self.assertEqual(self.file.read_bytes(), original)


if __name__ == "__main__":
    unittest.main()
