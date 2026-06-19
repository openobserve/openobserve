import pytest
import time
import json
import base64
import logging

logger = logging.getLogger(__name__)

ORG_ID = "default"
STREAM_NAME = "stream_pytest_data"


def _base64_encode(text):
    """Base64 URL-safe encode a string, matching OpenObserve's base64::encode_url."""
    return base64.b64encode(text.encode()).decode()


# ---------------------------------------------------------------------------
# Dashboard payloads
# ---------------------------------------------------------------------------

def _make_multi_window_panel_no_vrl(panel_id="panel_mw_no_vrl"):
    """Panel with time_shift (multi-time-window) but NO VRL function."""
    return {
        "id": panel_id,
        "type": "line",
        "title": "Multi Window No VRL",
        "description": "",
        "config": {
            "show_legends": True,
            "legends_position": None,
            "show_symbol": False,
            "show_gridlines": True,
        },
        "queryType": "sql",
        "queries": [
            {
                "query": f'SELECT histogram(_timestamp, \'15 minutes\') as time_s, count(_timestamp) as cnt FROM "{STREAM_NAME}" GROUP BY time_s ORDER BY time_s ASC',
                "vrlFunctionQuery": "",
                "customQuery": True,
                "fields": {
                    "stream": STREAM_NAME,
                    "stream_type": "logs",
                    "x": [{"label": "time_s", "alias": "time_s", "type": "build", "color": None}],
                    "y": [{"label": "cnt", "alias": "cnt", "type": "build", "color": None}],
                    "z": [],
                    "breakdown": [],
                    "filter": {
                        "filterType": "group",
                        "logicalOperator": "AND",
                        "conditions": [],
                    },
                },
                "config": {
                    "promql_legend": "",
                    "time_shift": [{"offSet": "1h"}],
                },
            }
        ],
        "layout": {"x": 0, "y": 0, "w": 96, "h": 18, "i": 0},
    }


def _make_multi_window_panel_with_non_result_array_vrl(panel_id="panel_mw_vrl_simple"):
    """Panel with time_shift and a simple per-hit VRL (non-ResultArray)."""
    return {
        "id": panel_id,
        "type": "line",
        "title": "Multi Window Non-ResultArray VRL",
        "description": "",
        "config": {
            "show_legends": True,
            "legends_position": None,
            "show_symbol": False,
            "show_gridlines": True,
        },
        "queryType": "sql",
        "queries": [
            {
                "query": f'SELECT histogram(_timestamp, \'15 minutes\') as time_s, count(_timestamp) as cnt FROM "{STREAM_NAME}" GROUP BY time_s ORDER BY time_s ASC',
                "vrlFunctionQuery": ".doubled_cnt, err = .cnt * 2\n.",
                "customQuery": True,
                "fields": {
                    "stream": STREAM_NAME,
                    "stream_type": "logs",
                    "x": [{"label": "time_s", "alias": "time_s", "type": "build", "color": None}],
                    "y": [{"label": "cnt", "alias": "cnt", "type": "build", "color": None}],
                    "z": [],
                    "breakdown": [],
                    "filter": {
                        "filterType": "group",
                        "logicalOperator": "AND",
                        "conditions": [],
                    },
                },
                "config": {
                    "promql_legend": "",
                    "time_shift": [{"offSet": "1h"}],
                },
            }
        ],
        "layout": {"x": 0, "y": 20, "w": 96, "h": 18, "i": 1},
    }


RESULT_ARRAY_VRL = """#ResultArray#

prev_data = []
curr_data = []
res = []
result = array!(.)

if length(result) >= 2 {
  today_data = result[0]
  yesterday_data = result[1]

  cnt_yesterday = 0.0
  cnt_today = 0.0

  for_each(array!(yesterday_data)) -> |index, p_value| {
    cnt_yesterday, err = cnt_yesterday + p_value.cnt
  }

  for_each(array!(today_data)) -> |index, p_value| {
    cnt_today, err = cnt_today + p_value.cnt
  }

  diff = cnt_today - cnt_yesterday
  if diff < 0.0 {
    diff = cnt_yesterday - cnt_today
  }
  diff_percentage, err = (diff) * 100.0 / cnt_yesterday
  if diff_percentage > 0.0 {
    diff_data = {"diff": diff, "diff_percentage": diff_percentage}
    temp = []
    second_dummy = []
    temp = push(temp, diff_data)
    res = push(res, temp)
    res = push(res, second_dummy)
  }
}
. = res
."""


