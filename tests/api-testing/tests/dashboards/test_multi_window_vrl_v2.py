# Copyright 2026 OpenObserve Inc.
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with this program.  If not, see <http://www.gnu.org/licenses/>.

"""
API tests for dashboard multi-window (Comparison Against) with VRL #ResultArray# functions.

Validates the fix from PR #10858: when a #ResultArray# VRL function is used
as query_fn alongside the "Comparison Against" (time_shift / multi-window)
feature with per_query_response=true, the API should:

1. Buffer results from all queries (post-hoc VRL path)
2. Apply the VRL function to the combined 2D result array
3. Return fields computed by the VRL function (e.g., diff, diff_percentage)

Previously, VRL was applied per-query so #ResultArray# never received the
combined results, causing "No Data" and missing fields in the UI.

Tests use the _search_multi_stream (SSE) endpoint which is what the dashboard
frontend actually calls for multi-window queries.
"""

import pytest
import time
import json
import base64
import logging

logger = logging.getLogger(__name__)

ORG_ID = "default"
STREAM_NAME = "stream_pytest_data"


def b64_encode_url(text):
    """Base64 URL-safe encode a string (matching Rust encode_url convention).

    The backend's decode_url expects '.' in place of '=' padding and uses
    '-'/'_' for URL-safe characters. Python's urlsafe_b64encode already
    uses '-'/'_', so we only need to replace '=' with '.'.
    """
    encoded = base64.urlsafe_b64encode(text.encode("utf-8")).decode("utf-8")
    return encoded.replace("=", ".")


# VRL function that computes diff and diff_percentage from multi-window results.
# This mimics the real-world usage shown in the dashboard UI.
VRL_RESULT_ARRAY_DIFF = """#ResultArray#
prev_data = []
curr_data = []
res = []
result = array!(.)

# Handle null check and array access
if length(result) >= 2 {
    today_data = result[0]
    prev_data_raw = result[1]

    today_arr = array!(today_data)
    prev_arr = array!(prev_data_raw)

    for_each(today_arr) -> |_idx, row| {
        curr_row = object!(row)
        x_val = curr_row.x_axis_1
        cnt_val = to_float!(curr_row.cnt)
        prev_cnt = 0.0

        for_each(prev_arr) -> |_pidx, prev_row| {
            p = object!(prev_row)
            if p.x_axis_1 == x_val {
                prev_cnt = to_float!(p.cnt)
            }
        }

        diff_val = cnt_val - prev_cnt
        diff_pct, err = if prev_cnt != 0.0 {
            (diff_val / prev_cnt) * 100.0
        } else {
            0.0
        }

        res = push(res, {
            "x_axis_1": x_val,
            "cnt": cnt_val,
            "diff": diff_val,
            "diff_percentage": diff_pct
        })
    }

    . = [res]
} else if length(result) == 1 {
    . = [array!(result[0])]
} else {
    . = []
}
"""


def _get_wide_time_range():
    """Return a wide time range (2 hours) to ensure we capture ingested test data."""
    end_time = int(time.time() * 1000000)  # microseconds
    start_time = end_time - (2 * 60 * 60 * 1000000)  # 2 hours ago
    return start_time, end_time


def _build_histogram_sql():
    """Build the standard histogram SQL query used across tests."""
    return (
        f'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "cnt" '
        f'FROM "{STREAM_NAME}" GROUP BY x_axis_1 ORDER BY x_axis_1 ASC'
    )


def _parse_sse_response(content):
    """Parse SSE (Server-Sent Events) response into list of (event_type, data) tuples."""
    events = []
    lines = content.split("\n")
    current_event = None

    for line in lines:
        if line.startswith("event: "):
            current_event = line[7:].strip()
        elif line.startswith("data: ") and current_event:
            data_str = line[6:]
            try:
                data = json.loads(data_str)
                events.append((current_event, data))
            except json.JSONDecodeError:
                logger.warning(f"Failed to parse SSE data: {data_str[:200]}")
            current_event = None

    return events


