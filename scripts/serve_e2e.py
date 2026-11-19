"""Run the real API with isolated, temporary data for researcher-browser tests."""

import argparse
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import uvicorn
from alembic import command
from alembic.config import Config

from sensibilia.api import create_app
from sensibilia.config import Settings

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--production", action="store_true")
parser.add_argument("--https", action="store_true")
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix="sensibilia-e2e-") as directory:
    url = f"sqlite:///{(Path(directory) / 'browser.db').as_posix()}"
    token = "e2e-researcher-" + "x" * 32
    os.environ["SENSIBILIA_DATABASE_URL"] = url
    os.environ["SENSIBILIA_RESEARCHER_TOKEN"] = token
    # Credential-free handoff lets browser proofs invoke the same administrative worker
    # against this harness's temporary database; never expose it through the API.
    # Same location as the Playwright evidence writers (frontend/tests/e2e/evidence.ts).
    evidence = Path(os.environ.get("EVIDENCE_DIR") or root / "frontend" / "test-evidence")
    state_file = evidence / "slice-20-e2e-harness.json"
    state_file.parent.mkdir(parents=True, exist_ok=True)
    state_file.write_text(json.dumps({"database_url": url}), encoding="utf-8")
    command.upgrade(Config(str(root / "alembic.ini")), "head")
    ssl_options = {}
    if args.https:
        openssl = shutil.which("openssl")
        if not openssl:
            raise RuntimeError("HTTPS browser tests require OpenSSL")
        key, certificate = Path(directory) / "key.pem", Path(directory) / "cert.pem"
        config = Path(directory) / "openssl.cnf"
        config.write_text("[req]\ndistinguished_name=dn\n[dn]\n", encoding="utf-8")
        subprocess.run(
            [
                openssl,
                "req",
                "-x509",
                "-newkey",
                "rsa:2048",
                "-nodes",
                "-days",
                "1",
                "-config",
                str(config),
                "-subj",
                "/CN=localhost",
                "-addext",
                "subjectAltName=DNS:localhost,IP:127.0.0.1",
                "-keyout",
                str(key),
                "-out",
                str(certificate),
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        ssl_options = {"ssl_keyfile": str(key), "ssl_certfile": str(certificate)}
    if args.production and not (root / "frontend" / "dist" / "index.html").is_file():
        raise RuntimeError("Build production frontend before deployment tests")
    uvicorn.run(
        create_app(
            Settings(
                database_url=url, researcher_token=token, operator_token="e2e-operator-" + "o" * 32
            )
        ),
        host="127.0.0.1",
        port=5173 if args.production else int(os.environ.get("E2E_API_PORT", "8001")),
        **ssl_options,
        access_log=False,
    )
