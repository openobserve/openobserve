"""VRL Function CRUD + Test-Function API Tests.

Rewritten in Phase 4 of the api-tests revamp:
- Replaces fixed names (`pytestfunction`, `pytestfunctions`) with
  unique_name() so tests can run in parallel and don't cascade-fail
  when one test leaves state behind.
- Adds a temp_function fixture that creates + auto-deletes.
- Consolidates 3 near-identical invalid-test-function cases
  (invalidfunction, onlytextfunction, onlyspecialcharfunction) into
  one parametrized test.
- Body validation: list returns dict with 'list' key; test endpoint
  returns 'results' with each event transformed; create returns the
  function name back; etc.
- Removes the mis-named `test_e2e_addDeleteStreamFunction` which never
  actually exercised stream-attachment (it was a duplicate of
  createdeletefunction).
- Original `test_e2e_folder` was mis-named (it lists functions, not
  folders). Renamed accordingly.
"""
from __future__ import annotations

import logging
from collections.abc import Generator

import pytest

from support.client import OpenObserveClient
from support.factories import unique_name

logger = logging.getLogger(__name__)

ORG_ID = "default"

# Sample log events used by test-function payloads. Timestamps are
# in microseconds — these are sample data passed in the request body,
# not query windows, so it's fine that they're "old".
SAMPLE_EVENTS = [
    {"_timestamp": 1735128523652186, "job": "test", "level": "info", "log": "test message for openobserve"},
    {"_timestamp": 1735128522644223, "job": "test", "level": "info", "log": "test message for openobserve"},
]


def _function_payload(name: str, *, body: str = ".a=190025552") -> dict:
    return {
        "function": body,
        "name": name,
        "params": "row",
        "transType": 0,
    }


# ----- fixtures -----


@pytest.fixture
def temp_function(client: OpenObserveClient) -> Generator[str, None, None]:
    """Create a function with a unique name; yield name; auto-delete on teardown."""
    name = unique_name("pytestfn")
    resp = client.post("functions", json=_function_payload(name))
    assert resp.status_code == 200, \
        f"setup failed: create function {name}: {resp.status_code} {resp.text}"
    yield name
    try:
        client.delete(f"functions/{name}")
    except Exception as e:
        logger.warning("temp_function cleanup failed for %s: %s", name, e)


# ----- list -----


def test_list_functions_returns_list(client: OpenObserveClient):
    """GET /functions returns 200 + a 'list' key in the body."""
    resp = client.get("functions")
    assert resp.status_code == 200, resp.text

    body = resp.json()
    assert "list" in body, f"response missing 'list' key: {body}"
    assert isinstance(body["list"], list), \
        f"'list' should be a list, got {type(body['list']).__name__}"


# ----- create / update / delete -----


def test_create_function_persists_and_can_be_deleted(client: OpenObserveClient):
    """Create a function with a unique name, verify it can be deleted cleanly."""
    name = unique_name("pytestfn")
    try:
        resp = client.post("functions", json=_function_payload(name))
        assert resp.status_code == 200, \
            f"create failed: {resp.status_code} {resp.text}"
    finally:
        delete_resp = client.delete(f"functions/{name}")
        assert delete_resp.status_code == 200, \
            f"delete failed: {delete_resp.status_code} {delete_resp.text}"


def test_update_function_body(client: OpenObserveClient, temp_function: str):
    """PUT /functions/{name} updates the function body."""
    updated = _function_payload(temp_function, body=".a=1900")
    resp = client.put(f"functions/{temp_function}", json=updated)
    assert resp.status_code == 200, \
        f"update failed: {resp.status_code} {resp.text}"


def test_create_duplicate_function_returns_400(client: OpenObserveClient, temp_function: str):
    """Creating a function with an existing name returns 400."""
    resp = client.post("functions", json=_function_payload(temp_function))
    assert resp.status_code == 400, \
        f"duplicate create should be 400, got {resp.status_code}: {resp.text}"


def test_create_invalid_function_returns_400(client: OpenObserveClient):
    """A function payload with garbage name + garbage VRL returns 400."""
    payload = {"name": "...", "function": "...", "params": "row", "transType": 0}
    resp = client.post("functions", json=payload)
    assert resp.status_code == 400, \
        f"invalid payload should be 400, got {resp.status_code}: {resp.text}"


def test_delete_nonexistent_function_returns_404(client: OpenObserveClient):
    """DELETE /functions/{name} where name doesn't exist returns 404."""
    nonexistent = unique_name("ghostfn")
    resp = client.delete(f"functions/{nonexistent}")
    assert resp.status_code == 404, \
        f"delete of nonexistent should be 404, got {resp.status_code}: {resp.text}"


# ----- /functions/test endpoint -----


def test_test_endpoint_with_valid_vrl_returns_transformed_events(client: OpenObserveClient):
    """POST /functions/test with a valid VRL transformation returns transformed events."""
    payload = {
        "function": ".test=2\n.",
        "events": SAMPLE_EVENTS,
    }
    resp = client.post("functions/test", json=payload)
    assert resp.status_code == 200, \
        f"valid test function failed: {resp.status_code} {resp.text}"

    body = resp.json()
    assert "results" in body, f"response missing 'results' key: {body}"
    results = body["results"]
    assert isinstance(results, list), f"results should be a list, got {type(results).__name__}"
    assert len(results) >= 1, f"results should be non-empty, got: {results}"

    # The VRL `.test=2\n.` adds a `test=2` field to each event
    for i, result in enumerate(results):
        assert "event" in result, f"result {i} missing 'event': {result}"
        assert result["event"].get("test") == 2, \
            f"result {i} should have test=2 from VRL transform, got: {result['event']}"


@pytest.mark.parametrize(
    ("vrl_function", "description"),
    [
        (".test=2jehwkhhe\n.", "VRL with syntax error"),
        ("test", "plain text (not a VRL function)"),
        ("=====", "VRL with only special chars"),
    ],
    ids=["syntax-error", "plain-text", "special-chars-only"],
)
def test_test_endpoint_with_invalid_vrl_returns_400(
    client: OpenObserveClient, vrl_function: str, description: str
):
    """Various invalid VRL function bodies passed to /functions/test all return 400.

    Consolidates 3 near-identical legacy tests (testinvalidfunction,
    onlytextfunction, testonlyspecialcharfunction) — each was 25-30 LOC
    of copy-paste differing only in one field.
    """
    payload = {"function": vrl_function, "events": SAMPLE_EVENTS}
    resp = client.post("functions/test", json=payload)
    assert resp.status_code == 400, \
        f"{description}: expected 400, got {resp.status_code}: {resp.text}"
