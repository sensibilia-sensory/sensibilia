"""Write the analysis add-on lock. Maintainer tool; needs internet.

    python scripts/lock_r_runtime.py --date 2026-11-16 --r-version 4.6.2

Resolves the dependency closure of the analysis packages on one dated CRAN snapshot of Posit
Package Manager (Windows binaries), downloads every file once to record its SHA-256, and writes
src/sensibilia/analysis/r-runtime.lock.json. Laboratories never run this; they install from
the lock.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOCK = ROOT / "src" / "sensibilia" / "analysis" / "r-runtime.lock.json"
WANTED = ["jsonlite", "FactoMineR", "SensoMineR", "sensR", "agricolae"]
# Shipped with R itself (base and recommended); never downloaded separately.
WITH_R = {
    "R", "base", "compiler", "datasets", "grDevices", "graphics", "grid", "methods", "parallel",
    "splines", "stats", "stats4", "tcltk", "tools", "utils", "MASS", "lattice", "Matrix", "nlme",
    "survival", "boot", "cluster", "codetools", "foreign", "KernSmooth", "rpart", "class", "nnet",
    "spatial", "mgcv",
}  # fmt: skip
PPM = "https://packagemanager.posit.co/cran"


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "sensibilia-lock"})
    with urllib.request.urlopen(request, timeout=300) as response:  # noqa: S310
        return response.read()


def parse_packages(text: str) -> dict[str, dict[str, str]]:
    packages = {}
    for block in re.split(r"\n\s*\n", text.strip()):
        fields: dict[str, str] = {}
        key = None
        for line in block.splitlines():
            if line[:1].isspace() and key:
                fields[key] += " " + line.strip()
            elif ":" in line:
                key, _, value = line.partition(":")
                fields[key] = value.strip()
        if "Package" in fields:
            packages[fields["Package"]] = fields
    return packages


def requirements(fields: dict[str, str]) -> list[str]:
    names = []
    for field in ("Depends", "Imports"):
        for part in fields.get(field, "").split(","):
            name = re.sub(r"\(.*?\)", "", part).strip()
            if name:
                names.append(name)
    return names


def closure(index: dict[str, dict[str, str]]) -> list[str]:
    seen: list[str] = []
    pending = list(WANTED)
    while pending:
        name = pending.pop(0)
        if name in WITH_R or name in seen:
            continue
        if name not in index:
            raise SystemExit(f"{name} is not on the snapshot")
        seen.append(name)
        pending += requirements(index[name])
    return sorted(seen, key=str.lower)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", required=True, help="Posit Package Manager snapshot, YYYY-MM-DD")
    parser.add_argument("--r-version", required=True)
    args = parser.parse_args()
    minor = ".".join(args.r_version.split(".")[:2])
    contrib = f"{PPM}/{args.date}/bin/windows/contrib/{minor}"
    index = parse_packages(fetch(contrib + "/PACKAGES").decode("utf-8"))
    names = closure(index)
    installer = f"https://cran.r-project.org/bin/windows/base/old/{args.r_version}/R-{args.r_version}-win.exe"
    print("R installer", installer)
    content = fetch(installer)
    lock = {
        "lock_version": 1,
        "snapshot_date": args.date,
        "r": {
            "version": args.r_version,
            "windows": {
                "url": installer,
                "sha256": hashlib.sha256(content).hexdigest(),
                "bytes": len(content),
            },
        },
        "packages": [],
    }
    for name in names:
        version = index[name]["Version"]
        url = f"{contrib}/{name}_{version}.zip"
        print(name, version)
        content = fetch(url)
        lock["packages"].append(
            {
                "name": name,
                "version": version,
                "windows": {
                    "url": url,
                    "sha256": hashlib.sha256(content).hexdigest(),
                    "bytes": len(content),
                },
            }
        )
    LOCK.parent.mkdir(parents=True, exist_ok=True)
    LOCK.write_text(json.dumps(lock, indent=2) + "\n", encoding="utf-8")
    total = lock["r"]["windows"]["bytes"] + sum(p["windows"]["bytes"] for p in lock["packages"])
    print(f"Wrote {LOCK} ({len(names)} packages, {total // 1_000_000} MB to download)")


if __name__ == "__main__":
    main()