def _assert_sse_response_valid(resp):
    """Assert that an SSE response is valid and return parsed events.

    Skips the test if the endpoint returns 404 (not available in this build).
    """
    if resp.status_code == 404:
        pytest.skip(
            "_search_multi_stream endpoint not available in this build "
            "(requires PR #10858 fix)"
        )
    assert resp.status_code == 200, (
        f"Expected 200, got {resp.status_code}. Response: {resp.text[:500]}"
    )
    content = resp.text
    assert len(content) > 0, "SSE response should not be empty"
    assert "event:" in content or "data:" in content, (
        "Response should be SSE format with 'event:' or 'data:' markers"
    )
    return _parse_sse_response(content)


def _build_multi_stream_payload(sql_queries, query_fn=None, start_time=None,
                                end_time=None, per_query_response=False):
    """Build a _search_multi_stream request payload."""
    payload = {
        "sql": sql_queries,
        "start_time": start_time,
        "end_time": end_time,
        "from": 0,
        "size": -1,
    }
    if query_fn:
        payload["query_fn"] = query_fn
        payload["uses_zo_fn"] = True
    if per_query_response:
        payload["per_query_response"] = True
    return payload


# =============================================================================
# Tests covering the bug scenario from PR #10858
# Bug: #ResultArray# VRL returned an object instead of an array, causing
# "Invalid response format: Expected an array, but received an object"
# =============================================================================


def test_search_multi_vrl_result_array_returns_computed_fields(create_session, base_url):
    """Test _search_multi_stream (SSE) with #ResultArray# VRL + per_query_response.

    This covers the core bug scenario from PR #10858: when using
    _search_multi_stream with per_query_response=true and a #ResultArray#
    VRL function, the VRL must receive the combined 2D array
    [[q1_rows], [q2_rows]] and return VRL-computed fields (diff, diff_percentage).

    Before the fix, VRL was applied per-query so #ResultArray# only saw a
    single query's flat results, causing it to fail or skip the diff logic.
    """
    session = create_session
    start_time, end_time = _get_wide_time_range()
    sql_query = _build_histogram_sql()
    encoded_vrl = b64_encode_url(VRL_RESULT_ARRAY_DIFF)

    payload = _build_multi_stream_payload(
        sql_queries=[
            {"sql": sql_query, "start_time": start_time, "end_time": end_time},
            {"sql": sql_query, "start_time": start_time, "end_time": end_time},
        ],
        query_fn=encoded_vrl,
        start_time=start_time,
        end_time=end_time,
        per_query_response=True,
    )

    url = f"{base_url}api/{ORG_ID}/_search_multi_stream"
    params = {"type": "logs", "search_type": "dashboards", "use_cache": "false"}

    resp = session.post(url, params=params, json=payload)
    events = _assert_sse_response_valid(resp)

    hits_events = [e for e in events if e[0] == "search_response_hits"]
    assert len(hits_events) >= 1, (
        f"Expected at least 1 search_response_hits event, got {len(hits_events)}. "
        f"Events: {[e[0] for e in events]}"
    )

    all_hits = []
    for _, data in hits_events:
        assert isinstance(data, dict), f"SSE data should be dict, got {type(data).__name__}"
        if "hits" in data:
            hits = data["hits"]
            assert isinstance(hits, list), (
                f"hits should be a list (array), got {type(hits).__name__}. "
                "Bug #10858: VRL returned an object instead of array."
            )
            all_hits.extend(hits)

    assert len(all_hits) > 0, "Should have result data"

    first_row = all_hits[0]
    assert isinstance(first_row, dict), (
        f"Row should be a dict, got {type(first_row).__name__}"
    )

    # Core assertion: VRL-computed fields MUST be present (post-fix behavior)
    assert "x_axis_1" in first_row, (
        f"Row should have 'x_axis_1'. Keys: {list(first_row.keys())}"
    )
    assert "cnt" in first_row, (
        f"Row should have 'cnt'. Keys: {list(first_row.keys())}"
    )

    assert "diff" in first_row, (
        f"VRL-computed 'diff' field MUST be present (PR #10858 fix). "
        f"Keys: {list(first_row.keys())}"
    )
    assert "diff_percentage" in first_row, (
        f"VRL-computed 'diff_percentage' field MUST be present (PR #10858 fix). "
        f"Keys: {list(first_row.keys())}"
    )

    # Same time range → diff should be 0 for all rows
    for i, row in enumerate(all_hits):
        if isinstance(row, dict) and "diff" in row:
            assert row["diff"] == 0.0, (
                f"Row {i}: diff should be 0.0 (same time range), got {row['diff']}"
            )
            assert row["diff_percentage"] == 0.0, (
                f"Row {i}: diff_percentage should be 0.0, got {row['diff_percentage']}"
            )

    logger.info(
        f"_search_multi_stream VRL computed fields verified: "
        f"diff={first_row['diff']}, diff_percentage={first_row['diff_percentage']}"
    )