def _make_multi_window_panel_with_result_array_vrl(panel_id="panel_mw_vrl_result_array"):
    """Panel with time_shift and a #ResultArray# VRL that computes diff/diff_percentage."""
    return {
        "id": panel_id,
        "type": "bar",
        "title": "Multi Window ResultArray VRL",
        "description": "",
        "config": {
            "show_legends": True,
            "legends_position": None,
            "show_symbol": False,
            "show_gridlines": True,
        },
        "queryType": "sql",
        "queries": [
            {
                "query": f'SELECT histogram(_timestamp, \'15 minutes\') as time_s, count(_timestamp) as cnt FROM "{STREAM_NAME}" GROUP BY time_s ORDER BY time_s ASC',
                "vrlFunctionQuery": RESULT_ARRAY_VRL,
                "customQuery": True,
                "fields": {
                    "stream": STREAM_NAME,
                    "stream_type": "logs",
                    "x": [
                        {
                            "label": "diff",
                            "alias": "diff",
                            "type": "build",
                            "color": None,
                            "isDerived": True,
                        }
                    ],
                    "y": [
                        {
                            "label": "diff_percentage",
                            "alias": "diff_percentage",
                            "type": "build",
                            "color": None,
                            "isDerived": True,
                        }
                    ],
                    "z": [],
                    "breakdown": [],
                    "filter": {
                        "filterType": "group",
                        "logicalOperator": "AND",
                        "conditions": [],
                    },
                },
                "config": {
                    "promql_legend": "",
                    "time_shift": [{"offSet": "1h"}],
                },
            }
        ],
        "layout": {"x": 96, "y": 20, "w": 96, "h": 18, "i": 2},
    }


# ===========================================================================
# PART 1: Dashboard CRUD with multi-time-window panels
# ===========================================================================


