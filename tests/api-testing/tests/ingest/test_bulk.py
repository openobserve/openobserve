"""Bulk Ingest API Tests (Elasticsearch-compatible /_bulk endpoint).

Rewritten in Phase 4 of the api-tests revamp:
- Splits the original single `test_e2e_bulk_ingest` (which crammed 3 cases
  into one function) into 3 separate tests so a failure in one case
  doesn't mask the others.
- Fixes a real bug in the original: the "negative case 3" (invalid index
  name with `****`) reused the variable name `valid_bulk_payload` on the
  POST call instead of `invalid_bulk_payload3` — so the test was
  silently sending the valid payload and asserting on it. The intent has
  been restored here.
- Uses temp_stream_name fixture for index isolation instead of a fixed
  `pytest1` index that could leak between runs.
- Body validation: asserts on `errors` field shape for both valid and
  invalid cases.
"""
from __future__ import annotations

import json
import logging

from support.client import OpenObserveClient
from support.wait import wait_until

logger = logging.getLogger(__name__)

ORG_ID = "default"


def _bulk_post(client: OpenObserveClient, body: str):
    """POST to /api/{org}/_bulk with text/json body (ES-compatible NDJSON)."""
    return client.post(
        "_bulk",
        data=body,
        headers={"Content-Type": "application/json"},
    )


def test_bulk_valid_payload_returns_no_errors(
    client: OpenObserveClient, temp_stream_name: str
):
    """A valid bulk request returns 200 with `errors: false` in the body."""
    bulk_body = (
        f'{{ "index" : {{ "_index" : "{temp_stream_name}", "_id" : "1" }} }}\n'
        '{ "field1" : "value1" }\n'
        f'{{ "index" : {{ "_index" : "{temp_stream_name}", "_id" : "2" }} }}\n'
        '{ "field1" : "value2" }'
    )
    resp = _bulk_post(client, bulk_body)

    assert resp.status_code == 200, f"bulk POST failed: {resp.status_code} {resp.text}"
    body = resp.json()
    assert body.get("errors") is False, \
        f"valid bulk request should have errors=false, got: {body}"
    # Per-item statuses should all be 2xx
    items = body.get("items") or []
    assert len(items) == 2, f"expected 2 items in response, got {len(items)}: {items}"
    for i, item in enumerate(items):
        index_result = item.get("index", {})
        status = index_result.get("status")
        assert status is not None, f"item {i} missing status: {item}"
        assert 200 <= status < 300, f"item {i} should have a 2xx status, got {status}: {item}"


def test_bulk_empty_index_name_returns_errors_true(client: OpenObserveClient):
    """Bulk request with an empty `_index` returns 200 but with `errors: true`.

    OO's bulk API follows ES convention: per-item failures don't change the
    overall HTTP status. The caller must check `errors` and per-item statuses.
    """
    bulk_payload = [
        {"index": {"_index": ""}},  # empty index name
        {"field1": "value1"},
    ]
    bulk_body = "\n".join(json.dumps(item) for item in bulk_payload)
    resp = _bulk_post(client, bulk_body)

    assert resp.status_code == 200, f"bulk POST failed: {resp.status_code} {resp.text}"
    body = resp.json()
    assert body.get("errors") is True, \
        f"bulk request with empty _index should have errors=true, got: {body}"


def test_bulk_invalid_index_name_is_silently_sanitized(client: OpenObserveClient):
    """Bulk request with a disallowed `_index` value (e.g. '****') is silently
    sanitized to `_` and accepted — surprising behavior we document here.

    The original suite had this test but a variable-name typo
    (`valid_bulk_payload` reused on the POST instead of `invalid_bulk_payload3`)
    silently made it a duplicate of the valid case. The rewrite executes the
    intended invalid payload and finds that:

    - HTTP 200 with `errors: false`
    - The per-item response shows `_index: '_'` (disallowed chars stripped)
    - No warning/error field
    - Records DO actually ingest into the sanitized stream (verified via search)

    This is a footgun: a client sending bad data won't know their records
    landed in a different index. Worth flagging to the backend team. For now
    the test asserts the observed behavior so any future change (rejection,
    warning field, or data being silently dropped) shows up as a test
    failure rather than a silent regression.
    """
    bulk_body = (
        '{ "index" : { "_index" : "****", "_id" : "1" } }\n'
        '{ "field1" : "value1_for_sanitization_test" }\n'
        '{ "index" : { "_index" : "****", "_id" : "2" } }\n'
        '{ "field1" : "value2_for_sanitization_test" }'
    )
    resp = _bulk_post(client, bulk_body)
    assert resp.status_code == 200, f"bulk POST failed: {resp.status_code} {resp.text}"

    body = resp.json()
    # Observed behavior: silent sanitization.
    assert body.get("errors") is False, \
        f"observed: API silently sanitizes invalid index — if it now flags errors, update this test: {body}"

    # Verify the sanitization actually happened — _index in response is not '****'.
    items = body.get("items") or []
    assert len(items) >= 1, f"expected at least 1 item, got: {body}"
    sanitized_index = items[0].get("index", {}).get("_index")
    assert sanitized_index != "****", \
        f"_index should be sanitized away from '****', got: {sanitized_index}"
    logger.info(
        "Bulk API silently sanitized _index '****' -> %r (likely backend bug)",
        sanitized_index,
    )

    # Verify the records actually landed in the sanitized index (not silently
    # dropped). Poll the search endpoint until both records become visible,
    # since ingestion-to-search-visible has indexing latency.
    def _records_visible() -> bool:
        hits = client.search.hits(
            f'SELECT field1 FROM "{sanitized_index}" '
            "WHERE field1 LIKE 'value%_for_sanitization_test'",
            minutes=10,
            size=10,
        )
        return len(hits) >= 2

    try:
        wait_until(
            _records_visible,
            timeout=30,
            interval=1.0,
            msg=(
                f"after silent sanitization to {sanitized_index!r}, expected "
                f"2 records to be searchable but never became visible — "
                f"backend may be silently DROPPING data rather than just renaming"
            ),
        )
    finally:
        # Best-effort cleanup: delete the sanitized stream so it doesn't
        # accumulate across runs.
        try:
            client.streams.delete(sanitized_index)
        except Exception as e:
            logger.warning("cleanup failed for sanitized stream %s: %s", sanitized_index, e)
