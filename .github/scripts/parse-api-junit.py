#!/usr/bin/env python3
"""Aggregate API pytest junit XML into PER-CATEGORY + total test-count summaries.

The API suite is grouped into test CATEGORIES (set by the upload-artifact name
`api-junit__<category>__<leg>` in api-testing.yml):
  OSS = api_integration_tests, query_agent_memtable, query_agent_parquet
  ENT = api_integration_tests, query_agent_memtable, query_agent_parquet, cli, vortex
(query_agent is split by phase — see PHASE_RE below.)
Several jobs/shards fold into one category (their test sets are DISJOINT, so the
dedup below makes "within-category dedup" == sum):
  api_integration_tests = the integration default-set + regression (+ ENT's
                          oss_in_ent / ent_top / ent_rbac shards)
  vortex                = tests/vortex/* + test_3_vortex.py
Other jobs re-run the SAME tests under several env-flag matrix legs (query_agent
opt true|false; regression utf8/join combos) — those legs must collapse, not
multiply, the count. So within each category we DEDUP by test identity
(classname::name) and pick the worst status across legs:

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
import re
import sys
import xml.etree.ElementTree as ET

RANK = {"skipped": 0, "passed": 1, "failed": 2}

# The query_agent SQL suite runs every query in two phases — memtable and parquet
# (pytest classes test_1_memtable / test_2_parquet) — and a vortex phase
# (test_3_vortex). They're genuinely separate tests (different code paths), so
# rather than one big query_agent bucket we split it BY PHASE from the classname:
# query_agent_memtable / query_agent_parquet, and route the vortex phase into the
# `vortex` category (so ENT's main query_agent run, which also executes
# test_3_vortex, merges with the dedicated vortex job). Tests whose classname
# doesn't match keep their artifact-derived category untouched.
PHASE_RE = re.compile(r"test_\d+_(memtable|parquet|vortex)")


def category_of(path: str, root: str) -> str:
    rel = os.path.relpath(path, root)
    top = rel.split(os.sep)[0]  # per-artifact subdir name
    parts = top.split("__")
    return parts[1] if len(parts) >= 2 else top


def refine_category(base: str, classname: str) -> str:
    m = PHASE_RE.search(classname or "")
    if not m:
        return base
    phase = m.group(1)
    return "vortex" if phase == "vortex" else f"query_agent_{phase}"


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
        base = category_of(path, root)
        try:
            tree = ET.parse(path)
        except Exception as e:  # noqa: BLE001 - skip unreadable/partial files
            print(f"parse-api-junit: skipping {path}: {e}", file=sys.stderr)
            continue
        for tc in tree.getroot().iter("testcase"):
            classname = tc.get("classname", "")
            cat = refine_category(base, classname)  # phase-split query_agent
            seen = cats.setdefault(cat, {})
            key = (classname, tc.get("name", ""))
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
