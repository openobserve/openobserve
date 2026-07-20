"""Phase 4 — Error Paths: verify the server returns proper 4xx error codes
for invalid inputs instead of crashing with 5xx.

Covers: malformed SQL, type mismatches, missing streams, invalid time
ranges, bad request bodies, and disallowed DDL/DML in search queries.

Self-contained — does NOT depend on data ingestion. Error path tests
validate that the server rejects bad input gracefully, regardless of
whether any streams or data exist.
"""

import json
import logging
from datetime import datetime, UTC
from pathlib import Path

import pytest

from support.factories import search_payload

# ── Paths ──────────────────────────────────────────────────────────────────
_DATA_DIR = Path(__file__).parent.parent.parent.parent / "test-data" / "query-agent"
_ERROR_FILE = _DATA_DIR / "queries" / "error_paths.json"

# Stream name substituted for {stream} in error SQL. Does not need to exist —
# error cases should be rejected at parse/plan time before stream resolution.
# Using a non-existent name ensures stream-not-found errors don't mask the
# error we're actually testing, and both are 4xx anyway.
_PLACEHOLDER_STREAM = "error_path_test_stream"


# ── Load error cases ───────────────────────────────────────────────────────
def _load_error_cases():
    """Return list of error case dicts sorted by id."""
    with open(_ERROR_FILE) as f:
        data = json.load(f)
    return sorted(data["cases"], key=lambda c: c["id"])


# ── Shared helpers ─────────────────────────────────────────────────────────
def _build_payload(case):
    """Build the search payload for an error test case.

    Starts from a valid ``search_payload``, replaces ``{stream}`` with a
    placeholder name, applies ``payload_overrides``, then removes any keys
    listed in ``payload_remove``.
    """
    sql = case["sql"].replace("{stream}", _PLACEHOLDER_STREAM)

    now = datetime.now(UTC)
    start_time = int(now.timestamp() * 1_000_000) - 3_600_000_000
    end_time = int(now.timestamp() * 1_000_000)

    payload = search_payload(sql, start_time=start_time, end_time=end_time)

    # Apply top-level overrides to the query sub-dict
    overrides = case.get("payload_overrides", {})
    for key, value in overrides.items():
        payload["query"][key] = value

    # Remove keys (e.g. sql, start_time, end_time)
    for key in case.get("payload_remove", []):
        payload["query"].pop(key, None)

    return payload


def run_error_test(client, case):
    """Send an intentionally-invalid query and assert the server returns 4xx.

    A 5xx response means the server crashed or panicked on bad input rather
    than rejecting it gracefully — that is the bug this test catches.
    """
    qid = case["id"]
    payload = _build_payload(case)

    resp = client.post("_search?type=logs", json=payload)

    status = resp.status_code
    lo = case["expect_status_min"]
    hi = case["expect_status_max"]

    assert lo <= status <= hi, (
        f"{qid}: expected {lo}-{hi}, got {status}\n"
        f"  description: {case['description']}\n"
        f"  response: {resp.text[:500]}"
    )

    # Response body should contain some kind of error indicator
    body = resp.text.strip()
    if body:
        try:
            err_json = resp.json()
            error_fields = [k for k in err_json if k in ("error", "message", "detail", "code")]
            if error_fields:
                logging.info("%s: 4xx with error fields %s", qid, error_fields)
            else:
                logging.info("%s: 4xx response body: %s", qid, body[:200])
        except ValueError:
            logging.info("%s: 4xx non-JSON response: %s", qid, body[:200])

    logging.info("%s passed: %d %s", qid, status, case["description"])


# ── Generate one parametrized test per error category ──────────────────────
def _make_test(cat, cases):
    @pytest.mark.parametrize("case", cases, ids=[c["id"] for c in cases])
    def _test(client, case):
        run_error_test(client, case)

    return _test


_ERROR_CASES = _load_error_cases()
_BY_CATEGORY: dict[str, list[dict]] = {}
for _case in _ERROR_CASES:
    _BY_CATEGORY.setdefault(_case["category"], []).append(_case)

for _cat, _cases in sorted(_BY_CATEGORY.items()):
    _fn = _make_test(_cat, _cases)
    _fn.__name__ = f"test_error_{_cat}"
    _fn.__doc__ = f"Error paths: validate 4xx for {_cat}"
    globals()[_fn.__name__] = _fn