class TestDashboardMultiWindowCRUD:
    """Test creating/reading/deleting dashboards with multi-time-window panels."""

    def test_create_dashboard_multi_window_no_vrl(self, create_session, base_url):
        """Create a dashboard with a multi-time-window panel (no VRL) and verify it persists."""
        session = create_session
        url = f"{base_url}api/{ORG_ID}/dashboards"

        dashboard_data = {
            "version": 8,
            "title": f"MW No VRL Test {int(time.time() * 1000)}",
            "description": "Multi-window dashboard without VRL",
            "folder_id": "default",
            "tabs": [
                {
                    "tabId": "tab-1",
                    "name": "Overview",
                    "panels": [_make_multi_window_panel_no_vrl()],
                }
            ],
            "variables": {"list": [], "showDynamicFilters": False},
        }

        resp = session.post(url, json=dashboard_data)
        assert resp.status_code in [200, 201], f"Create failed: {resp.status_code} {resp.text}"

        body = resp.json()
        assert "v8" in body and "dashboardId" in body["v8"], "Response should contain v8.dashboardId"
        dashboard_id = body["v8"]["dashboardId"]
        logger.info(f"Created multi-window (no VRL) dashboard: {dashboard_id}")

        # Verify the dashboard was saved with time_shift config
        get_resp = session.get(f"{base_url}api/{ORG_ID}/dashboards/{dashboard_id}")
        assert get_resp.status_code == 200, f"Get failed: {get_resp.status_code} {get_resp.text}"

        saved = get_resp.json()
        panel = saved["v8"]["tabs"][0]["panels"][0]
        query_config = panel["queries"][0]["config"]
        assert "time_shift" in query_config, "time_shift should be preserved in saved panel"
        assert len(query_config["time_shift"]) == 1, "Should have exactly 1 time_shift entry"
        assert query_config["time_shift"][0]["offSet"] == "1h", "time_shift offset should be '1h'"

        # Cleanup
        session.delete(f"{base_url}api/{ORG_ID}/dashboards/{dashboard_id}")

    def test_create_dashboard_multi_window_non_result_array_vrl(self, create_session, base_url):
        """Create a dashboard with a multi-time-window panel + non-ResultArray VRL."""
        session = create_session
        url = f"{base_url}api/{ORG_ID}/dashboards"

        dashboard_data = {
            "version": 8,
            "title": f"MW Simple VRL Test {int(time.time() * 1000)}",
            "description": "Multi-window dashboard with per-hit VRL",
            "folder_id": "default",
            "tabs": [
                {
                    "tabId": "tab-1",
                    "name": "Overview",
                    "panels": [_make_multi_window_panel_with_non_result_array_vrl()],
                }
            ],
            "variables": {"list": [], "showDynamicFilters": False},
        }

        resp = session.post(url, json=dashboard_data)
        assert resp.status_code in [200, 201], f"Create failed: {resp.status_code} {resp.text}"

        body = resp.json()
        dashboard_id = body["v8"]["dashboardId"]
        logger.info(f"Created multi-window (non-ResultArray VRL) dashboard: {dashboard_id}")

        # Verify VRL and time_shift are preserved
        get_resp = session.get(f"{base_url}api/{ORG_ID}/dashboards/{dashboard_id}")
        assert get_resp.status_code == 200

        saved = get_resp.json()
        panel = saved["v8"]["tabs"][0]["panels"][0]
        query = panel["queries"][0]
        assert query["vrlFunctionQuery"] is not None, "vrlFunctionQuery should be saved"
        assert ".doubled_cnt" in query["vrlFunctionQuery"], "VRL content should be preserved"
        assert query["config"]["time_shift"][0]["offSet"] == "1h", "time_shift should be preserved"

        # Cleanup
        session.delete(f"{base_url}api/{ORG_ID}/dashboards/{dashboard_id}")

    def test_create_dashboard_multi_window_result_array_vrl(self, create_session, base_url):
        """Create a dashboard with a multi-time-window panel + #ResultArray# VRL."""
        session = create_session
        url = f"{base_url}api/{ORG_ID}/dashboards"

        dashboard_data = {
            "version": 8,
            "title": f"MW ResultArray VRL Test {int(time.time() * 1000)}",
            "description": "Multi-window dashboard with ResultArray VRL",
            "folder_id": "default",
            "tabs": [
                {
                    "tabId": "tab-1",
                    "name": "Overview",
                    "panels": [_make_multi_window_panel_with_result_array_vrl()],
                }
            ],
            "variables": {"list": [], "showDynamicFilters": False},
        }

        resp = session.post(url, json=dashboard_data)
        assert resp.status_code in [200, 201], f"Create failed: {resp.status_code} {resp.text}"

        body = resp.json()
        dashboard_id = body["v8"]["dashboardId"]
        logger.info(f"Created multi-window (ResultArray VRL) dashboard: {dashboard_id}")

        # Verify #ResultArray# VRL is preserved
        get_resp = session.get(f"{base_url}api/{ORG_ID}/dashboards/{dashboard_id}")
        assert get_resp.status_code == 200

        saved = get_resp.json()
        panel = saved["v8"]["tabs"][0]["panels"][0]
        query = panel["queries"][0]
        assert query["vrlFunctionQuery"] is not None, "vrlFunctionQuery should be saved"
        assert "#ResultArray#" in query["vrlFunctionQuery"], "#ResultArray# prefix should be preserved"
        assert "diff_percentage" in query["vrlFunctionQuery"], "VRL logic should be preserved"
        assert query["config"]["time_shift"][0]["offSet"] == "1h", "time_shift should be preserved"

        # Cleanup
        session.delete(f"{base_url}api/{ORG_ID}/dashboards/{dashboard_id}")

    def test_create_dashboard_all_panel_types_combined(self, create_session, base_url):
        """Create a dashboard with all 3 panel types: no-VRL, non-ResultArray VRL, ResultArray VRL."""
        session = create_session
        url = f"{base_url}api/{ORG_ID}/dashboards"

        dashboard_data = {
            "version": 8,
            "title": f"MW Combined Test {int(time.time() * 1000)}",
            "description": "All multi-window panel types in one dashboard",
            "folder_id": "default",
            "tabs": [
                {
                    "tabId": "tab-1",
                    "name": "Overview",
                    "panels": [
                        _make_multi_window_panel_no_vrl("panel_no_vrl"),
                        _make_multi_window_panel_with_non_result_array_vrl("panel_simple_vrl"),
                        _make_multi_window_panel_with_result_array_vrl("panel_result_array_vrl"),
                    ],
                }
            ],
            "variables": {"list": [], "showDynamicFilters": False},
        }

        resp = session.post(url, json=dashboard_data)
        assert resp.status_code in [200, 201], f"Create failed: {resp.status_code} {resp.text}"

        body = resp.json()
        dashboard_id = body["v8"]["dashboardId"]

        # Verify all 3 panels were saved
        get_resp = session.get(f"{base_url}api/{ORG_ID}/dashboards/{dashboard_id}")
        assert get_resp.status_code == 200

        saved = get_resp.json()
        panels = saved["v8"]["tabs"][0]["panels"]
        assert len(panels) == 3, f"Expected 3 panels, got {len(panels)}"

        # Each panel should have time_shift
        for panel in panels:
            ts = panel["queries"][0]["config"].get("time_shift", [])
            assert len(ts) >= 1, f"Panel {panel['id']} should have time_shift"

        # Cleanup
        session.delete(f"{base_url}api/{ORG_ID}/dashboards/{dashboard_id}")


