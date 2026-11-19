import io
import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from sensibilia_cli.document import AuthoringError
from sensibilia_cli.server import Client, server_url


class TransportTests(unittest.TestCase):
    def test_urls_reject_embedded_credentials_and_remote_plaintext(self):
        for url in (
            "file:///tmp/study",
            "https://key:secret@lab/",
            "https://lab/?key=secret",
            "https://lab/#secret",
            "http://lab.example",
        ):
            with self.subTest(url=url), self.assertRaises(AuthoringError):
                server_url(url)
        self.assertEqual(server_url("http://127.0.0.1:8000/"), "http://127.0.0.1:8000")
        self.assertEqual(server_url("http://[::1]:8000"), "http://[::1]:8000")
        self.assertEqual(server_url("https://lab.example/api/"), "https://lab.example/api")

    def test_bearer_json_and_redirect_refusal_over_http(self):
        requests = []

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_GET(self):
                requests.append((self.path, self.headers.get("Authorization")))
                if self.path == "/redirect":
                    self.send_response(302)
                    self.send_header("Location", "/destination")
                else:
                    self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps({"ok": True}).encode())

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            client = Client(f"http://127.0.0.1:{server.server_port}", token="private-key")
            self.assertEqual(client.request("GET", "/ok"), {"ok": True})
            with self.assertRaisesRegex(AuthoringError, "Redirect refused"):
                client.request("GET", "/redirect")
            self.assertEqual(
                requests, [("/ok", "Bearer private-key"), ("/redirect", "Bearer private-key")]
            )
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_authentication_errors_do_not_echo_credentials(self):
        import urllib.error

        class BrokenOpener:
            def open(self, *args, **kwargs):
                raise urllib.error.HTTPError(
                    "http://localhost", 422, "Invalid", {}, io.BytesIO(b'{"detail":"secret-key"}')
                )

        client = Client("http://localhost", token="secret-key")
        client.opener = BrokenOpener()
        with self.assertRaises(AuthoringError) as raised:
            client.request("POST", "/studies", {"title": "Example"})
        self.assertNotIn("secret-key", str(raised.exception))


if __name__ == "__main__":
    unittest.main()
