#!/usr/bin/env python3
"""Turn ci_matrix_api_regression.json into the api_bugfix_regression.yml matrix, failing on any unwired regression test."""

import json
import shlex
import sys
from pathlib import Path

REQUIRED = ("label", "target", "server_env", "category")
USAGE = "usage: build-api-regression-matrix.py <manifest.json> <tests/api-testing>"


def fail(msg: str) -> None:
    print(f"::error::{msg}", file=sys.stderr)
    sys.exit(1)


def paths_of(target: str) -> list[str]:
    return [t.rstrip("/") for t in shlex.split(target) if t.startswith("tests/")]


def covers(path: str, file: str) -> bool:
    return file == path or file.startswith(path + "/")


def main() -> None:
    if len(sys.argv) != 3:
        fail(USAGE)
    manifest, root = (Path(a) for a in sys.argv[1:])
    shards = [{k: v for k, v in s.items() if not k.startswith("_")} for s in json.loads(manifest.read_text())["shards"]]

    labels = [s.get("label") for s in shards]
    if len(set(labels)) != len(labels):
        fail(f"duplicate shard labels: {labels}")
    for s in shards:
        missing = [k for k in REQUIRED if k not in s]
        if missing:
            fail(f"shard {s.get('label')!r} lacks {missing}")
        if not paths_of(s["target"]):
            fail(f"shard {s['label']!r} target names no tests/ path: {s['target']!r}")
        for p in paths_of(s["target"]):
            if not (root / p).exists():
                fail(f"shard {s['label']!r} target {p} does not exist")

    files = sorted(str(f.relative_to(root)) for f in (root / "tests" / "regression").rglob("test_*.py"))
    if not files:
        fail(f"no test files under {root / 'tests' / 'regression'}")
    for f in files:
        owners = [s for s in shards if any(covers(p, f) for p in paths_of(s["target"]))]
        if not owners:
            fail(f"{f} is under tests/regression/ but no shard in {manifest.name} runs it, so it would never run")
        envs = [s["server_env"] for s in owners]
        if len(set(envs)) != len(envs):
            fail(f"{f} is run by several shards with the same server_env: {[s['label'] for s in owners]}")

    print(json.dumps({"include": shards}, separators=(",", ":")))


if __name__ == "__main__":
    main()