# ===========================================================================
# PART 2: _search_multi_stream with VRL functions
# ===========================================================================


def _parse_sse_events(content):
    """Parse SSE response text into a list of (event_type, data_dict) tuples."""
    events = []
    lines = content.split("\n")
    current_event = None

    for line in lines:
        if line.startswith("event: "):
            current_event = line[7:].strip()
        elif line.startswith("data: "):
            data_str = line[6:].strip()
            if data_str == "[[DONE]]":
                events.append(("done", None))
            else:
                try:
                    data = json.loads(data_str)
                    events.append((current_event or "data", data))
                except json.JSONDecodeError:
                    pass
            current_event = None

    return events


class TestSearchMultiStreamVRL:
    """Test _search_multi_stream endpoint with VRL functions for multi-time-window queries."""

    def test_search_multi_stream_no_vrl(self, create_session, base_url):
        """Multi-stream search without VRL — should return raw hits for each time window."""
        session = create_session

        end_time = int(time.time() * 1000000)
        start_time = end_time - (60 * 60 * 1000000)  # 1 hour

        url = f"{base_url}api/{ORG_ID}/_search_multi_stream"
        params = {
            "type": "logs",
            "search_type": "dashboards",
            "use_cache": "false",
            "is_multi_stream_search": "false",
        }

        # Two queries simulating current time window and shifted (1h ago) time window
        payload = {
            "sql": [
                {
                    "sql": f'SELECT count(_timestamp) as cnt FROM "{STREAM_NAME}"',
                    "start_time": start_time,
                    "end_time": end_time,
                },
                {
                    "sql": f'SELECT count(_timestamp) as cnt FROM "{STREAM_NAME}"',
                    "start_time": start_time - (60 * 60 * 1000000),
                    "end_time": end_time - (60 * 60 * 1000000),
                },
            ],
            "start_time": start_time,
            "end_time": end_time,
            "from": 0,
            "size": -1,
            "quick_mode": False,
            "per_query_response": True,
        }

        resp = session.post(url, params=params, json=payload)

        if resp.status_code == 400 and "not found" in resp.text.lower():
            pytest.skip(f"Stream '{STREAM_NAME}' not found — skipping")

        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

        content = resp.text
        assert "[[DONE]]" in content, "SSE response should contain [[DONE]] marker"

        events = _parse_sse_events(content)
        hits_events = [e for e in events if e[0] == "search_response_hits"]
        metadata_events = [e for e in events if e[0] == "search_response_metadata"]

        # With per_query_response=true and 2 queries, we expect 2 metadata + 2 hits events
        assert len(metadata_events) == 2, (
            f"Expected 2 search_response_metadata events, got {len(metadata_events)}"
        )
        assert len(hits_events) == 2, (
            f"Expected 2 search_response_hits events, got {len(hits_events)}"
        )

        # Each hits event should have a "hits" array
        for i, (_, data) in enumerate(hits_events):
            assert "hits" in data, f"hits event {i} should have 'hits' key"
            assert isinstance(data["hits"], list), f"hits event {i} 'hits' should be an array"

        logger.info("Multi-stream search (no VRL) returned 2 hit arrays as expected")

    def test_search_single_stream_vrl_baseline(self, create_session, base_url):
        """Baseline: verify VRL works on the regular _search endpoint before testing multi-stream."""
        session = create_session

        end_time = int(time.time() * 1000000)
        start_time = end_time - (60 * 60 * 1000000)

        vrl_code = ".doubled_cnt, err = .cnt * 2\n."
        encoded_vrl = _base64_encode(vrl_code)

        url = f"{base_url}api/{ORG_ID}/_search"
        params = {"type": "logs"}
        payload = {
            "query": {
                "sql": f'SELECT count(_timestamp) as cnt FROM "{STREAM_NAME}"',
                "start_time": start_time,
                "end_time": end_time,
                "from": 0,
                "size": -1,
                "quick_mode": False,
                "query_fn": encoded_vrl,
                "uses_zo_fn": True,
            },
        }

        resp = session.post(url, params=params, json=payload)

        if resp.status_code == 400 and "not found" in resp.text.lower():
            pytest.skip(f"Stream '{STREAM_NAME}' not found — skipping")

        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

        body = resp.json()
        function_error = body.get("function_error", [])
        if function_error:
            logger.warning(f"_search VRL function_error: {function_error}")

        hits = body.get("hits", [])
        if hits:
            logger.info(f"_search baseline hit keys: {list(hits[0].keys())}, values: {hits[0]}")
            assert "doubled_cnt" in hits[0], (
                f"VRL should add 'doubled_cnt' on _search. Got: {hits[0]}. function_error: {function_error}"
            )
        else:
            logger.info("_search returned no hits — VRL baseline check skipped")

    def test_search_multi_stream_non_result_array_vrl(self, create_session, base_url):
        """Multi-stream search with a per-hit VRL (non-ResultArray) — VRL applied per query."""
        session = create_session

        end_time = int(time.time() * 1000000)
        start_time = end_time - (60 * 60 * 1000000)

        # Per-hit VRL: adds a "doubled_cnt" field to each hit
        vrl_code = ".doubled_cnt, err = .cnt * 2\n."
        encoded_vrl = _base64_encode(vrl_code)
        logger.info(f"Encoded VRL: {encoded_vrl} (decoded: {vrl_code!r})")

        url = f"{base_url}api/{ORG_ID}/_search_multi_stream"
        params = {
            "type": "logs",
            "search_type": "dashboards",
            "use_cache": "false",
            "is_multi_stream_search": "false",
        }

        payload = {
            "sql": [
                {
                    "sql": f'SELECT count(_timestamp) as cnt FROM "{STREAM_NAME}"',
                    "start_time": start_time,
                    "end_time": end_time,
                },
                {
                    "sql": f'SELECT count(_timestamp) as cnt FROM "{STREAM_NAME}"',
                    "start_time": start_time - (60 * 60 * 1000000),
                    "end_time": end_time - (60 * 60 * 1000000),
                },
            ],
            "start_time": start_time,
            "end_time": end_time,
            "from": 0,
            "size": -1,
            "quick_mode": False,
            "per_query_response": True,
            "query_fn": encoded_vrl,
            "uses_zo_fn": True,
        }

        resp = session.post(url, params=params, json=payload)

        if resp.status_code == 400 and "not found" in resp.text.lower():
            pytest.skip(f"Stream '{STREAM_NAME}' not found — skipping")

        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

        content = resp.text
        assert "[[DONE]]" in content, "SSE response should contain [[DONE]] marker"

        events = _parse_sse_events(content)

        # Log metadata events for diagnostics (check for function_error)
        meta_events = [e for e in events if e[0] == "search_response_metadata"]
        for i, (_, meta) in enumerate(meta_events):
            fn_err = meta.get("function_error", [])
            if fn_err:
                logger.warning(f"Metadata event {i} function_error: {fn_err}")
            else:
                logger.info(f"Metadata event {i}: no function_error, keys={list(meta.keys())}")

        hits_events = [e for e in events if e[0] == "search_response_hits"]

        # Should still get 2 hit arrays (one per query)
        assert len(hits_events) == 2, (
            f"Expected 2 search_response_hits events, got {len(hits_events)}. "
            f"Full SSE (first 2000 chars): {content[:2000]}"
        )

        # If first query returned data, check VRL was applied (doubled_cnt field)
        first_hits = hits_events[0][1].get("hits", [])
        if first_hits:
            # Collect all function_errors from metadata for diagnostics
            all_fn_errors = []
            for _, meta in meta_events:
                all_fn_errors.extend(meta.get("function_error", []))

            assert "doubled_cnt" in first_hits[0], (
                f"Per-hit VRL should add 'doubled_cnt' field. Got: {first_hits[0]}. "
                f"function_errors: {all_fn_errors}. "
                f"Full SSE (first 2000 chars): {content[:2000]}"
            )
            logger.info("Non-ResultArray VRL correctly added 'doubled_cnt' field to hits")
        else:
            logger.info("First query returned no hits (possibly no data in time range) — VRL field check skipped")

    def test_search_multi_stream_result_array_vrl(self, create_session, base_url):
        """Multi-stream search with #ResultArray# VRL — computes diff across time windows.

        Expected: Two search_response_hits events are returned.
        The first contains a single object with 'diff' and 'diff_percentage' fields.
        The second is an empty array.
        """
        session = create_session

        end_time = int(time.time() * 1000000)
        start_time = end_time - (24 * 60 * 60 * 1000000)  # 24 hours — wider range for data

        encoded_vrl = _base64_encode(RESULT_ARRAY_VRL)

        url = f"{base_url}api/{ORG_ID}/_search_multi_stream"
        params = {
            "type": "logs",
            "search_type": "dashboards",
            "use_cache": "false",
            "is_multi_stream_search": "false",
            "fallback_order_by_col": "diff",
        }

        payload = {
            "sql": [
                {
                    "sql": f'SELECT histogram(_timestamp, \'15 minutes\') as time_s, count(_timestamp) as cnt FROM "{STREAM_NAME}" GROUP BY time_s ORDER BY time_s ASC',
                    "start_time": start_time,
                    "end_time": end_time,
                },
                {
                    "sql": f'SELECT histogram(_timestamp, \'15 minutes\') as time_s, count(_timestamp) as cnt FROM "{STREAM_NAME}" GROUP BY time_s ORDER BY time_s ASC',
                    "start_time": start_time - (60 * 60 * 1000000),
                    "end_time": end_time - (60 * 60 * 1000000),
                },
            ],
            "start_time": start_time,
            "end_time": end_time,
            "from": 0,
            "size": -1,
            "quick_mode": False,
            "per_query_response": True,
            "query_fn": encoded_vrl,
            "uses_zo_fn": True,
        }

        resp = session.post(url, params=params, json=payload)

        if resp.status_code == 400 and "not found" in resp.text.lower():
            pytest.skip(f"Stream '{STREAM_NAME}' not found — skipping")

        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

        content = resp.text
        assert "[[DONE]]" in content, "SSE response should contain [[DONE]] marker"

        events = _parse_sse_events(content)
        hits_events = [e for e in events if e[0] == "search_response_hits"]
        metadata_events = [e for e in events if e[0] == "search_response_metadata"]

        # Should get exactly 2 hits arrays (ResultArray VRL returns 2 arrays)
        assert len(hits_events) == 2, (
            f"Expected 2 search_response_hits events from ResultArray VRL, got {len(hits_events)}"
        )

        first_hits = hits_events[0][1].get("hits", [])
        second_hits = hits_events[1][1].get("hits", [])

        if first_hits:
            # First array should contain a single object with diff and diff_percentage
            assert len(first_hits) == 1, (
                f"First hits array should contain exactly 1 element, got {len(first_hits)}"
            )
            hit = first_hits[0]
            assert "diff" in hit, f"ResultArray VRL result should have 'diff' field. Got: {list(hit.keys())}"
            assert "diff_percentage" in hit, (
                f"ResultArray VRL result should have 'diff_percentage' field. Got: {list(hit.keys())}"
            )
            assert isinstance(hit["diff"], (int, float)), f"'diff' should be numeric, got {type(hit['diff'])}"
            assert isinstance(hit["diff_percentage"], (int, float)), (
                f"'diff_percentage' should be numeric, got {type(hit['diff_percentage'])}"
            )
            logger.info(
                f"ResultArray VRL produced diff={hit['diff']}, diff_percentage={hit['diff_percentage']}"
            )
        else:
            logger.info("First hits array is empty — VRL condition not met (possibly no data difference)")

        # Second array should be empty (the VRL pushes an empty second_dummy array)
        assert second_hits == [], (
            f"Second hits array should be empty, got {len(second_hits)} items: {second_hits}"
        )

        # Metadata should also have 2 events
        assert len(metadata_events) == 2, (
            f"Expected 2 metadata events, got {len(metadata_events)}"
        )

        logger.info("ResultArray VRL search_multi_stream test passed")

    def test_search_multi_stream_result_array_vrl_response_structure(self, create_session, base_url):
        """Validate the full SSE response structure from search_multi_stream with ResultArray VRL.

        Checks:
        - Progress events exist
        - Two metadata events with query_index 0 and 1
        - Two hits events (first may have data, second is empty)
        - [[DONE]] marker at end
        """
        session = create_session

        end_time = int(time.time() * 1000000)
        start_time = end_time - (24 * 60 * 60 * 1000000)

        encoded_vrl = _base64_encode(RESULT_ARRAY_VRL)

        url = f"{base_url}api/{ORG_ID}/_search_multi_stream"
        params = {
            "type": "logs",
            "search_type": "dashboards",
            "use_cache": "false",
            "is_multi_stream_search": "false",
            "fallback_order_by_col": "diff",
        }

        payload = {
            "sql": [
                {
                    "sql": f'SELECT histogram(_timestamp, \'15 minutes\') as time_s, count(_timestamp) as cnt FROM "{STREAM_NAME}" GROUP BY time_s ORDER BY time_s ASC',
                    "start_time": start_time,
                    "end_time": end_time,
                },
                {
                    "sql": f'SELECT histogram(_timestamp, \'15 minutes\') as time_s, count(_timestamp) as cnt FROM "{STREAM_NAME}" GROUP BY time_s ORDER BY time_s ASC',
                    "start_time": start_time - (60 * 60 * 1000000),
                    "end_time": end_time - (60 * 60 * 1000000),
                },
            ],
            "start_time": start_time,
            "end_time": end_time,
            "from": 0,
            "size": -1,
            "quick_mode": False,
            "per_query_response": True,
            "query_fn": encoded_vrl,
            "uses_zo_fn": True,
        }

        resp = session.post(url, params=params, json=payload)

        if resp.status_code == 400 and "not found" in resp.text.lower():
            pytest.skip(f"Stream '{STREAM_NAME}' not found — skipping")

        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

        content = resp.text
        events = _parse_sse_events(content)

        # Check progress events exist
        progress_events = [e for e in events if e[0] == "progress"]
        assert len(progress_events) >= 1, "Should have at least one progress event"

        # Check [[DONE]] marker
        done_events = [e for e in events if e[0] == "done"]
        assert len(done_events) >= 1, "Response should end with [[DONE]] marker"

        # Validate metadata events have query_index
        metadata_events = [e for e in events if e[0] == "search_response_metadata"]
        assert len(metadata_events) == 2, f"Expected 2 metadata events, got {len(metadata_events)}"

        for i, (_, meta) in enumerate(metadata_events):
            assert "results" in meta, f"Metadata event {i} should have 'results' key"
            results = meta["results"]
            assert "query_index" in results, f"Metadata {i} should have 'query_index'"
            assert "took" in results, f"Metadata {i} should have 'took'"

        # Verify query_index values cover both queries (0 and 1)
        query_indices = {meta[1]["results"]["query_index"] for meta in metadata_events}
        assert query_indices == {0, 1}, f"Expected query_index {{0, 1}}, got {query_indices}"

        logger.info("SSE response structure validation passed")

    def test_search_multi_stream_without_per_query_response(self, create_session, base_url):
        """When per_query_response=false, VRL is set on individual queries (not post-hoc)."""
        session = create_session

        end_time = int(time.time() * 1000000)
        start_time = end_time - (60 * 60 * 1000000)

        # Even with #ResultArray# VRL, per_query_response=false means VRL goes to each sub-query
        encoded_vrl = _base64_encode(RESULT_ARRAY_VRL)

        url = f"{base_url}api/{ORG_ID}/_search_multi_stream"
        params = {
            "type": "logs",
            "search_type": "dashboards",
            "use_cache": "false",
            "is_multi_stream_search": "false",
        }

        payload = {
            "sql": [
                {
                    "sql": f'SELECT count(_timestamp) as cnt FROM "{STREAM_NAME}"',
                    "start_time": start_time,
                    "end_time": end_time,
                },
            ],
            "start_time": start_time,
            "end_time": end_time,
            "from": 0,
            "size": -1,
            "quick_mode": False,
            "per_query_response": False,
            "query_fn": encoded_vrl,
            "uses_zo_fn": True,
        }

        resp = session.post(url, params=params, json=payload)

        if resp.status_code == 400 and "not found" in resp.text.lower():
            pytest.skip(f"Stream '{STREAM_NAME}' not found — skipping")

        # Should not error — the handler should set VRL on individual queries
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

        content = resp.text
        assert "[[DONE]]" in content, "SSE response should contain [[DONE]] marker"

        logger.info("search_multi_stream with per_query_response=false completed successfully")