def test_multistream_vrl_response_is_array_not_object(create_session, base_url):
    """Test that #ResultArray# VRL response is always an array, never an object.

    Directly validates the bug symptom from PR #10858:
    "Invalid response format: Expected an array, but received an object.
    Please update your function."

    The VRL function must return an array of rows, not a single object.
    The SSE hits events must contain a list, not a dict of results.
    Each row must include VRL-computed fields (diff, diff_percentage) proving
    that VRL was actually applied to the combined multi-query results.
    """
    session = create_session
    start_time, end_time = _get_wide_time_range()
    sql_query = _build_histogram_sql()
    encoded_vrl = b64_encode_url(VRL_RESULT_ARRAY_DIFF)

    payload = _build_multi_stream_payload(
        sql_queries=[
            {"sql": sql_query, "start_time": start_time, "end_time": end_time},
            {"sql": sql_query, "start_time": start_time, "end_time": end_time},
        ],
        query_fn=encoded_vrl,
        start_time=start_time,
        end_time=end_time,
        per_query_response=True,
    )

    url = f"{base_url}api/{ORG_ID}/_search_multi_stream"
    params = {"type": "logs", "search_type": "dashboards", "use_cache": "false"}

    resp = session.post(url, params=params, json=payload)
    events = _assert_sse_response_valid(resp)

    hits_events = [e for e in events if e[0] == "search_response_hits"]
    assert len(hits_events) >= 1, (
        f"Expected at least 1 hits event, got {len(hits_events)}"
    )

    all_hits = []
    for idx, (_, data) in enumerate(hits_events):
        # The SSE data envelope should be a dict with "hits" key
        assert isinstance(data, dict), (
            f"SSE event {idx}: data should be a dict envelope, got {type(data).__name__}"
        )
        assert "hits" in data, (
            f"SSE event {idx}: data should have 'hits' key. Keys: {list(data.keys())}"
        )

        hits = data["hits"]
        # CRITICAL: hits must be a list (array), NOT a dict (object)
        # This was the exact bug: VRL returned an object instead of array
        assert isinstance(hits, list), (
            f"SSE event {idx}: hits MUST be an array (list), got {type(hits).__name__}. "
            "This is the bug from PR #10858: 'Expected an array, but received an object.'"
        )

        # Each row in hits must be a dict (individual record), not a nested array
        for row_idx, row in enumerate(hits):
            assert isinstance(row, dict), (
                f"SSE event {idx}, row {row_idx}: each row should be a dict, "
                f"got {type(row).__name__}"
            )
        all_hits.extend(hits)

    assert len(all_hits) > 0, "Should have data rows"

    # Verify VRL-computed fields are present in every row
    # This ensures VRL was actually applied (not just raw SQL results passing through)
    expected_fields = {"x_axis_1", "cnt", "diff", "diff_percentage"}
    for i, row in enumerate(all_hits):
        row_keys = set(row.keys())
        missing = expected_fields - row_keys
        assert not missing, (
            f"Row {i}: missing VRL-computed fields {missing}. "
            f"Got keys: {list(row.keys())}. "
            "PR #10858 fix should ensure #ResultArray# VRL fields appear."
        )

    logger.info(
        f"Response format validated: all {len(hits_events)} hits events "
        f"contain array (list) of dict rows with VRL-computed fields"
    )


