"""JavaScript `#ResultArray#` function tests against /functions/test endpoint.

Rewritten in Phase 4 of the api-tests revamp:
- Discovered all 8 original tests were `@pytest.mark.skip("Temporarily
  disabled - failing test")` for the WRONG reason. The actual reason
  they failed: JS functions are restricted to the `_meta` organization
  (OO returns 400 in any other org). The originals POSTed to `default`.
- Switching to `org='_meta'` unskips all 8 — they actually work.
- Body validation already decent in the originals (asserting filter
  counts, enrichment fields, etc.) — kept and tightened.
"""
from __future__ import annotations

import logging

from support.client import OpenObserveClient

logger = logging.getLogger(__name__)

JS_META_ORG = "_meta"

# Standard #ResultArray# filter function used by 2 tests.
FILTER_GT_50 = """#ResultArray#
var filtered = [];
for (var i = 0; i < rows.length; i++) {
  if (rows[i].newdata > 50) { filtered.push(rows[i]); }
}
rows.length = 0;
for (var i = 0; i < filtered.length; i++) { rows.push(filtered[i]); }"""


def _test_js(client: OpenObserveClient, function: str, events: list[dict]) -> dict:
    """POST the JS function to /functions/test (in _meta) and return the body."""
    resp = client.post(
        "functions/test",
        json={"function": function, "events": events, "trans_type": 1},
        org=JS_META_ORG,
    )
    assert resp.status_code == 200, \
        f"JS function failed: {resp.status_code} {resp.text}"
    return resp.json()


# ----- filter: all rows out -----


def test_result_array_filter_drops_all_rows_when_none_match(client: OpenObserveClient):
    """#ResultArray# filter where the predicate matches NO rows returns 0 results."""
    events = [{"newdata": 10}] * 10  # all 10, none > 50
    body = _test_js(client, FILTER_GT_50, events)

    results = body.get("results", [])
    assert results == [], f"expected 0 results (all filtered), got {len(results)}: {results}"


# ----- filter: mixed -----


def test_result_array_filter_keeps_only_matching_rows(client: OpenObserveClient):
    """#ResultArray# filter passes exactly the rows matching the predicate, in input order."""
    events = [
        {"newdata": 10, "name": "filtered_out_1"},
        {"newdata": 60, "name": "pass_1"},
        {"newdata": 20, "name": "filtered_out_2"},
        {"newdata": 70, "name": "pass_2"},
        {"newdata": 30, "name": "filtered_out_3"},
        {"newdata": 80, "name": "pass_3"},
        {"newdata": 40, "name": "filtered_out_4"},
        {"newdata": 90, "name": "pass_4"},
        {"newdata": 50, "name": "filtered_out_5"},  # 50 is not > 50
        {"newdata": 100, "name": "pass_5"},
    ]
    body = _test_js(client, FILTER_GT_50, events)
    results = body.get("results", [])

    assert len(results) == 5, f"expected 5 results, got {len(results)}: {results}"

    passed_names = [r["event"]["name"] for r in results]
    assert passed_names == ["pass_1", "pass_2", "pass_3", "pass_4", "pass_5"], \
        f"order/identity mismatch: {passed_names}"

    passed_values = [r["event"]["newdata"] for r in results]
    assert passed_values == [60, 70, 80, 90, 100], f"values mismatch: {passed_values}"


# ----- enrichment: add fields to every row -----


def test_result_array_enriches_each_row_with_batch_stats(client: OpenObserveClient):
    """#ResultArray# can add fields to every row using batch-wide values (batch_size, index)."""
    function = """#ResultArray#
var total = rows.length;
for (var i = 0; i < rows.length; i++) {
  rows[i].batch_size = total;
  rows[i].index = i;
  rows[i].processed = true;
}"""
    events = [{"id": 1, "value": 100}, {"id": 2, "value": 200}, {"id": 3, "value": 300}]
    body = _test_js(client, function, events)
    results = body.get("results", [])

    assert len(results) == 3, f"expected 3 results, got {len(results)}"
    for i, result in enumerate(results):
        event = result["event"]
        assert event["batch_size"] == 3, f"row {i}: expected batch_size=3, got {event.get('batch_size')}"
        assert event["index"] == i, f"row {i}: expected index={i}, got {event.get('index')}"
        assert event["processed"] is True, f"row {i}: expected processed=true, got {event.get('processed')}"


