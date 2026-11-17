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
import time
from collections.abc import Generator

import pytest

from support.client import OpenObserveClient
from support.factories import unique_name
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


# ----- openobserve#15716: response items follow request order across columnar and fallback rows -----

OLD_TIMESTAMP_US = 1577836800000000  # 2020-01-01, older than any ingest window


@pytest.fixture
def two_seeded_streams(client: OpenObserveClient) -> Generator[tuple[str, str], None, None]:
    """Two streams whose schema is `_id, _timestamp, a, n`, so conforming rows can take the columnar plan."""
    streams = (unique_name("bulk_order_a"), unique_name("bulk_order_b"))
    seed = [line for s in streams for line in (_action(s, f"seed_{s}"), {"a": f"seed_{s}", "n": 0})]

    def _schemas_cached() -> bool:
        return all({"a", "n"} <= {f["name"] for f in client.streams.schema(s).get("schema", [])} for s in streams)

    try:
        resp = _bulk_post(client, _ndjson(seed))
        assert resp.status_code == 200, resp.text
        assert resp.json().get("errors") is False, resp.text
        wait_until(_schemas_cached, timeout=30, interval=1.0, msg="seeded stream schemas never appeared")
        yield streams
    finally:
        for s in streams:
            try:
                client.streams.delete(s)
            except Exception as e:
                logger.warning("cleanup failed for stream %s: %s", s, e)


def _action(stream: str, doc_id: str) -> dict:
    return {"index": {"_index": stream, "_id": doc_id}}


def _ndjson(lines: list) -> str:
    return "\n".join(json.dumps(line) for line in lines) + "\n"


def _post_and_check_order(client: OpenObserveClient, rows: list[tuple[dict, object, int, str | None]]) -> list[dict]:
    """POST one `_bulk` of (action, data, status, error type) rows; assert item i answers action i."""
    resp = _bulk_post(client, _ndjson([line for action, data, _, _ in rows for line in (action, data)]))
    assert resp.status_code == 200, resp.text
    items = resp.json().get("items") or []
    assert len(items) == len(rows), f"{len(rows)} actions answered by {len(items)} items: {items}"
    for i, (item, (action, _, status, error_type)) in enumerate(zip(items, rows, strict=True)):
        result = item["index"]
        assert result.get("_id") == action["index"]["_id"], f"item {i} answers {result.get('_id')!r}: {items}"
        assert result.get("_index") == action["index"]["_index"], f"item {i}: {result}"
        assert result.get("status") == status, f"item {i}: {result}"
        assert (result.get("error") or {}).get("type") == error_type, f"item {i}: {result}"
    return items


def _stored_ids_by_body(client: OpenObserveClient, stream: str) -> dict[str, str]:
    hits = client.search.hits(f'SELECT _id, a FROM "{stream}"', minutes=60, size=200)
    return {h["_id"]: h.get("a") for h in hits}


def _stored_once_complete(client: OpenObserveClient, stream: str, want: set[str]) -> dict[str, str] | None:
    stored = _stored_ids_by_body(client, stream)
    return stored if want <= stored.keys() else None


def test_bulk_mixed_columnar_and_fallback_items_follow_request_order(
    client: OpenObserveClient, two_seeded_streams: tuple[str, str]
):
    """openobserve#15716: columnar rows, fallback rows and per-row errors in one body keep their request slots."""
    a, b = two_seeded_streams
    now_us = int(time.time() * 1_000_000)
    rows = [
        (_action(a, "m00"), {"a": "m00", "n": 1}, 200, None),
        (_action(a, "m01"), {"a": "m01", "n": 2, "brand_new_col": "x"}, 200, None),
        (_action(a, "m02"), {"a": "m02", "n": 3}, 200, None),
        (_action(a, "m03"), [1, 2, 3], 422, "schema_conformance_failed"),
        (_action(a, "m04"), {"a": "m04", "n": 5}, 200, None),
        (_action(a, "m05"), {"a": "m05", "n": "not-a-number"}, 200, None),
        (_action(a, "m06"), {"a": "m06", "n": 7, "_timestamp": OLD_TIMESTAMP_US}, 422, "timestamp_parsing_failed"),
        (_action(b, "m07"), {"a": "m07", "n": 8}, 200, None),
        (_action(a, "m08"), {"a": "m08", "n": 9}, 200, None),
        (_action(b, "m09"), {"a": "m09", "n": 10, "other_new": 1}, 200, None),
        (_action(a, "m10"), {"a": "m10", "n": 11, "_timestamp": now_us}, 200, None),
        (_action(a, "m11"), {"a": "m11", "n": 12, "brand_new_col": "y"}, 200, None),
        (_action(a, "m12"), {"a": "m12", "n": 13}, 200, None),
    ]
    resp_items = _post_and_check_order(client, rows)
    assert len(resp_items) == 13

    expected = {
        a: {f"m{i:02d}" for i in (0, 1, 2, 4, 5, 8, 10, 11, 12)},
        b: {"m07", "m09"},
    }
    for stream, ids in expected.items():
        stored = wait_until(
            lambda s=stream, want=ids: _stored_once_complete(client, s, want),
            timeout=60, interval=2.0, msg=f"accepted rows never became searchable in {stream}",
        )
        assert {i: stored[i] for i in ids} == {i: i for i in ids}, f"a row is stored under another row's _id: {stored}"
        assert not {"m03", "m06"} & stored.keys(), f"a refused row was stored: {stored}"


@pytest.mark.parametrize(
    "extra_field", [False, True], ids=["all-columnar", "all-fallback"],
)
def test_bulk_single_path_batch_keeps_request_order(
    client: OpenObserveClient, two_seeded_streams: tuple[str, str], extra_field: bool
):
    """Control for #15716: a batch that takes only one ingest path answers in request order too."""
    a, _ = two_seeded_streams
    tag = "cv" if extra_field else "cc"
    rows = [
        (_action(a, f"{tag}{i}"), {"a": f"{tag}{i}", "n": i, **({f"extra{i}": "x"} if extra_field else {})}, 200, None)
        for i in range(5)
    ]
    _post_and_check_order(client, rows)
