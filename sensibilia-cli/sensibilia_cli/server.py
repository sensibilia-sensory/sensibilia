"""Researcher API client. Never imports the application or opens its database."""

import getpass
import ipaddress
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from copy import deepcopy
from uuid import UUID, uuid4

from .document import AuthoringError, Document, load, require_references, save


def server_url(value, *, allow_http=False):
    parsed = urllib.parse.urlsplit(value)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        raise AuthoringError("Server URL must use HTTP(S), without credentials, query or fragment")
    loopback = parsed.hostname.lower() == "localhost"
    try:
        loopback |= ipaddress.ip_address(parsed.hostname).is_loopback
    except ValueError:
        pass
    if parsed.scheme == "http" and not loopback and not allow_http:
        raise AuthoringError("Use HTTPS for a network server, or explicitly pass --allow-http")
    return value.rstrip("/")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        return None


class Client:
    def __init__(self, url, *, token=None, allow_http=False):
        self.url = server_url(url, allow_http=allow_http)
        self.token = token or os.environ.get("SENSIBILIA_RESEARCHER_TOKEN")
        if not self.token:
            self.token = getpass.getpass("Researcher key: ")
        if not self.token or any(c in self.token for c in "\r\n"):
            raise AuthoringError("A nonblank researcher key is required")
        # Bypass environment proxies for a local lab connection; never follow redirects
        # carrying the Authorization header to an unexpected destination.
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def request(self, method, path, body=None):
        data = None if body is None else json.dumps(body, allow_nan=False).encode("utf-8")
        request = urllib.request.Request(
            self.url + path,
            data=data,
            method=method,
            headers={
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )
        try:
            with self.opener.open(request, timeout=30) as response:
                raw = response.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as exc:
            if exc.code == 409:
                message = "Draft changed or is read-only; reload and review before saving"
            elif exc.code in {401, 403}:
                message = "Researcher authentication failed"
            elif 300 <= exc.code < 400:
                message = "Redirect refused; configure the server's final URL"
            else:
                try:
                    detail = json.loads(exc.read()).get("detail", "Request rejected")
                    message = json.dumps(detail, ensure_ascii=False)
                except (ValueError, AttributeError):
                    message = "Request rejected"
            raise AuthoringError(
                f"Server HTTP {exc.code}: {message}".replace(self.token, "[redacted]")
            ) from None
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            action = (
                " A write may have committed; inspect the server before retrying." if data else ""
            )
            raise AuthoringError(
                f"Cannot reach the server ({type(exc).__name__}).{action}"
            ) from None


def version_path(study_id, version_id):
    return f"/studies/{UUID(str(study_id))}/versions/{UUID(str(version_id))}"


def fetch(client, study_id, version_id=None):
    study = client.request("GET", f"/studies/{UUID(str(study_id))}")
    versions = study["versions"]
    if version_id:
        candidates = [v for v in versions if v["id"] == str(UUID(str(version_id)))]
    else:
        candidates = [v for v in versions if v["published_at"] is None]
        if not candidates and versions:
            candidates = [max(versions, key=lambda v: v["version_number"])]
    if len(candidates) != 1:
        raise AuthoringError("No matching version; select a version explicitly")
    base = version_path(study_id, candidates[0]["id"])
    before = client.request("GET", base)
    tests = client.request("GET", base + "/tests")
    samples = client.request("GET", base + "/samples")
    after = client.request("GET", base)
    if before["revision_hash"] != after["revision_hash"]:
        raise AuthoringError("Draft changed while loading; retry the load")
    form = after["form"]
    if form is not None and form.get("schema_version") != 2:
        raise AuthoringError("Legacy Form v1 is unsupported; convert it in Sensibilia first")
    if form is None:
        form = {"schema_version": 2, "languages": ["en"], "default_language": "en", "nodes": []}
    return {
        "format_version": 1,
        "title": after["title"],
        "description": after["description"],
        "form": form,
        "tests": [
            {
                "id": t["id"],
                "name": f"Test {i + 1}: {t['test_type_id']}",
                "test_type_id": t["test_type_id"],
                "configuration": t["configuration"],
            }
            for i, t in enumerate(tests)
        ],
        "samples": [
            {key: s[key] for key in ("id", "code", "label", "ingredient_tags")} for s in samples
        ],
        "source": {
            "url": client.url,
            "study_id": str(study_id),
            "version_id": after["id"],
            "revision_hash": after["revision_hash"],
            "published_at": after["published_at"],
        },
    }


def source_check(client, document):
    source = document["source"]
    if source is None:
        raise AuthoringError("This is a local study; use create to save it to a new server study")
    if source["url"] != client.url:
        raise AuthoringError("Server differs from the loaded study's origin")
    if source["published_at"]:
        raise AuthoringError("Published versions are immutable; create and load a new draft")
    current = client.request("GET", version_path(source["study_id"], source["version_id"]))
    if current["published_at"] or current["revision_hash"] != source["revision_hash"]:
        raise AuthoringError("Draft changed or was published; reload and review before saving")
    return current


def remap_resource(document, old, new, *, sample=False):
    from .document import entries

    def samples(value):
        if "sample_ids" in value:
            value["sample_ids"] = [new if s == old else s for s in value["sample_ids"]]
        for key in ("reference_sample_id", "expected_sample_id"):
            if value.get(key) == old:
                value[key] = new

    for node, _, _, _ in entries(document["form"]["nodes"]):
        if sample:
            samples(node["data"])
        elif node["data"].get("study_test_id") == old:
            node["data"]["study_test_id"] = new
    if sample:
        for test in document["tests"]:
            samples(test["configuration"])
    else:
        overlays = document["form"].get("method_text", {})
        if old in overlays:
            overlays[new] = overlays.pop(old)


def push(client, filename):
    document = load(filename)
    require_references(document)
    source_check(client, document)
    source = document["source"]
    base = version_path(source["study_id"], source["version_id"])
    remote = fetch(client, source["study_id"], source["version_id"])
    if remote["source"]["revision_hash"] != source["revision_hash"]:
        raise AuthoringError("Draft changed while checking; reload and review before saving")
    if {s["id"]: s for s in document["samples"]} != {s["id"]: s for s in remote["samples"]}:
        raise AuthoringError("Sample changes require prepare; no changes were saved")
    if not {t["id"] for t in document["tests"]} <= {t["id"] for t in remote["tests"]}:
        raise AuthoringError("New sensory tests require prepare; no changes were saved")
    payload = {
        "title": document["title"],
        "description": document["description"],
        "form": document["form"],
        "revision_hash": source["revision_hash"],
        "tests": [
            {k: t[k] for k in ("id", "test_type_id", "configuration")} for t in document["tests"]
        ],
    }
    result = client.request("PUT", base + "/draft", payload)
    document["source"]["revision_hash"] = result["revision_hash"]
    # apply_form can materialize default-language method text. Read back that committed
    # representation and refuse to adopt unrelated concurrent edits.
    committed = fetch(client, source["study_id"], source["version_id"])
    if committed["source"]["revision_hash"] != result["revision_hash"]:
        save(filename, document)
        raise AuthoringError("Saved, then the draft changed again; reload before the next save")
    names = {t["id"]: t["name"] for t in document["tests"]}
    for test in committed["tests"]:
        test["name"] = names.get(test["id"], test["name"])
    save(filename, committed)


def prepare(client, filename):
    """Provision resources with checkpoints. This is explicitly not a composite transaction."""
    document = load(filename)
    require_references(document)
    current = source_check(client, document)
    source = document["source"]
    remote = fetch(client, source["study_id"], source["version_id"])
    if remote["source"]["revision_hash"] != source["revision_hash"]:
        raise AuthoringError("Draft changed while checking resources; reload before preparing")
    remote_samples = {s["id"]: s for s in remote["samples"]}
    # No silent removal or editing of server sample records.
    if any(s not in {i["id"] for i in document["samples"]} for s in remote_samples):
        raise AuthoringError("Local file omits server samples; load them before preparing")
    if any(s["id"] in remote_samples and s != remote_samples[s["id"]] for s in document["samples"]):
        raise AuthoringError(
            "Edit existing sample codes, labels and tags in Sensibilia, then reload"
        )

    expected = deepcopy(remote)

    def content(snapshot):
        canonical = Document.model_validate(snapshot).model_dump(mode="json")
        canonical.pop("source")
        for test in canonical["tests"]:
            test.pop("name")
        canonical["samples"].sort(key=lambda s: s["id"])
        return canonical

    def checkpoint():
        # Resource-create responses have no revision hash in the current API.
        observed = fetch(client, source["study_id"], source["version_id"])
        if observed["source"]["published_at"] or content(observed) != content(expected):
            save(filename, document)
            raise AuthoringError(
                "Resource created, but the server draft changed during preparation. "
                "Local identifiers were checkpointed; reload to a different file and reconcile."
            )
        document["source"]["revision_hash"] = observed["source"]["revision_hash"]
        save(filename, document)

    for sample in document["samples"]:
        if sample["id"] not in remote_samples:
            source_check(client, document)
            body = {k: sample[k] for k in ("code", "label", "ingredient_tags")}
            body["revision_hash"] = document["source"]["revision_hash"]
            result = client.request("POST", f"/studies/{source['study_id']}/samples", body)
            old, sample["id"] = sample["id"], result["id"]
            remap_resource(document, old, sample["id"], sample=True)
            expected["samples"].append(deepcopy(sample))
            checkpoint()
    remote_tests = {t["id"] for t in remote["tests"]}
    for test in document["tests"]:
        if test["id"] not in remote_tests:
            source_check(client, document)
            body = {k: test[k] for k in ("test_type_id", "configuration")}
            body["revision_hash"] = document["source"]["revision_hash"]
            result = client.request("POST", f"/studies/{source['study_id']}/tests", body)
            old, test["id"] = test["id"], result["id"]
            remap_resource(document, old, test["id"])
            expected["tests"].append(
                {
                    "id": result["id"],
                    "name": test["name"],
                    "test_type_id": result["test_type_id"],
                    "configuration": result["configuration"],
                }
            )
            if current["form"] is not None and "{{" in json.dumps(test["configuration"]):
                expected["form"]["text_version"] = 1
            checkpoint()


def create(client, filename):
    document = load(filename)
    require_references(document)
    if document["source"] is not None:
        raise AuthoringError("Study already has a server origin; use prepare and push")
    result = client.request(
        "POST",
        "/studies",
        {
            "title": document["title"],
            "description": document["description"],
        },
    )
    version = result["versions"][0]
    document["source"] = {
        "url": client.url,
        "study_id": result["id"],
        "version_id": version["id"],
        "revision_hash": version["revision_hash"],
        "published_at": None,
    }
    save(filename, document)
    prepare(client, filename)
    push(client, filename)


def detached(document):
    """Copy a publication into a local study, giving server resources fresh identities."""
    result = deepcopy(document)
    result["source"] = None
    for collection in ("samples", "tests"):
        for item in result[collection]:
            old, item["id"] = item["id"], str(uuid4())
            remap_resource(result, old, item["id"], sample=collection == "samples")
    return result