def test_multistream_vrl_strict_computed_fields(create_session, base_url):
    """Strict test: VRL-computed fields MUST appear in SSE response after PR #10858 fix.

    Unlike test_multistream_vrl_result_array_with_time_shift which is lenient
    (allows pre-fix behavior), this test strictly requires that the diff and
    diff_percentage fields are present in every row of the response.
    """
    session = create_session
    start_time, end_time = _get_wide_time_range()
    sql_query = _build_histogram_sql()
    encoded_vrl = b64_encode_url(VRL_RESULT_ARRAY_DIFF)

    payload = _build_multi_stream_payload(
        sql_queries=[
            {"sql": sql_query, "start_time": start_time, "end_time": end_time},
            {"sql": sql_query, "start_time": start_time, "end_time": end_time},
        ],
        query_fn=encoded_vrl,
        start_time=start_time,
        end_time=end_time,
        per_query_response=True,
    )

    url = f"{base_url}api/{ORG_ID}/_search_multi_stream"
    params = {"type": "logs", "search_type": "dashboards", "use_cache": "false"}

    resp = session.post(url, params=params, json=payload)
    events = _assert_sse_response_valid(resp)

    hits_events = [e for e in events if e[0] == "search_response_hits"]
    assert len(hits_events) >= 1, "Expected at least 1 hits event"

    all_hits = []
    for _, data in hits_events:
        if "hits" in data:
            all_hits.extend(data["hits"])

    assert len(all_hits) > 0, "Should have data rows"

    # Strict: EVERY row must have all 4 expected fields
    expected_fields = {"x_axis_1", "cnt", "diff", "diff_percentage"}
    for i, row in enumerate(all_hits):
        row_keys = set(row.keys())
        missing = expected_fields - row_keys
        assert not missing, (
            f"Row {i}: missing VRL-computed fields {missing}. "
            f"Got keys: {list(row.keys())}. "
            "PR #10858 fix should ensure #ResultArray# VRL fields appear."
        )

    # Same time range → all diffs should be exactly 0.0
    for i, row in enumerate(all_hits):
        assert row["diff"] == 0.0, (
            f"Row {i}: diff should be 0.0 (identical time ranges), got {row['diff']}"
        )
        assert row["diff_percentage"] == 0.0, (
            f"Row {i}: diff_percentage should be 0.0, got {row['diff_percentage']}"
        )

    logger.info(
        f"Strict VRL fields check passed: {len(all_hits)} rows all have "
        f"{expected_fields}"
    )


def test_multistream_vrl_three_time_windows(create_session, base_url):
    """Test #ResultArray# VRL with 3 time-shifted queries (multi-window edge case).

    Validates that the post-hoc VRL path works when more than 2 queries are
    sent. The VRL receives [[q1_rows], [q2_rows], [q3_rows]] but only
    processes the first 2 (today vs previous). The 3rd window should not
    cause errors or data corruption.
    """
    session = create_session
    start_time, end_time = _get_wide_time_range()
    sql_query = _build_histogram_sql()
    encoded_vrl = b64_encode_url(VRL_RESULT_ARRAY_DIFF)

    payload = _build_multi_stream_payload(
        sql_queries=[
            {"sql": sql_query, "start_time": start_time, "end_time": end_time},
            {"sql": sql_query, "start_time": start_time, "end_time": end_time},
            {"sql": sql_query, "start_time": start_time, "end_time": end_time},
        ],
        query_fn=encoded_vrl,
        start_time=start_time,
        end_time=end_time,
        per_query_response=True,
    )

    url = f"{base_url}api/{ORG_ID}/_search_multi_stream"
    params = {"type": "logs", "search_type": "dashboards", "use_cache": "false"}

    resp = session.post(url, params=params, json=payload)
    events = _assert_sse_response_valid(resp)

    # Should not have error events
    error_events = [e for e in events if "error" in e[0].lower()]
    assert len(error_events) == 0, (
        f"3-window query should not produce errors: {error_events}"
    )

    hits_events = [e for e in events if e[0] == "search_response_hits"]
    assert len(hits_events) >= 1, "Should have at least 1 hits event"

    all_hits = []
    for _, data in hits_events:
        if "hits" in data:
            hits = data["hits"]
            assert isinstance(hits, list), (
                f"hits must be array, got {type(hits).__name__}"
            )
            all_hits.extend(hits)

    assert len(all_hits) > 0, "3-window VRL query should return data"

    first_row = all_hits[0]

    # VRL processes indices 0 and 1, so all 4 fields MUST be present
    expected_fields = {"x_axis_1", "cnt", "diff", "diff_percentage"}
    row_keys = set(first_row.keys())
    missing = expected_fields - row_keys
    assert not missing, (
        f"Row 0: missing VRL-computed fields {missing}. "
        f"Got keys: {list(first_row.keys())}. "
        "PR #10858 fix should ensure #ResultArray# VRL fields appear "
        "even with 3 time windows."
    )

    # diff should be numeric
    assert isinstance(first_row["diff"], (int, float)), (
        f"diff should be numeric, got {type(first_row['diff']).__name__}"
    )
    assert isinstance(first_row["diff_percentage"], (int, float)), (
        f"diff_percentage should be numeric, got {type(first_row['diff_percentage']).__name__}"
    )

    logger.info(
        f"3-window VRL query: {len(hits_events)} hits events, "
        f"{len(all_hits)} total rows, keys: {list(first_row.keys())}"
    )