# ----- expansion: 1 input row -> N output rows -----


def test_result_array_can_expand_one_row_into_many(client: OpenObserveClient):
    """#ResultArray# can replace `rows` with a longer list (fanout pattern)."""
    function = """#ResultArray#
if (rows.length > 0) {
  var firstRow = rows[0];
  rows.length = 0;
  for (var i = 0; i < 3; i++) {
    var newRow = {};
    for (var key in firstRow) { newRow[key] = firstRow[key]; }
    newRow.index = i;
    newRow.expanded = true;
    rows.push(newRow);
  }
}"""
    body = _test_js(client, function, [{"name": "test", "value": 100}])
    results = body.get("results", [])

    assert len(results) == 3, f"expected 1 row expanded to 3, got {len(results)}"
    for i, result in enumerate(results):
        event = result["event"]
        assert event["name"] == "test"
        assert event["value"] == 100
        assert event["index"] == i
        assert event["expanded"] is True


# ----- edge case: empty input -----


def test_result_array_with_empty_input_returns_empty_results(client: OpenObserveClient):
    """#ResultArray# on an empty events list returns an empty results list."""
    function = """#ResultArray#
for (var i = 0; i < rows.length; i++) { rows[i].processed = true; }"""
    body = _test_js(client, function, [])

    results = body.get("results", [])
    assert results == [], f"empty input should yield empty results, got: {results}"


# ----- regular (non-ResultArray) JS function -----


def test_regular_js_function_processes_each_row_individually(client: OpenObserveClient):
    """Regular JS function (no #ResultArray# marker) operates per-row via `row` not `rows`."""
    function = """row.processed = true;
row.doubled = (row.value || 0) * 2;"""
    events = [{"value": 10}, {"value": 20}, {"value": 30}]
    body = _test_js(client, function, events)

    results = body.get("results", [])
    assert len(results) == 3, f"expected 3 results, got {len(results)}"

    expected_doubled = [20, 40, 60]
    for i, result in enumerate(results):
        event = result["event"]
        assert event["processed"] is True, f"row {i}: not processed"
        assert event["doubled"] == expected_doubled[i], \
            f"row {i}: expected doubled={expected_doubled[i]}, got {event.get('doubled')}"


# ----- aggregation: sum/avg across all rows -----


def test_result_array_aggregation_sum_and_avg_across_rows(client: OpenObserveClient):
    """#ResultArray# computes batch_sum/batch_avg/batch_count once and writes to every row."""
    function = """#ResultArray#
var sum = 0;
for (var i = 0; i < rows.length; i++) { sum += rows[i].value || 0; }
var avg = sum / rows.length;
for (var i = 0; i < rows.length; i++) {
  rows[i].batch_sum = sum;
  rows[i].batch_avg = avg;
  rows[i].batch_count = rows.length;
}"""
    events = [{"value": 100}, {"value": 200}, {"value": 300}]
    body = _test_js(client, function, events)

    results = body.get("results", [])
    assert len(results) == 3, f"expected 3 results, got {len(results)}"

    for result in results:
        event = result["event"]
        assert event["batch_sum"] == 600, f"expected batch_sum=600, got {event.get('batch_sum')}"
        assert event["batch_avg"] == 200, f"expected batch_avg=200, got {event.get('batch_avg')}"
        assert event["batch_count"] == 3, f"expected batch_count=3, got {event.get('batch_count')}"


# ----- explicit trans_type=1 requirement -----


def test_result_array_with_explicit_js_trans_type(client: OpenObserveClient):
    """#ResultArray# marker is ambiguous (VRL or JS); trans_type=1 disambiguates as JS."""
    function = """#ResultArray#
for (var i = 0; i < rows.length; i++) { rows[i].explicitly_typed = true; }"""
    body = _test_js(client, function, [{"id": 1}, {"id": 2}])

    results = body.get("results", [])
    assert len(results) == 2, f"expected 2 results, got {len(results)}"
    for result in results:
        assert result["event"].get("explicitly_typed") is True, \
            f"expected explicitly_typed=true, got: {result['event']}"
