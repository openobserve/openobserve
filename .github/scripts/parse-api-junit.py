#!/usr/bin/env python3
"""Aggregate API pytest junit XML into PER-CATEGORY + total test-count summaries.

The API suite is sharded into test CATEGORIES (the api-testing.yml matrix
"shards"): e.g. OSS = integration / query_agent / regression; ENT additionally
splits integration into oss_in_ent / ent_top / ent_rbac and adds cli / vortex_*.
Some categories run the SAME tests under several env-flag matrix legs
(query_agent opt true|false; regression utf8/join combos) — those legs must
collapse, not multiply, the count. So within each category we DEDUP by test
identity (classname::name) and pick the worst status across legs:

    failed  if it failed/errored in ANY leg   (precedence 2)
    passed  if it passed in any leg (never failed)  (precedence 1)
    skipped only if skipped in EVERY leg           (precedence 0)

Category is read from the per-artifact download subdir name, which the workflow
names `api-junit__<category>__<leg>` (download-artifact WITHOUT merge-multiple,
so each artifact is its own subdir). category = the part between the `__`s.

Emits one JSON object on stdout:
  {"total": {tests_total,tests_passed,tests_failed,tests_flaky,tests_skipped},
   "by_category": [{module, tests_total, ...}, ...]}
`total` dedups across every category (categories are disjoint test dirs, so this
also equals the sum, but global dedup guards against accidental overlap).
flaky is always 0 (pytest doesn't flag reruns without pytest-rerunfailures).

Best-effort: unreadable files are skipped; on no input it still prints zeroes.
"""
import glob
import json
import os
import sys
import xml.etree.ElementTree as ET

RANK = {"skipped": 0, "passed": 1, "failed": 2}


def category_of(path: str, root: str) -> str:
    rel = os.path.relpath(path, root)
    top = rel.split(os.sep)[0]  # per-artifact subdir name
    parts = top.split("__")
    return parts[1] if len(parts) >= 2 else top


def summarize(status_map: dict) -> dict:
    vals = list(status_map.values())
    return {
        "tests_total": len(vals),
        "tests_passed": vals.count("passed"),
        "tests_failed": vals.count("failed"),
        "tests_flaky": 0,
        "tests_skipped": vals.count("skipped"),
    }


def main() -> int:
    root = sys.argv[1] if len(sys.argv) > 1 else "junit-xml"
    cats: dict[str, dict] = {}
    for path in glob.glob(f"{root}/**/*.xml", recursive=True):
        cat = category_of(path, root)
        seen = cats.setdefault(cat, {})
        try:
            tree = ET.parse(path)
        except Exception as e:  # noqa: BLE001 - skip unreadable/partial files
            print(f"parse-api-junit: skipping {path}: {e}", file=sys.stderr)
            continue
        for tc in tree.getroot().iter("testcase"):
            key = (tc.get("classname", ""), tc.get("name", ""))
            status = "passed"
            for child in tc:
                tag = child.tag.lower()
                if tag == "skipped":
                    status = "skipped"
                elif tag in ("failure", "error"):
                    status = "failed"
            prev = seen.get(key)
            if prev is None or RANK[status] > RANK[prev]:
                seen[key] = status

    by_category = [
        {"module": cat, **summarize(m)} for cat, m in sorted(cats.items())
    ]
    global_map: dict = {}
    for m in cats.values():
        for key, status in m.items():
            prev = global_map.get(key)
            if prev is None or RANK[status] > RANK[prev]:
                global_map[key] = status

    print(json.dumps({"total": summarize(global_map), "by_category": by_category}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