def test_multistream_vrl_invalid_function_returns_error_gracefully(create_session, base_url):
    """Test that an invalid #ResultArray# VRL function returns a graceful error.

    Before the fix, invalid VRL could cause crashes or unexpected response
    formats. After the fix, VRL compilation errors should be reported
    gracefully via function_error in the response metadata.
    """
    session = create_session
    start_time, end_time = _get_wide_time_range()
    sql_query = _build_histogram_sql()

    # Intentionally broken VRL: undefined function call
    invalid_vrl = """#ResultArray#
result = array!(.)
. = undefined_function_that_does_not_exist(result)
"""
    encoded_vrl = b64_encode_url(invalid_vrl)

    payload = _build_multi_stream_payload(
        sql_queries=[
            {"sql": sql_query, "start_time": start_time, "end_time": end_time},
            {"sql": sql_query, "start_time": start_time, "end_time": end_time},
        ],
        query_fn=encoded_vrl,
        start_time=start_time,
        end_time=end_time,
        per_query_response=True,
    )

    url = f"{base_url}api/{ORG_ID}/_search_multi_stream"
    params = {"type": "logs", "search_type": "dashboards", "use_cache": "false"}

    resp = session.post(url, params=params, json=payload)

    # Skip if endpoint not available in this build
    if resp.status_code == 404:
        pytest.skip(
            "_search_multi_stream endpoint not available in this build "
            "(requires PR #10858 fix)"
        )

    # The API should not crash (500). It should return 200 with error info
    # or a structured error response
    assert resp.status_code in [200, 400], (
        f"Invalid VRL should not cause 500. Got {resp.status_code}: {resp.text[:500]}"
    )

    if resp.status_code == 200:
        # SSE response: check for error indication in events
        events = _parse_sse_response(resp.text)
        logger.info(
            f"Invalid VRL SSE events: {[(e[0], list(e[1].keys()) if isinstance(e[1], dict) else type(e[1]).__name__) for e in events]}"
        )

        # Should still have some events (metadata at minimum)
        assert len(events) >= 1, "Should have at least 1 SSE event even with invalid VRL"

        # Check if function_error is reported in metadata
        metadata_events = [e for e in events if e[0] == "search_response_metadata"]
        for _, data in metadata_events:
            if "results" in data and "function_error" in data["results"]:
                fn_error = data["results"]["function_error"]
                logger.info(f"VRL compilation error reported: {fn_error}")
                assert len(fn_error) > 0, "function_error should contain error details"
    else:
        # 400 response: should have error message
        body = resp.json()
        logger.info(f"Invalid VRL returned 400: {body}")

    logger.info("Invalid VRL handled gracefully without server crash")
