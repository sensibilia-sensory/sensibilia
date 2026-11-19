"""Reviewed ledger/state census v1: counts only; no scoring or statistical inference.
Standalone stdlib recipe receives only frozen dataset.json. Null is a distinct state.
"""

import hashlib
import json
import sys
from collections import Counter
from pathlib import Path


def census(content):
    rows = json.loads(content)
    return {
        "recipe": "ledger-state-census-v1",
        "dataset_sha256": hashlib.sha256(content).hexdigest(),
        "row_count": len(rows),
        "session_count_with_rows": len({r["session_id"] for r in rows}),
        "row_kinds": dict(sorted(Counter(r["row_kind"] for r in rows).items())),
        "states": dict(
            sorted(Counter(r["state"] if r["state"] is not None else "null" for r in rows).items())
        ),
        "note": (
            "Projected rows, not participants or atomic event counts. "
            "No scoring, aggregation of ratings, exclusions or inference."
        ),
    }


if __name__ == "__main__":
    print(
        json.dumps(
            census(Path(sys.argv[1]).read_bytes()),
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
    )
