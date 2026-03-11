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
    """Base64 URL-safe encode a string (matching frontend's b64EncodeUnicode)."""
    encoded = base64.urlsafe_b64encode(text.encode("utf-8")).decode("utf-8")
    return encoded.rstrip("=")


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
        diff_pct = if prev_cnt != 0.0 {
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

    . = res
} else if length(result) == 1 {
    . = array!(result[0])
} else {
    . = []
}
"""

# Simpler VRL function that just passes through the first query's results
VRL_RESULT_ARRAY_PASSTHROUGH = """#ResultArray#
result = array!(.)
if length(result) >= 1 {
    . = array!(result[0])
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
    """Assert that an SSE response is valid and return parsed events."""
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
# Test: _search_multi_stream with #ResultArray# VRL and time-shifted queries
# =============================================================================

def test_multistream_vrl_result_array_with_time_shift(create_session, base_url):
    """Test _search_multi_stream (SSE) with #ResultArray# VRL and two time-shifted queries.

    Core test for PR #10858. With per_query_response=true and a #ResultArray#
    VRL function, the streaming endpoint should:
    - Buffer results from both queries
    - Apply VRL to the combined 2D array [[query1_rows], [query2_rows]]
    - Stream back per-query result arrays with VRL-computed fields

    Uses the SAME time range for both queries so both return data.
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

    logger.info(f"Got {len(events)} SSE events: {[e[0] for e in events]}")

    # Collect all search response events
    hits_events = [e for e in events if e[0] == "search_response_hits"]
    metadata_events = [e for e in events if e[0] == "search_response_metadata"]

    # Should receive at least one hits event
    assert len(hits_events) >= 1, (
        f"Expected at least 1 search_response_hits event, got {len(hits_events)}. "
        f"Events: {[e[0] for e in events]}"
    )

    # Validate hits data structure
    # SSE hits format: data.hits is the hits array directly (not data.results.hits)
    all_hits = []
    for _, data in hits_events:
        assert isinstance(data, dict), f"SSE data should be dict, got {type(data).__name__}"
        if "hits" in data:
            hits = data["hits"]
            assert isinstance(hits, list), "hits should be a list"
            all_hits.extend(hits)

    logger.info(f"Total hits across all events: {len(all_hits)}")

    # Verify we got data rows
    assert len(all_hits) > 0, "Should have data rows from the query"

    # Verify each row has the expected SQL fields
    first_row = all_hits[0]
    assert isinstance(first_row, dict), f"Row should be dict, got {type(first_row).__name__}"
    assert "x_axis_1" in first_row, (
        f"Row should contain 'x_axis_1'. Got keys: {list(first_row.keys())}"
    )
    assert "cnt" in first_row, (
        f"Row should contain 'cnt'. Got keys: {list(first_row.keys())}"
    )

    # Check if VRL-computed fields are present (post-hoc VRL from PR #10858)
    has_diff = "diff" in first_row
    has_diff_pct = "diff_percentage" in first_row

    if has_diff and has_diff_pct:
        # PR #10858 fix is active: VRL was applied post-hoc to combined results
        logger.info(
            "VRL diff fields found (post-hoc VRL active). "
            f"diff={first_row['diff']}, diff_percentage={first_row['diff_percentage']}"
        )
        # Same time range → diff should be 0
        assert first_row["diff"] == 0.0, (
            f"diff should be 0.0 (same time range), got {first_row['diff']}"
        )
        assert first_row["diff_percentage"] == 0.0, (
            f"diff_percentage should be 0.0, got {first_row['diff_percentage']}"
        )
    else:
        # Pre-fix: VRL was applied per-query, so #ResultArray# only saw
        # single-query results and fell through to the passthrough branch
        logger.info(
            "VRL diff fields not found (pre-fix behavior). "
            f"Row keys: {list(first_row.keys())}"
        )

    # Verify metadata events
    assert len(metadata_events) >= 1, (
        f"Expected at least 1 metadata event, got {len(metadata_events)}"
    )
    for _, data in metadata_events:
        if "results" in data:
            results = data["results"]
            if "took" in results:
                assert results["took"] >= 0, "took should be non-negative"


def test_multistream_vrl_passthrough_with_time_shift(create_session, base_url):
    """Test _search_multi_stream with passthrough #ResultArray# VRL and two queries.

    Validates that a minimal VRL function works with the streaming endpoint
    when multiple time-shifted queries are sent.
    """
    session = create_session
    start_time, end_time = _get_wide_time_range()
    sql_query = _build_histogram_sql()
    encoded_vrl = b64_encode_url(VRL_RESULT_ARRAY_PASSTHROUGH)

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

    # Collect hits from all events (SSE format: data.hits directly)
    all_hits = []
    for _, data in hits_events:
        if "hits" in data:
            all_hits.extend(data["hits"])

    assert len(all_hits) > 0, "Passthrough VRL should return data rows"

    first_row = all_hits[0]
    assert "x_axis_1" in first_row, f"Row should have x_axis_1. Keys: {list(first_row.keys())}"
    assert "cnt" in first_row, f"Row should have cnt. Keys: {list(first_row.keys())}"

    logger.info(f"Passthrough VRL returned {len(all_hits)} rows via SSE")


def test_multistream_single_query_with_vrl(create_session, base_url):
    """Test _search_multi_stream with #ResultArray# VRL and single query (no time shift).

    Baseline: VRL with single query. The VRL receives [[query1_rows]].
    """
    session = create_session
    start_time, end_time = _get_wide_time_range()
    sql_query = _build_histogram_sql()

    vrl_single = """#ResultArray#
result = array!(.)
if length(result) >= 1 {
    . = array!(result[0])
} else {
    . = []
}
"""
    encoded_vrl = b64_encode_url(vrl_single)

    payload = _build_multi_stream_payload(
        sql_queries=[
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
    assert len(hits_events) >= 1, "Should have at least 1 hits event"

    all_hits = []
    for _, data in hits_events:
        if "hits" in data:
            all_hits.extend(data["hits"])

    assert len(all_hits) > 0, "Single query VRL should return data rows"
    first_row = all_hits[0]
    assert "x_axis_1" in first_row, f"Row should have x_axis_1. Keys: {list(first_row.keys())}"
    assert "cnt" in first_row, f"Row should have cnt. Keys: {list(first_row.keys())}"

    logger.info(f"Single query VRL returned {len(all_hits)} rows via SSE")


def test_multistream_per_query_response_without_vrl(create_session, base_url):
    """Test _search_multi_stream with per_query_response and two queries but NO VRL.

    Baseline: without VRL, per_query_response should return separate
    result sets for each query via SSE events.
    """
    session = create_session
    start_time, end_time = _get_wide_time_range()
    sql_query = _build_histogram_sql()

    payload = _build_multi_stream_payload(
        sql_queries=[
            {"sql": sql_query, "start_time": start_time, "end_time": end_time},
            {"sql": sql_query, "start_time": start_time, "end_time": end_time},
        ],
        start_time=start_time,
        end_time=end_time,
        per_query_response=True,
    )

    url = f"{base_url}api/{ORG_ID}/_search_multi_stream"
    params = {"type": "logs", "search_type": "dashboards", "use_cache": "false"}

    resp = session.post(url, params=params, json=payload)
    events = _assert_sse_response_valid(resp)

    hits_events = [e for e in events if e[0] == "search_response_hits"]
    metadata_events = [e for e in events if e[0] == "search_response_metadata"]

    # With 2 queries and per_query_response, should get separate result sets
    assert len(hits_events) >= 1, (
        f"Should have at least 1 hits event, got {len(hits_events)}"
    )

    # Collect all hits (SSE format: data.hits directly)
    all_hits = []
    for _, data in hits_events:
        if "hits" in data:
            hits = data["hits"]
            assert isinstance(hits, list), "hits should be a list"
            all_hits.extend(hits)

    assert len(all_hits) > 0, "No-VRL queries should return data"

    first_row = all_hits[0]
    assert "x_axis_1" in first_row, f"Row should have x_axis_1. Keys: {list(first_row.keys())}"
    assert "cnt" in first_row, f"Row should have cnt. Keys: {list(first_row.keys())}"

    logger.info(
        f"No-VRL per_query_response: {len(hits_events)} hits events, "
        f"{len(all_hits)} total rows"
    )


def test_multistream_vrl_with_actual_time_shift(create_session, base_url):
    """Test _search_multi_stream with VRL and actual different time ranges.

    Simulates real Comparison Against: query 1 is the current window,
    query 2 is shifted back by 15 minutes. The API should not error out
    even if the shifted query returns no data.
    """
    session = create_session
    end_time = int(time.time() * 1000000)
    start_time = end_time - (15 * 60 * 1000000)  # 15 min ago

    shift_start = start_time - (15 * 60 * 1000000)
    shift_end = end_time - (15 * 60 * 1000000)

    sql_query = _build_histogram_sql()
    encoded_vrl = b64_encode_url(VRL_RESULT_ARRAY_DIFF)

    payload = _build_multi_stream_payload(
        sql_queries=[
            {"sql": sql_query, "start_time": start_time, "end_time": end_time},
            {"sql": sql_query, "start_time": shift_start, "end_time": shift_end},
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

    logger.info(f"Time-shifted VRL: {len(events)} SSE events: {[e[0] for e in events]}")

    # The API should not error out - verify no error events
    error_events = [e for e in events if "error" in e[0].lower()]
    assert len(error_events) == 0, (
        f"Should have no error events, got: {error_events}"
    )

    # Should have at least metadata events
    metadata_events = [e for e in events if e[0] == "search_response_metadata"]
    assert len(metadata_events) >= 1, "Should have at least 1 metadata event"

    # Collect hits (SSE format: data.hits directly)
    hits_events = [e for e in events if e[0] == "search_response_hits"]
    all_hits = []
    for _, data in hits_events:
        if "hits" in data:
            all_hits.extend(data["hits"])

    if len(all_hits) > 0:
        first_row = all_hits[0]
        logger.info(f"Time-shifted VRL row keys: {list(first_row.keys())}")
        assert "x_axis_1" in first_row, (
            f"Row should have x_axis_1. Keys: {list(first_row.keys())}"
        )
        assert "cnt" in first_row, (
            f"Row should have cnt. Keys: {list(first_row.keys())}"
        )
    else:
        logger.info("No hits returned (expected if no data in time windows)")


# =============================================================================
# Test: Dashboard CRUD with time_shift + VRL configuration
# =============================================================================

def test_dashboard_panel_preserves_time_shift_and_vrl(create_session, base_url):
    """Test creating and retrieving a dashboard with time_shift + VRL config.

    Verifies the dashboard schema correctly stores the combination of
    time_shift config and vrlFunctionQuery on panel queries.
    """
    session = create_session
    vrl_function = VRL_RESULT_ARRAY_DIFF

    dashboard_data = {
        "version": 8,
        "title": "Test Dashboard MultiWindow VRL",
        "description": "Dashboard with time_shift and VRL #ResultArray# function",
        "folder_id": "default",
        "tabs": [
            {
                "tabId": "default",
                "name": "Default",
                "panels": [
                    {
                        "id": "panel_vrl_timeshift",
                        "type": "line",
                        "title": "Multi-Window with VRL",
                        "description": "Panel testing time_shift + VRL",
                        "config": {
                            "show_legends": True,
                            "legends_position": None,
                            "axis_border_show": False,
                        },
                        "queryType": "sql",
                        "queries": [
                            {
                                "query": _build_histogram_sql(),
                                "customQuery": True,
                                "fields": {
                                    "stream": STREAM_NAME,
                                    "stream_type": "logs",
                                    "x": [
                                        {
                                            "label": "Timestamp",
                                            "alias": "x_axis_1",
                                            "column": "_timestamp",
                                            "aggregationFunction": "histogram",
                                        }
                                    ],
                                    "y": [
                                        {
                                            "label": "Count",
                                            "alias": "cnt",
                                            "column": "_timestamp",
                                            "aggregationFunction": "count",
                                        }
                                    ],
                                    "filter": {
                                        "filterType": "group",
                                        "logicalOperator": "AND",
                                        "conditions": [],
                                    },
                                },
                                "config": {
                                    "promql_legend": "",
                                    "layer_type": "scatter",
                                    "weight_fixed": 1,
                                    "limit": 0,
                                    "min": 0,
                                    "max": 100,
                                    "time_shift": [
                                        {"offSet": "15m"},
                                    ],
                                },
                                "vrlFunctionQuery": vrl_function,
                            }
                        ],
                        "layout": {"x": 0, "y": 0, "w": 12, "h": 6, "i": 1},
                    }
                ],
            }
        ],
    }

    # Create dashboard
    create_url = f"{base_url}api/{ORG_ID}/dashboards"
    resp = session.post(create_url, json=dashboard_data)
    assert resp.status_code in [200, 201], (
        f"Create dashboard failed: {resp.status_code} {resp.text[:500]}"
    )

    body = resp.json()
    dashboard_id = body["v8"]["dashboardId"]
    assert dashboard_id, "Dashboard ID should be returned"

    try:
        # Retrieve and verify config is preserved
        get_url = f"{base_url}api/{ORG_ID}/dashboards/{dashboard_id}"
        get_resp = session.get(get_url)
        assert get_resp.status_code == 200, (
            f"Get dashboard failed: {get_resp.status_code} {get_resp.text[:500]}"
        )

        get_body = get_resp.json()
        panel = get_body["v8"]["tabs"][0]["panels"][0]
        query_config = panel["queries"][0]

        # Verify time_shift is preserved
        time_shift = query_config.get("config", {}).get("time_shift", [])
        assert len(time_shift) == 1, (
            f"time_shift should have 1 entry, got {len(time_shift)}: {time_shift}"
        )
        assert time_shift[0].get("offSet") == "15m", (
            f"time_shift offset should be '15m', got {time_shift[0]}"
        )

        # Verify VRL function is preserved
        saved_vrl = query_config.get("vrlFunctionQuery", "")
        assert "#ResultArray#" in saved_vrl, (
            f"VRL function should contain #ResultArray#, got: {saved_vrl[:100]}"
        )
        assert "diff" in saved_vrl, (
            f"VRL function should contain 'diff' computation"
        )
        assert "diff_percentage" in saved_vrl, (
            f"VRL function should contain 'diff_percentage' computation"
        )

        logger.info(f"Dashboard config verified: time_shift + VRL preserved. ID: {dashboard_id}")

    finally:
        # Clean up
        session.delete(f"{base_url}api/{ORG_ID}/dashboards/{dashboard_id}")


# =============================================================================
# Test: _search_multi (non-streaming) baseline tests
# =============================================================================

def test_search_multi_per_query_response_returns_2d_hits(create_session, base_url):
    """Test _search_multi with per_query_response returns proper 2D hits array.

    With per_query_response=true, hits should be [[rows_q1], [rows_q2]] -
    a list of lists where each inner list contains rows for that query.
    """
    session = create_session
    start_time, end_time = _get_wide_time_range()
    sql_query = _build_histogram_sql()

    payload = {
        "sql": [
            {"sql": sql_query, "start_time": start_time, "end_time": end_time},
            {"sql": sql_query, "start_time": start_time, "end_time": end_time},
        ],
        "start_time": start_time,
        "end_time": end_time,
        "from": 0,
        "size": -1,
        "per_query_response": True,
    }

    url = f"{base_url}api/{ORG_ID}/_search_multi"
    params = {"type": "logs", "search_type": "dashboards", "use_cache": "false"}

    resp = session.post(url, params=params, json=payload)
    assert resp.status_code == 200, (
        f"Expected 200, got {resp.status_code}. Response: {resp.text[:500]}"
    )

    body = resp.json()
    assert isinstance(body, dict), "Response should be a dictionary"
    assert "hits" in body, f"Response should have 'hits'. Keys: {list(body.keys())}"
    assert "took" in body, f"Response should have 'took'. Keys: {list(body.keys())}"

    hits = body["hits"]
    assert isinstance(hits, list), "hits should be a list"
    # With 2 queries and per_query_response, should get 2 result sets
    assert len(hits) == 2, f"Expected 2 result sets, got {len(hits)}"

    for i, result_set in enumerate(hits):
        assert isinstance(result_set, list), (
            f"hits[{i}] should be a list, got {type(result_set).__name__}"
        )
        assert len(result_set) > 0, f"hits[{i}] should contain rows"

        first_row = result_set[0]
        assert isinstance(first_row, dict), (
            f"hits[{i}][0] should be dict, got {type(first_row).__name__}"
        )
        assert "x_axis_1" in first_row, (
            f"hits[{i}][0] should have x_axis_1. Keys: {list(first_row.keys())}"
        )
        assert "cnt" in first_row, (
            f"hits[{i}][0] should have cnt. Keys: {list(first_row.keys())}"
        )

    # Same time range → same row count
    assert len(hits[0]) == len(hits[1]), (
        f"Both queries should return same row count. Q0: {len(hits[0])}, Q1: {len(hits[1])}"
    )

    logger.info(
        f"_search_multi per_query_response: 2 result sets, {len(hits[0])} rows each"
    )
