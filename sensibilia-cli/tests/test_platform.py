"""Optional compatibility tests using a migrated temporary platform database."""

import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

from sensibilia_cli.cli import main
from sensibilia_cli.document import AuthoringError, load, save
from sensibilia_cli.server import create, fetch, prepare, push, version_path

try:
    from alembic import command
    from alembic.config import Config
    from fastapi.testclient import TestClient
    from sensibilia.api import create_app
    from sensibilia.config import Settings

    PLATFORM = Path(__file__).resolve().parents[2]
    AVAILABLE = (PLATFORM / "alembic.ini").exists()
except ImportError:
    AVAILABLE = False


@unittest.skipUnless(
    AVAILABLE, "Run in the Sensibilia development environment for API compatibility"
)
class PlatformTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.folder = Path(self.temporary.name)
        self.file = self.folder / "study.json"
        database_url = f"sqlite:///{(self.folder / 'test.db').as_posix()}"
        previous = os.environ.get("SENSIBILIA_DATABASE_URL")
        os.environ["SENSIBILIA_DATABASE_URL"] = database_url

        def restore():
            if previous is None:
                os.environ.pop("SENSIBILIA_DATABASE_URL", None)
            else:
                os.environ["SENSIBILIA_DATABASE_URL"] = previous

        self.addCleanup(restore)
        configuration = Config(str(PLATFORM / "alembic.ini"))
        configuration.set_main_option("script_location", str(PLATFORM / "migrations"))
        command.upgrade(configuration, "head")
        token = "standalone-cli-test-key-" + "x" * 32
        self.api = TestClient(
            create_app(Settings(database_url=database_url, researcher_token=token))
        )
        self.api.__enter__()
        self.addCleanup(self.api.__exit__, None, None, None)
        self.headers = {"Authorization": f"Bearer {token}"}
        api, headers = self.api, self.headers

        class Adapter:
            url = "http://127.0.0.1:8000"

            def __init__(self):
                self.calls = []

            def request(self, method, path, body=None):
                self.calls.append((method, path, body))
                response = api.request(method, path, headers=headers, json=body)
                if response.status_code >= 400:
                    raise AuthoringError(f"HTTP {response.status_code}: {response.text}")
                return response.json() if response.content else None

        self.client = Adapter()
        self.cli("new", self.file, "--title", "CLI compatibility")
        self.cli(
            "sample", self.file, "add", "--code", "123", "--label", "Product A", "--no-ingredients"
        )
        config = self.folder / "method.json"
        config.write_text(
            json.dumps(
                {
                    "instructions": "Rate this sample",
                    "questions": [
                        {"id": "liking", "prompt": "Overall liking", "required": True},
                    ],
                }
            )
        )
        self.config = config
        self.cli(
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
        self.cli("add", self.file, "loop_samples", "--title", "Samples", "--sample", "123")
        self.cli(
            "add",
            self.file,
            "embedded_method",
            "--title",
            "Liking",
            "--test",
            "Liking",
            "--parent",
            "Samples",
        )
        self.cli("add", self.file, "end", "--title", "Done", "--body", "Thank you")

    def cli(self, *args):
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            self.assertEqual(main([str(arg) for arg in args]), 0)

    def test_create_remaps_references_and_atomic_save_uses_revision(self):
        original = load(self.file)
        create(self.client, self.file)
        document = load(self.file)
        self.assertNotEqual(original["tests"][0]["id"], document["tests"][0]["id"])
        self.assertNotEqual(original["samples"][0]["id"], document["samples"][0]["id"])
        source = document["source"]
        base = version_path(source["study_id"], source["version_id"])
        report = self.client.request("GET", base + "/validation")
        self.assertTrue(report["valid"], report["issues"])
        document["title"] = "Edited via CLI"
        document["tests"][0]["configuration"]["questions"][0]["prompt"] = "Changed question"
        save(self.file, document)
        push(self.client, self.file)
        readback = fetch(self.client, source["study_id"])
        self.assertEqual(readback["title"], "Edited via CLI")
        self.assertEqual(
            readback["tests"][0]["configuration"]["questions"][0]["prompt"], "Changed question"
        )
        last_write = [call for call in self.client.calls if call[0] == "PUT"][-1]
        self.assertTrue(last_write[1].endswith("/draft"))
        self.assertEqual(last_write[2]["revision_hash"], document["source"]["revision_hash"])

    def test_stale_and_published_saves_are_refused_without_writes(self):
        create(self.client, self.file)
        stale = load(self.file)
        source = stale["source"]
        base = version_path(source["study_id"], source["version_id"])
        self.client.request(
            "PATCH",
            base,
            {
                "title": "Changed elsewhere",
                "description": "",
                "revision_hash": source["revision_hash"],
            },
        )
        count = len(self.client.calls)
        with self.assertRaisesRegex(AuthoringError, "reload"):
            push(self.client, self.file)
        self.assertTrue(all(c[0] == "GET" for c in self.client.calls[count:]))
        fresh = fetch(self.client, source["study_id"])
        report = self.client.request("GET", base + "/validation")
        self.client.request(
            "POST",
            f"/studies/{source['study_id']}/publish",
            {
                "study_version_id": source["version_id"],
                "revision_hash": fresh["source"]["revision_hash"],
                "acknowledged_warning_codes": [
                    i["code"] for i in report["issues"] if i["severity"] == "warning"
                ],
            },
        )
        published = fetch(self.client, source["study_id"])
        save(self.file, published)
        with self.assertRaisesRegex(AuthoringError, "immutable"):
            push(self.client, self.file)

    def test_prepare_existing_draft_then_push_and_create_not_repeated(self):
        create(self.client, self.file)
        with self.assertRaisesRegex(AuthoringError, "already"):
            create(self.client, self.file)
        self.cli(
            "test",
            self.file,
            "add",
            "--name",
            "Second liking",
            "--type",
            "hedonic-9-v1",
            "--config",
            self.config,
        )
        self.cli(
            "add",
            self.file,
            "embedded_method",
            "--title",
            "Second",
            "--test",
            "Second liking",
            "--before",
            "Done",
        )
        count = len(self.client.calls)
        with self.assertRaisesRegex(AuthoringError, "prepare"):
            push(self.client, self.file)
        self.assertTrue(all(c[0] == "GET" for c in self.client.calls[count:]))
        prepare(self.client, self.file)
        count = len(self.client.calls)
        prepare(self.client, self.file)
        self.assertTrue(all(c[0] == "GET" for c in self.client.calls[count:]))
        push(self.client, self.file)
        self.assertEqual(len(load(self.file)["tests"]), 2)

    def test_rejected_aggregate_save_rolls_back_metadata(self):
        create(self.client, self.file)
        document = load(self.file)
        source = document["source"]
        old_title = document["title"]
        document["title"] = "Must roll back"
        # A structurally valid image reference is rejected by server ownership validation.
        document["form"]["nodes"].insert(
            0,
            {
                "id": "66750083-0293-4a18-ad77-cb25b07a38ce",
                "kind": "info",
                "title": {"en": "Image"},
                "data": {
                    "body": {"en": "Picture"},
                    "continue_label": {"en": "Next"},
                    "asset_ids": ["335da910-f517-439f-8195-aefaa1be49d8"],
                },
            },
        )
        save(self.file, document)
        with self.assertRaises(AuthoringError):
            push(self.client, self.file)
        remote = fetch(self.client, source["study_id"])
        self.assertEqual(remote["title"], old_title)
        self.assertEqual(remote["source"]["revision_hash"], source["revision_hash"])

    def test_prepare_detects_concurrent_edit_and_preserves_acknowledged_resource_id(self):
        create(self.client, self.file)
        self.cli(
            "test",
            self.file,
            "add",
            "--name",
            "Additional",
            "--type",
            "hedonic-9-v1",
            "--config",
            self.config,
        )
        original = load(self.file)
        old_id = original["tests"][-1]["id"]
        source = original["source"]
        base = version_path(source["study_id"], source["version_id"])
        request = self.client.request

        def concurrent_request(method, path, body=None):
            result = request(method, path, body)
            if method == "POST" and path.endswith("/tests"):
                current = request("GET", base)
                request(
                    "PATCH",
                    base,
                    {
                        "title": "Concurrent staff edit",
                        "description": "",
                        "revision_hash": current["revision_hash"],
                    },
                )
            return result

        self.client.request = concurrent_request
        with self.assertRaisesRegex(AuthoringError, "changed during preparation"):
            prepare(self.client, self.file)
        checkpoint = load(self.file)
        self.assertNotEqual(checkpoint["tests"][-1]["id"], old_id)
        self.assertEqual(checkpoint["source"]["revision_hash"], source["revision_hash"])
        self.assertEqual(checkpoint["title"], original["title"])

    def test_bundled_validators_match_the_recorded_platform_source(self):
        import hashlib

        bundled = PLATFORM / "sensibilia-cli" / "sensibilia_cli" / "contracts"
        manifest = json.loads((bundled / "manifest.json").read_text())
        for name, info in manifest["files"].items():
            source = PLATFORM / info["source"]
            self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), info["sha256"])
            expected = source.read_text(encoding="utf-8").replace("from sensibilia.", "from .")
            self.assertEqual((bundled / name).read_text(encoding="utf-8"), expected)

    def test_complete_cli_workflow_over_http(self):
        import threading
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
        from unittest.mock import patch

        api = self.api

        class Bridge(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def forward(self):
                body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
                response = api.request(
                    self.command,
                    self.path,
                    content=body or None,
                    headers={
                        "Authorization": self.headers.get("Authorization", ""),
                        "Content-Type": "application/json",
                    },
                )
                self.send_response(response.status_code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(response.content)))
                self.end_headers()
                self.wfile.write(response.content)

            do_GET = do_POST = do_PUT = forward

        server = ThreadingHTTPServer(("127.0.0.1", 0), Bridge)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            url = f"http://127.0.0.1:{server.server_port}"
            with patch.dict(
                os.environ, {"SENSIBILIA_RESEARCHER_TOKEN": self.headers["Authorization"][7:]}
            ):
                self.cli("create", self.file, "--url", url)
                study_id = load(self.file)["source"]["study_id"]
                pulled = self.folder / "pulled.json"
                self.cli("pull", pulled, "--url", url, "--study", study_id)
                self.cli("set", pulled, "study", "/title", "--text", "Through HTTP")
                self.cli("push", pulled)
                self.cli("server-check", pulled)
                self.assertEqual(load(pulled)["title"], "Through HTTP")
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_tui_adapter_uses_existing_server_save_and_validation(self):
        from unittest.mock import patch

        from sensibilia_cli.tui_backend import Session, local_hash

        session = Session()
        common = {"file": str(self.file), "url": self.client.url}
        with (
            patch("sensibilia_cli.cli.Client", return_value=self.client),
            patch.object(Session, "client", return_value=self.client),
        ):
            created = session.dispatch(
                {**common, "action": "server", "operation": "create", "hash": local_hash(self.file)}
            )
            changed = session.dispatch(
                {
                    **common,
                    "action": "apply",
                    "hash": created["hash"],
                    "selection": {"section": "study"},
                    "changes": {"/title": "TUI study"},
                }
            )
            saved = session.dispatch(
                {**common, "action": "server", "operation": "push", "hash": changed["hash"]}
            )
            report = session.dispatch(
                {**common, "action": "server", "operation": "server-check", "hash": saved["hash"]}
            )
        self.assertTrue(report["report"]["valid"])
        self.assertFalse(report["stale"])
        self.assertFalse(saved["canUndo"])
        self.assertEqual(saved["document"]["title"], "TUI study")

    def test_every_guided_method_can_be_created_saved_and_checked_by_the_real_api(self):
        from unittest.mock import patch
        from uuid import uuid4

        from method_cases import METHODS, guided_values

        from sensibilia_cli.document import save
        from sensibilia_cli.tui_backend import Session, local_hash

        for method in METHODS:
            with self.subTest(method=method):
                filename = self.folder / f"guided-{method}.json"
                session = Session()
                session.dispatch({"action": "new", "file": str(filename), "title": method})
                for code in (123, 456):
                    session.dispatch(
                        {
                            "action": "add",
                            "file": str(filename),
                            "hash": local_hash(filename),
                            "section": "samples",
                            "code": str(code),
                            "label": f"Product {code}",
                            "tags": [],
                        }
                    )
                samples = load(filename)["samples"]
                created = session.dispatch(
                    {
                        "action": "add",
                        "file": str(filename),
                        "hash": local_hash(filename),
                        "section": "tests",
                        "name": method,
                        "method": method,
                        "guided": guided_values(method, samples),
                    }
                )
                document = created["document"]
                method_node = {
                    "id": str(uuid4()),
                    "kind": "embedded_method",
                    "title": {"en": "Evaluation"},
                    "data": {"study_test_id": document["tests"][0]["id"], "sample_binding": "none"},
                }
                per_sample = method in {"cata-v1", "rata-v1", "jar-v1", "tcata-v1"}
                if per_sample:
                    method_node["data"]["sample_binding"] = "current"
                    nodes = [
                        {
                            "id": str(uuid4()),
                            "kind": "loop_samples",
                            "title": {"en": "Samples"},
                            "data": {
                                "sample_ids": [sample["id"] for sample in samples],
                                "children": [method_node],
                            },
                        }
                    ]
                else:
                    method_node["data"]["sample_binding"] = (
                        "none" if method == "hedonic-9-v1" else "set"
                    )
                    nodes = [method_node]
                nodes.append(
                    {
                        "id": str(uuid4()),
                        "kind": "end",
                        "title": {"en": "Done"},
                        "data": {"body": {"en": "Thank you."}, "outcome": "completed"},
                    }
                )
                document["form"]["nodes"] = nodes
                save(filename, document)
                common = {"file": str(filename), "url": self.client.url}
                with (
                    patch("sensibilia_cli.cli.Client", return_value=self.client),
                    patch.object(Session, "client", return_value=self.client),
                ):
                    saved = session.dispatch(
                        {
                            **common,
                            "action": "server",
                            "operation": "create",
                            "hash": local_hash(filename),
                        }
                    )
                    report = session.dispatch(
                        {
                            **common,
                            "action": "server",
                            "operation": "server-check",
                            "hash": saved["hash"],
                        }
                    )
                self.assertTrue(report["report"]["valid"], report["report"]["issues"])
                actual = saved["document"]["tests"][0]
                self.assertEqual(actual["test_type_id"], method)
                self.assertNotEqual(actual["id"], document["tests"][0]["id"])
                if method == "rata-v1":
                    self.assertEqual(actual["configuration"]["rating_min"], 0)
                    self.assertFalse(actual["configuration"]["require_ratings"])
                for key in ("reference_sample_id", "expected_sample_id"):
                    if actual["configuration"].get(key):
                        self.assertIn(
                            actual["configuration"][key], actual["configuration"]["sample_ids"]
                        )


if __name__ == "__main__":
    unittest.main()
