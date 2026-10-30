"""Streaming + non-streaming search endpoint tests.

Rewritten in Phase 4.17 of the api-tests revamp (was 1454 LOC; the only
OLD-tier file not yet rewritten).

Coverage (75 tests in 2 ordered classes, mirrors original surface):
- Non-streaming `/_search` histogram queries (11 parametrized)
- Non-streaming `/_search` with max_query_range function_error
- `/_search_partition` partition info
- `/_values` endpoint
- Streaming `/_search_stream` histogram queries (11 parametrized, SSE)
- Streaming `/_search_stream` SQL queries (32 parametrized, SSE)
- Streaming `/_values_stream` (with + without cache)
- Streaming `/_search_stream` with max_query_range function_error

Key changes from original:
- The SSE parser (`read_response`) extracted to `support/sse.py` as
  `read_sse_response()` — reusable from other streaming tests, lints
  cleanly, has a real docstring.
- `HTTPBasicAuth(ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD)` re-assignment
  in every test removed — `create_session` already has Basic auth in
  its headers from conftest._create_session_inner_v2(). The re-assignment
  was a no-op overhead.
- Dropped the `base_url_sc` (super-cluster) fixture — it always pointed
  at the same base_url in this OSS deployment.
- Module-scope `streams_setup` fixture ingests + waits for data + sets
  max_query_range once for all tests in this module.
- Class-scoped `_disable_streaming` / `_enable_streaming` fixtures toggle
  the org setting once per class instead of via positional ordered tests.
- Inline parametrize tables preserved (they're the test material).
- Tests still run in declaration order within each class to preserve any
  cumulative state assumptions.
"""
from __future__ import annotations

import base64
import logging
import os
import random
import string
from datetime import datetime, timedelta, UTC
from pathlib import Path

import pytest
from requests.auth import HTTPBasicAuth

from support.sse import read_sse_frames, read_sse_response

logger = logging.getLogger(__name__)

ZO_BASE_URL = os.environ.get("ZO_BASE_URL")
WS_ZO_BASE_URL = os.environ.get("WS_ZO_BASE_URL")
ZO_ROOT_USER_EMAIL = os.environ.get("ZO_ROOT_USER_EMAIL")
ZO_ROOT_USER_PASSWORD = os.environ.get("ZO_ROOT_USER_PASSWORD")

ORG_ID = "default"

# 4 parents: tests/api-testing/tests/search/test_streaming.py -> repo's tests/
ROOT_DIR = Path(__file__).parent.parent.parent.parent

# Module-scoped stream names (random suffix prevents collision across runs)
_RANDOM = "".join(random.choice(string.ascii_lowercase) for _ in range(5))
STREAM_NAME = f"tdef{_RANDOM}"
STREAM_JOIN = f"join{_RANDOM}"


# ----- helpers -----


def _now_us() -> int:
    return int(datetime.now(UTC).timestamp() * 1_000_000)


def _wait_for_ingestion_count(
    session, base_url: str, stream: str, expected: int,
    timeout: int = 120, interval: int = 2,
) -> int:
    """Poll _search until COUNT(*) for the stream reaches `expected`. Fails on timeout."""
    import time
    deadline = time.time() + timeout
    end_us = _now_us()
    start_us = end_us - 24 * 3600 * 1_000_000
    payload = {
        "query": {
            "sql": f'SELECT COUNT(*) AS cnt FROM "{stream}"',
            "start_time": start_us,
            "end_time": end_us,
            "size": -1,
        }
    }
    last = None
    while time.time() < deadline:
        r = session.post(
            f"{base_url}api/{ORG_ID}/_search?type=logs&search_type=UI&use_cache=false",
            json=payload,
        )
        if r.status_code == 200:
            hits = (r.json() or {}).get("hits") or []
            last = hits[0].get("cnt", 0) if hits else 0
            if last >= expected:
                return last
        time.sleep(interval)
    pytest.fail(
        f"timed out waiting for {stream} to reach {expected} rows "
        f"(last seen: {last}) within {timeout}s"
    )


def _set_streaming_enabled(session, base_url: str, enabled: bool) -> None:
    """POST /api/{org}/settings to toggle enable_streaming_search."""
    payload = {
        "scrape_interval": 15,
        "span_id_field_name": "span_id",
        "trace_id_field_name": "trace_id",
        "toggle_ingestion_logs": False,
        "enable_websocket_search": False,
        "enable_streaming_search": enabled,
    }
    resp = session.post(f"{base_url}api/{ORG_ID}/settings", json=payload)
    assert resp.status_code == 200, (
        f"toggle streaming to {enabled}: {resp.status_code} {resp.content}"
    )


# ----- module-scope: ingest streams + set max_query_range -----


@pytest.fixture(scope="module")
def streams_setup(create_session):
    """Ingest tdef* and join* streams; wait for indexing; set max_query_range=1.

    Yields the session. Cleans up streams on module teardown.
    """
    session = create_session
    session.auth = HTTPBasicAuth(ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD)
    base_url = ZO_BASE_URL

    with open(ROOT_DIR / "test-data/logs_data.json") as f:
        data = f.read()

    # Ingest main + join streams (use the same dataset for both)
    for stream in (STREAM_NAME, STREAM_JOIN):
        resp = session.post(
            f"{base_url}api/{ORG_ID}/{stream}/_json",
            data=data,
            headers={"Content-Type": "application/json"},
        )
        assert resp.status_code == 200, (
            f"ingest into {stream} failed: {resp.status_code} {resp.content}"
        )

    # Wait until both reach expected row count (3848 records in logs_data.json)
    _wait_for_ingestion_count(session, base_url, STREAM_NAME, expected=3848)
    _wait_for_ingestion_count(session, base_url, STREAM_JOIN, expected=3848)

    # Set max_query_range=1 hour on the main stream (needed for the
    # function_error tests below)
    settings_url = f"{base_url}api/{ORG_ID}/streams/{STREAM_NAME}/settings?type=logs"
    settings_payload = {
        "partition_keys": {"add": [], "remove": []},
        "index_fields": {"add": [], "remove": []},
        "full_text_search_keys": {"add": [], "remove": []},
        "bloom_filter_fields": {"add": [], "remove": []},
        "defined_schema_fields": {"add": [], "remove": []},
        "extended_retention_days": {"add": [], "remove": []},
        "max_query_range": 1,
        "data_retention": 3650,
        "store_original_data": False,
        "approx_partition": False,
    }
    resp = session.put(settings_url, json=settings_payload)
    assert resp.status_code == 200, (
        f"set max_query_range: {resp.status_code} {resp.content}"
    )

    yield session

    # Cleanup streams — best effort
    for stream in (STREAM_NAME, STREAM_JOIN):
        try:
            session.delete(f"{base_url}api/{ORG_ID}/streams/{stream}?type=logs")
        except Exception as e:
            logger.warning("cleanup failed for %s: %s", stream, e)


# ===== Histogram queries (run in both streaming and non-streaming) =====


_HISTOGRAM_QUERIES = [
    ("Stream",
     f'SELECT histogram(_timestamp, \'10 second\') AS "zo_sql_key", COUNT(*) AS "zo_sql_num" FROM "{STREAM_NAME}" GROUP BY zo_sql_key ORDER BY zo_sql_key ASC',
     1, 3848),
    ("AND",
     f"SELECT histogram(_timestamp, '10 second') AS \"zo_sql_key\", COUNT(*) AS \"zo_sql_num\" FROM \"{STREAM_NAME}\" WHERE kubernetes_container_name = 'ziox' AND kubernetes_labels_app = 'ziox' GROUP BY zo_sql_key ORDER BY zo_sql_key ASC",
     1, 2002),
    ("OR",
     f"SELECT histogram(_timestamp, '10 second') AS \"zo_sql_key\", COUNT(*) AS \"zo_sql_num\" FROM \"{STREAM_NAME}\" WHERE kubernetes_container_name = 'ziox' OR kubernetes_labels_app = 'ziox' GROUP BY zo_sql_key ORDER BY zo_sql_key ASC",
     1, 2002),
    ("Match_all",
     f'SELECT histogram(_timestamp, \'10 second\') AS "zo_sql_key", COUNT(*) AS "zo_sql_num" FROM "{STREAM_NAME}" WHERE match_all(\'ziox\') GROUP BY zo_sql_key ORDER BY zo_sql_key ASC',
     1, 18),
    ("str_match",
     f'SELECT histogram(_timestamp, \'10 second\') AS "zo_sql_key", COUNT(*) AS "zo_sql_num" FROM "{STREAM_NAME}" WHERE str_match(kubernetes_container_name, \'ziox\') GROUP BY zo_sql_key ORDER BY zo_sql_key ASC',
     1, 2002),
    ("Like",
     f'SELECT histogram(_timestamp, \'10 second\') AS "zo_sql_key", COUNT(*) AS "zo_sql_num" FROM "{STREAM_NAME}" WHERE kubernetes_container_name LIKE \'%ziox%\' GROUP BY zo_sql_key ORDER BY zo_sql_key ASC',
     1, 2002),
    ("IN",
     f"SELECT histogram(_timestamp, '10 second') AS \"zo_sql_key\", COUNT(*) AS \"zo_sql_num\" FROM \"{STREAM_NAME}\" WHERE kubernetes_container_name IN ('controller', 'ziox') GROUP BY zo_sql_key ORDER BY zo_sql_key ASC",
     1, 2816),
    ("str_match_ignore_case",
     f'SELECT histogram(_timestamp, \'10 second\') AS "zo_sql_key", COUNT(*) AS "zo_sql_num" FROM "{STREAM_NAME}" WHERE str_match_ignore_case(kubernetes_container_name, \'ziox\') GROUP BY zo_sql_key ORDER BY zo_sql_key ASC',
     1, 2002),
    ("Count Having",
     f'SELECT histogram(_timestamp, \'10 second\') AS "zo_sql_key", COUNT(*) AS "zo_sql_num" FROM "{STREAM_NAME}" GROUP BY zo_sql_key ORDER BY zo_sql_key ASC',
     1, 3848),
    ("Not Null",
     f'SELECT histogram(_timestamp, \'10 second\') AS "zo_sql_key", COUNT(*) AS "zo_sql_num" FROM "{STREAM_NAME}" WHERE kubernetes_container_image IS NOT NULL GROUP BY zo_sql_key ORDER BY zo_sql_key ASC',
     1, 3846),
    ("re_match",
     f'SELECT histogram(_timestamp, \'10 second\') AS "zo_sql_key", COUNT(*) AS "zo_sql_num" FROM "{STREAM_NAME}" WHERE re_match(kubernetes_container_name, \'ziox\') GROUP BY zo_sql_key ORDER BY zo_sql_key ASC',
     1, 2002),
]


_STREAMING_SQL_QUERIES = [
    ("Stream", f'SELECT * FROM "{STREAM_NAME}"', 0, 100, 100),
    ("AND", f"SELECT * FROM \"{STREAM_NAME}\" where kubernetes_container_name = 'ziox' AND kubernetes_labels_app = 'ziox'", 0, 100, 100),
    ("OR", f"SELECT * FROM \"{STREAM_NAME}\" where kubernetes_container_name = 'ziox' OR kubernetes_labels_app = 'ziox'", 0, 100, 100),
    # match_all on bare 'ziox' — known issue, see original 15-07-2025 comment
    ("Str_match", f"SELECT * FROM \"{STREAM_NAME}\" where str_match(kubernetes_container_name, 'ziox')", 0, 100, 100),
    ("Like", f"SELECT * FROM \"{STREAM_NAME}\" WHERE kubernetes_container_name LIKE '%ziox%'", 0, 100, 100),
    ("AS", f'SELECT kubernetes_container_name as "breakdown_1" FROM "{STREAM_NAME}"', 0, 100, 100),
    ("IN", f"SELECT * FROM \"{STREAM_NAME}\" WHERE kubernetes_container_name IN ('controller', 'ziox')", 0, 100, 100),
    ("str_match_ignore_case", f"SELECT * FROM \"{STREAM_NAME}\" where str_match_ignore_case(kubernetes_container_name, 'ziox')", 0, 100, 100),
    ("Limit", f'SELECT * FROM "{STREAM_NAME}" LIMIT 10', 0, 10, 10),
    ("DISTINCT", f'SELECT DISTINCT code FROM "{STREAM_NAME}"', 0, 100, 3),
    ("UNION", f'SELECT * FROM "{STREAM_NAME}" UNION SELECT * FROM "{STREAM_JOIN}"', 0, 50, 50),
    ("UNION ALL", f'SELECT * FROM "{STREAM_NAME}" UNION ALL SELECT * FROM "{STREAM_JOIN}"', 0, 50, 50),
    ("Join", f'SELECT a.kubernetes_namespace_name , b.kubernetes_namespace_name  FROM "{STREAM_NAME}" as a join "{STREAM_JOIN}" as b on a.kubernetes_namespace_name  = b.kubernetes_namespace_name', 0, 50, 50),
    ("LEFT Join", f'SELECT a.kubernetes_docker_id , b.kubernetes_docker_id FROM "{STREAM_NAME}" as a LEFT JOIN "{STREAM_JOIN}" as b ON a.kubernetes_docker_id  = b.kubernetes_docker_id', 0, 50, 50),
    ("RIGHT Join", f'SELECT a.kubernetes_docker_id , b.kubernetes_docker_id FROM "{STREAM_NAME}" as a RIGHT JOIN "{STREAM_JOIN}" as b ON a.kubernetes_docker_id  = b.kubernetes_docker_id', 0, 50, 50),
    ("FULL Join", f'SELECT a.kubernetes_docker_id , b.kubernetes_docker_id FROM "{STREAM_NAME}" as a FULL JOIN "{STREAM_JOIN}" as b ON a.kubernetes_docker_id  = b.kubernetes_docker_id', 0, 50, 50),
    ("Join Where", f"SELECT a.kubernetes_namespace_name , b.kubernetes_namespace_name  FROM \"{STREAM_NAME}\" as a join \"{STREAM_JOIN}\" as b on a.kubernetes_docker_id  = b.kubernetes_docker_id WHERE a.kubernetes_container_name = 'ziox' AND b.kubernetes_container_name = 'ziox'", 0, 50, 50),
    ("LEFT Join Where", f"SELECT a.kubernetes_docker_id , b.kubernetes_docker_id FROM \"{STREAM_NAME}\" as a LEFT JOIN \"{STREAM_JOIN}\" as b ON a.kubernetes_docker_id  = b.kubernetes_docker_id WHERE a.kubernetes_container_name = 'ziox' AND b.kubernetes_container_name = 'ziox'", 0, 50, 50),
    ("RIGHT Join Where", f"SELECT a.kubernetes_docker_id , b.kubernetes_docker_id FROM \"{STREAM_NAME}\" as a RIGHT JOIN \"{STREAM_JOIN}\" as b ON a.kubernetes_docker_id  = b.kubernetes_docker_id WHERE a.kubernetes_container_name = 'ziox' AND b.kubernetes_container_name = 'ziox'", 0, 50, 50),
    ("FULL Join", f"SELECT a.kubernetes_docker_id , b.kubernetes_docker_id FROM \"{STREAM_NAME}\" as a FULL JOIN \"{STREAM_JOIN}\" as b ON a.kubernetes_docker_id  = b.kubernetes_docker_id WHERE a.kubernetes_container_name = 'ziox' AND b.kubernetes_container_name = 'ziox'", 0, 50, 50),
    ("INNER Join Like", f'SELECT "a".kubernetes_docker_id, "b".kubernetes_docker_id FROM "{STREAM_NAME}" AS "a" INNER JOIN "{STREAM_JOIN}" AS "b" ON "a".kubernetes_docker_id = "b".kubernetes_docker_id WHERE "a".kubernetes_container_name LIKE \'%ziox%\'', 0, 50, 50),
    ("INNER Join Like Limit", f'SELECT "a".kubernetes_docker_id, "b".kubernetes_docker_id FROM "{STREAM_NAME}" AS "a" INNER JOIN "{STREAM_JOIN}" AS "b" ON "a".kubernetes_docker_id = "b".kubernetes_docker_id WHERE "a".kubernetes_container_name LIKE \'%ziox%\' LIMIT 10', 0, 50, 10),
    ("INNER Join IN", f'SELECT "a".kubernetes_docker_id, "b".kubernetes_docker_id FROM "{STREAM_NAME}" AS "a" INNER JOIN "{STREAM_JOIN}" AS "b" ON "a".kubernetes_docker_id = "b".kubernetes_docker_id WHERE "a".kubernetes_container_name IN (\'ziox\')', 0, 50, 50),
    ("INNER Join IN Limit", f'SELECT "a".kubernetes_docker_id, "b".kubernetes_docker_id FROM "{STREAM_NAME}" AS "a" INNER JOIN "{STREAM_JOIN}" AS "b" ON "a".kubernetes_docker_id = "b".kubernetes_docker_id WHERE "a".kubernetes_container_name IN (\'ziox\') LIMIT 10', 0, 50, 10),
    ("Count Having", f'SELECT COUNT(_timestamp) as totallogcount FROM "{STREAM_NAME}" Having totallogcount > 1000', 0, -1, 1),
    ("regexp_match", f"SELECT _timestamp, array_extract(regexp_match(log, '^[^\\\\]\\n]*\\\\]\\\\s+(?P<httpMethod>\\\\w+)(?:[^/\\n]*/){{4}}(?P<catalogApi>\\\\w+)(?:[^\\n]* ){{2}}(?P<httpStatusCode>[^ ]+)\\\\s+(?P<apiPayloadSize>[^ ]+)\\\\s+(?P<responseTime>\\\\d+)'), 3) AS status FROM \"{STREAM_NAME}\"", 0, 100, 100),
    ("Count Distinct", f'SELECT count(distinct(kubernetes_container_name)) FROM "{STREAM_NAME}"', 0, -1, 1),
    ("MAX", f'SELECT MAX(_timestamp), count(_timestamp) FROM "{STREAM_NAME}"', 0, -1, 1),
    ("Count Aggregate", f'SELECT count(*) FROM "{STREAM_NAME}"', 0, -1, 1),
    ("Not Null", f'SELECT * FROM "{STREAM_NAME}" WHERE kubernetes_container_image IS NOT NULL', 0, -1, 1000),
    ("Avg", f'SELECT avg(code) FROM "{STREAM_NAME}" WHERE code > 200', 0, -1, 1),
    ("re_match", f"SELECT * FROM \"{STREAM_NAME}\" WHERE re_match(kubernetes_container_name, 'ziox')", 0, 50, 50),
    ("page_one", f"SELECT * FROM \"{STREAM_NAME}\" where kubernetes_container_name = 'velero'", 0, 100, 100),
    ("page_two", f"SELECT * FROM \"{STREAM_NAME}\" where kubernetes_container_name = 'velero'", 100, 101, 101),
    ("page_three", f"SELECT * FROM \"{STREAM_NAME}\" where kubernetes_container_name = 'velero'", 200, 101, 101),
    ("page_four", f"SELECT * FROM \"{STREAM_NAME}\" where kubernetes_container_name = 'velero'", 300, 101, 101),
    ("page_five", f"SELECT * FROM \"{STREAM_NAME}\" where kubernetes_container_name = 'velero'", 400, 101, 40),
    # match_all variants — see 15-07-2025 comment for the skipped third
    ("match_all query two", f"SELECT * FROM \"{STREAM_NAME}\" WHERE match_all('us*')", 0, 50, 50),
    ("match_all query three", f"SELECT * FROM \"{STREAM_NAME}\" WHERE match_all('ip-10-2-15-197.us-east-2.co*')", 0, 50, 2),
]


# ===== TestStreamingDisabled — non-streaming endpoint tests =====


class TestStreamingDisabled:
    """Tests that hit /_search (non-streaming) with the org's streaming setting OFF."""

    @pytest.fixture(scope="class", autouse=True)
    def _disable_streaming(self, streams_setup):
        session = streams_setup
        _set_streaming_enabled(session, ZO_BASE_URL, enabled=False)
        return session

    @pytest.mark.parametrize(
        ("test_name", "hist_query", "expected_total", "expected_zo_sql_num"),
        _HISTOGRAM_QUERIES,
        ids=[t[0] for t in _HISTOGRAM_QUERIES],
    )
    def test_histogram(
        self, streams_setup, test_name, hist_query, expected_total, expected_zo_sql_num
    ):
        """Histogram query via /_search returns the expected counts, with and without cache."""
        session = streams_setup
        url = ZO_BASE_URL
        now = datetime.now(UTC)
        end_time = int(now.timestamp() * 1_000_000)
        one_hour_ago = int((now - timedelta(hours=1)).timestamp() * 1_000_000)
        payload = {
            "query": {
                "sql": hist_query,
                "start_time": one_hour_ago,
                "end_time": end_time,
                "size": -1,
            }
        }

        for use_cache in (False, True):
            resp = session.post(
                f"{url}api/{ORG_ID}/_search?type=logs&search_type=UI&use_cache={str(use_cache).lower()}",
                json=payload,
            )
            assert resp.status_code == 200, (
                f"histogram {test_name} use_cache={use_cache}: "
                f"{resp.status_code} {resp.content}"
            )
            body = resp.json()
            total = body["total"]
            if use_cache:
                assert total == expected_total, (
                    f"histogram {test_name} cache total: expected {expected_total}, got {total}"
                )
            else:
                assert total >= 0, f"histogram {test_name} no-cache total: {total}"
            assert total > 0, f"histogram {test_name} use_cache={use_cache}: no hits"
            actual_zo = body["hits"][0]["zo_sql_num"]
            assert actual_zo == expected_zo_sql_num, (
                f"histogram {test_name} use_cache={use_cache}: "
                f"expected zo_sql_num={expected_zo_sql_num}, got {actual_zo}"
            )

    def test_sql_query_range_function_error(self, streams_setup):
        """A 61-min query window against a stream with max_query_range=1h returns function_error."""
        session = streams_setup
        url = ZO_BASE_URL
        now = datetime.now(UTC)
        end_time = int(now.timestamp() * 1_000_000)
        sixty_one_min_ago = int((now - timedelta(minutes=61)).timestamp() * 1_000_000)
        payload = {
            "query": {
                "sql": f'SELECT * FROM "{STREAM_NAME}"',
                "start_time": sixty_one_min_ago,
                "end_time": end_time,
                "from": 0,
                "size": 50,
                "quick_mode": False,
            },
        }
        expected_error = "Query duration is modified due to query range restriction of 1 hours"

        for use_cache in (False, True):
            resp = session.post(
                f"{url}api/{ORG_ID}/_search?type=logs&search_type=UI&use_cache={str(use_cache).lower()}",
                json=payload,
            )
            assert resp.status_code == 200, (
                f"sql query range use_cache={use_cache}: {resp.status_code}"
            )
            body = resp.json()
            assert "function_error" in body, (
                f"use_cache={use_cache}: missing function_error: {body}"
            )
            assert expected_error in body["function_error"], (
                f"use_cache={use_cache}: expected {expected_error!r} in function_error, "
                f"got {body['function_error']!r}"
            )

    def test_search_partition_returns_expected_shape(self, streams_setup):
        """`/_search_partition` returns the documented shape with all expected keys."""
        session = streams_setup
        url = ZO_BASE_URL
        now = datetime.now(UTC)
        end_time = int(now.timestamp() * 1_000_000)
        ten_min_ago = int((now - timedelta(minutes=10)).timestamp() * 1_000_000)
        payload = {
            "sql": f"SELECT * FROM \"{STREAM_NAME}\" WHERE re_match(kubernetes_container_name, 'ziox')",
            "start_time": ten_min_ago,
            "end_time": end_time,
            "streaming_output": True,
        }
        resp = session.post(f"{url}api/{ORG_ID}/_search_partition?type=logs", json=payload)
        assert resp.status_code == 200, resp.text

        body = resp.json()
        for key in (
            "file_num", "records", "original_size", "compressed_size",
            "max_query_range", "partitions", "order_by", "limit",
            "streaming_output", "streaming_aggs", "streaming_id",
        ):
            assert key in body, f"partition response missing {key!r}: {body}"
        # Sanity bounds — these are 0 because the 10-min window has no new data
        # but the partition info still gets returned
        assert body["file_num"] == 0
        assert body["records"] == 0
        assert body["max_query_range"] == 1
        assert isinstance(body["partitions"], list)
        assert len(body["partitions"]) == 2, f"expected 2 partitions, got {len(body['partitions'])}"
        assert body["order_by"] == "desc"
        assert body["streaming_output"] is False
        assert body["streaming_aggs"] is False
        assert body["streaming_id"] is None

    def test_values_endpoint_returns_one_field(self, streams_setup):
        """GET /_values returns a single hit with the field name + a values list."""
        session = streams_setup
        now = datetime.now(UTC)
        end_time = int(now.timestamp() * 1_000_000)
        ten_min_ago = int((now - timedelta(minutes=10)).timestamp() * 1_000_000)
        url = (
            f"{ZO_BASE_URL}api/{ORG_ID}/{STREAM_NAME}/_values"
            f"?fields=kubernetes_container_name&size=10"
            f"&start_time={ten_min_ago}&end_time={end_time}&sql=&type=logs"
        )
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Basic {base64.b64encode(f'{ZO_ROOT_USER_EMAIL}:{ZO_ROOT_USER_PASSWORD}'.encode()).decode()}",
        }
        resp = session.get(url, headers=headers)
        assert resp.status_code == 200, resp.text

        body = resp.json()
        assert "took" in body
        assert "hits" in body
        assert "total" in body
        assert isinstance(body["hits"], list)
        assert body["total"] == 1
        assert len(body["hits"]) == 1
        assert body["hits"][0]["field"] == "kubernetes_container_name"
        assert isinstance(body["hits"][0]["values"], list)


# ===== TestStreamingEnabled — /_search_stream + SSE tests =====


class TestStreamingEnabled:
    """Tests that hit /_search_stream + /_values_stream with streaming setting ON."""

    @pytest.fixture(scope="class", autouse=True)
    def _enable_streaming(self, streams_setup):
        session = streams_setup
        _set_streaming_enabled(session, ZO_BASE_URL, enabled=True)
        return session

    @pytest.mark.parametrize(
        ("test_name", "hist_query", "expected_total", "expected_zo_sql_num"),
        _HISTOGRAM_QUERIES,
        ids=[t[0] for t in _HISTOGRAM_QUERIES],
    )
    def test_streaming_histogram(
        self, streams_setup, test_name, hist_query, expected_total, expected_zo_sql_num
    ):
        """Histogram via /_search_stream (SSE) returns the expected counts, cache + no-cache."""
        session = streams_setup
        url = ZO_BASE_URL
        now = datetime.now(UTC)
        end_time = int(now.timestamp() * 1_000_000)
        one_hour_ago = int((now - timedelta(hours=1)).timestamp() * 1_000_000)
        payload = {
            "query": {
                "sql": hist_query,
                "start_time": one_hour_ago,
                "end_time": end_time,
                "size": -1,
            }
        }
        for use_cache in (False, True):
            resp = session.post(
                f"{url}api/{ORG_ID}/_search_stream?type=logs&search_type=ui&use_cache={str(use_cache).lower()}",
                json=payload,
                stream=True,
            )
            assert resp.status_code == 200, (
                f"streaming histogram {test_name} use_cache={use_cache}: "
                f"{resp.status_code} {resp.content}"
            )
            body = read_sse_response(resp)
            total = body["results"]["total"]
            if use_cache:
                assert total == expected_total, (
                    f"streaming hist {test_name} cache total: expected {expected_total}, got {total}"
                )
            else:
                assert total >= 0
            assert total > 0, f"streaming hist {test_name} use_cache={use_cache}: no hits"
            actual_zo = body["results"]["hits"][0]["zo_sql_num"]
            assert actual_zo == expected_zo_sql_num, (
                f"streaming hist {test_name} use_cache={use_cache}: "
                f"expected zo_sql_num={expected_zo_sql_num}, got {actual_zo}"
            )

    @pytest.mark.parametrize(
        ("test_name", "sql_query", "sql_from", "sql_size", "expected_total"),
        _STREAMING_SQL_QUERIES,
        ids=[t[0] for t in _STREAMING_SQL_QUERIES],
    )
    def test_streaming_sql(
        self, streams_setup, test_name, sql_query, sql_from, sql_size, expected_total
    ):
        """SQL via /_search_stream (SSE) returns expected totals; join tolerance ±5."""
        session = streams_setup
        url = ZO_BASE_URL
        now = datetime.now(UTC)
        end_time = int(now.timestamp() * 1_000_000)
        ten_min_ago = int((now - timedelta(minutes=10)).timestamp() * 1_000_000)
        payload = {
            "query": {
                "sql": sql_query,
                "start_time": ten_min_ago,
                "end_time": end_time,
                "from": sql_from,
                "size": sql_size,
                "quick_mode": False,
            },
            "regions": [],
            "clusters": [],
        }
        # Join queries are non-deterministic by a few rows due to timing
        tolerance = 5 if "Join" in test_name else 0

        for use_cache in (False, True):
            resp = session.post(
                f"{url}api/{ORG_ID}/_search_stream?type=logs&search_type=UI&use_cache={str(use_cache).lower()}",
                json=payload,
                stream=True,
            )
            assert resp.status_code == 200, (
                f"streaming sql {test_name} use_cache={use_cache}: "
                f"{resp.status_code} {resp.content}"
            )
            body = read_sse_response(resp)
            total = body["results"]["total"]
            assert abs(total - expected_total) <= tolerance, (
                f"streaming sql {test_name} use_cache={use_cache}: "
                f"expected {expected_total} (±{tolerance}), got {total}"
            )

    def test_values_streaming_endpoint(self, streams_setup):
        """POST /_values_stream returns the documented results shape (no cache)."""
        self._values_streaming_helper(streams_setup, use_cache=False)

    def test_values_streaming_endpoint_cache(self, streams_setup):
        """POST /_values_stream returns the documented results shape (with cache)."""
        self._values_streaming_helper(streams_setup, use_cache=True)

    def _values_streaming_helper(self, session, *, use_cache: bool):
        now = datetime.now(UTC)
        end_time = int(now.timestamp() * 1_000_000)
        ten_min_ago = int((now - timedelta(minutes=10)).timestamp() * 1_000_000)
        url = f"{ZO_BASE_URL}api/{ORG_ID}/_values_stream"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Basic {base64.b64encode(f'{ZO_ROOT_USER_EMAIL}:{ZO_ROOT_USER_PASSWORD}'.encode()).decode()}",
        }
        payload = {
            "fields": ["kubernetes_container_name"],
            "size": 10,
            "no_count": False,
            "regions": [],
            "clusters": [],
            "vrl_fn": "",
            "start_time": ten_min_ago,
            "end_time": end_time,
            "timeout": 30000,
            "stream_name": STREAM_NAME,
            "stream_type": "logs",
            "use_cache": use_cache,
            "sql": "U0VMRUNUICogRlJPTSAiZGVmYXVsdCIg",  # b64: SELECT * FROM "default"
        }
        resp = session.post(url, headers=headers, json=payload)
        assert resp.status_code == 200, resp.text

        body = read_sse_response(resp)
        assert isinstance(body, dict)
        assert "results" in body
        assert isinstance(body["results"], dict)
        for key in ("cached_ratio", "from", "hits"):
            assert key in body["results"], f"results missing {key!r}: {body['results']}"
        assert isinstance(body["results"]["hits"], list)
        assert body["results"]["total"] >= 0
        assert len(body["results"]["hits"]) <= 10
        for hit in body["results"]["hits"]:
            assert "field" in hit
            assert "values" in hit
            assert isinstance(hit["values"], list)

    def test_streaming_aggs_partitions_are_cumulative_not_disjoint(self, streams_setup):
        """Pin the `/_search_stream` wire contract for `streaming_aggs: true`.

        Two DIFFERENT per-partition semantics share one SSE frame shape, and the
        `streaming_aggs` flag on the metadata frame is the only thing that tells
        them apart:

        - `streaming_aggs: false` — each response is a disjoint PAGE. `total` is
          that page's row count and the whole-query count is `Σ total`.
        - `streaming_aggs: true`  — each response is the CUMULATIVE merged
          aggregation state. THE LAST FRAME IS THE ANSWER, and `Σ total` is
          meaningless (it over-counts by roughly the partition count). `total`
          also happens to rise monotonically for a query shaped like this one's,
          but that is a property of the SHAPE and not of the contract — see the
          message on assertion 2.

        Every frontend consumer is built on top of that split, so if the emitter
        ever switched `streaming_aggs: true` to per-partition deltas, all of them
        would silently start reporting the wrong number:

        - dashboards: `web/src/composables/dashboard/usePanelSearchHandlers.ts`
          and `usePanelSQLExecutor.ts` branch on `streaming_aggs` and REPLACE the
          panel data with the newest frame — deltas would make panels show only
          the last partition's slice.
        - the Logs page: `web/src/composables/useLogs/useSearchResponseHandler.ts`
          and `useSearchPagination.ts` do `queryResults.total += results.total`,
          which is only correct on the disjoint-page side of the flag — today it
          over-counts aggregate queries by roughly the partition count.
        - the alert preview: `web/src/components/alerts/PreviewAlert.vue` sums
          `total` over partitions to decide whether an alert would fire. That sum
          is exactly the over-count being fixed, which is why assertion 4 below
          asserts BOTH that the last frame matches non-streaming `/_search` AND
          that the sum does not — i.e. that summing is wrong, not just different.

        Server side, the guarantee lives in
        `src/search_service/src/streaming/execution.rs` ("Only accumulate the
        results of the last partition", and the SSE frame stamped with the flag)
        and `src/search_service/src/streaming/collect.rs::fold_response`. Before
        this test its only coverage was a unit test on that private fold helper —
        nothing pinned the HTTP boundary.
        """
        session = streams_setup
        url = ZO_BASE_URL

        # One window + one SQL string, reused verbatim by all three calls below,
        # so the streaming and non-streaming runs cover exactly the same rows.
        # 30 minutes is deliberate: it is under STREAM_NAME's max_query_range=1h
        # (set by streams_setup) so neither call gets its range clamped, and it
        # is >= 15 min, which is what puts the streaming-aggs partition ladder on
        # its 5-minute interval and so yields several partitions.
        end_time = int(datetime.now(UTC).timestamp() * 1_000_000)
        start_time = end_time - 30 * 60 * 1_000_000
        # No histogram() and no _timestamp anywhere in the projection or ORDER BY:
        # that is what makes the server's `ts_column` None, which together with
        # "simple aggregate query" is the precondition for the streaming-aggs path
        # (src/search_service/src/partition/aggregate.rs::is_streaming_aggregate).
        sql = (
            "SELECT kubernetes_container_name, COUNT(*) AS cnt "
            f'FROM "{STREAM_NAME}" GROUP BY kubernetes_container_name'
        )

        # --- precondition guard -------------------------------------------------
        # Two independent server-side conditions can switch the streaming-aggs path
        # off, and either one makes every assertion below pass vacuously, so ask
        # the planner before asserting anything:
        #
        # 1. ZO_FEATURE_QUERY_STREAMING_AGGS is force-disabled when the disk cache
        #    is off (src/config/src/config.rs, "disable result cache if disk cache
        #    is disabled").
        # 2. search_partition() collapses an aggregate query to ONE partition when
        #    `total_secs <= aggs_min_num_partition_secs` (default 3) —
        #    src/search_service/src/lib.rs:635-645. The non-obvious part:
        #    `total_secs` is derived from `stream_files.original_size`, which counts
        #    PARQUET FILES ONLY (src/search_service/src/partition/stream_files.rs
        #    calls file_list::query_ids). Freshly ingested rows are still in the WAL
        #    memtable and contribute 0 bytes, so `total_secs` is 0 and the planner
        #    returns a single partition — on ANY size of test fixture. Even after a
        #    WAL flush, query_group_base_speed is 1 GB/s/core, so a few-MB fixture
        #    still gives total_secs = 1 <= 3.
        #
        # Neither is reachable over HTTP: `aggs_min_num_partition_secs` is read as
        # `get_config().limit.*`, which comes from the process env / server-side
        # .env at init. Unlike `enable_streaming_search` (an org row in the DB, which
        # is why the _enable_streaming fixture can flip it at runtime), no settings
        # endpoint writes it, so this test cannot arrange its own precondition.
        #
        # A THIRD hazard, which unlike the two above is NOT fixable from here:
        # this probe plans with the result cache ON while the run it guards
        # executes with it OFF, so the two disagree about the plan. `use_cache`
        # is a URL query param on `/_search_stream`
        # (src/api/search/src/search/search_stream.rs:429, via
        # get_use_cache_from_request), but `/_search_partition` reads no such
        # param and its body type has no such field — the handler passes a
        # literal `true` as the use_cache argument
        # (src/api/search/src/search/mod.rs:1432-1440; SearchPartitionRequest is
        # src/config/src/meta/search.rs:620-640). Adding "use_cache" below would
        # be silently dropped by serde rather than honoured, so it is left out
        # on purpose. The consequence is a FALSE SKIP, never a false pass:
        # prepare_streaming_aggregate(.., use_cache) skips cache discovery when
        # it is false (src/search_service/src/partition/aggregate.rs:105-107),
        # while the probe's `true` can find a warm cache and return the
        # FullyCached strategy, which collapses to ONE partition
        # (src/search/src/cache/streaming_agg/partition_optimizer.rs:76-88).
        # The streaming-aggs cache key is time-independent (sql + vrl + regions
        # + clusters, src/search/src/cache/streaming_agg/files.rs:433-447), so an
        # earlier cached run of this same SQL can skip a run that would in fact
        # have produced the many partitions the guard is looking for.
        partition_payload = {
            "sql": sql,
            "start_time": start_time,
            "end_time": end_time,
            "streaming_output": True,
        }
        part_resp = session.post(
            f"{url}api/{ORG_ID}/_search_partition?type=logs", json=partition_payload
        )
        assert part_resp.status_code == 200, part_resp.text
        part_body = part_resp.json()
        partitions = part_body.get("partitions") or []
        if part_body.get("streaming_aggs") is not True or len(partitions) < 2:
            pytest.skip(
                "THE STREAMING-AGGS WIRE CONTRACT IS NOT PINNED ON THIS INSTANCE — "
                "this is a COVERAGE GAP, not a passing test. The planner did not "
                "return a streaming-aggs plan for this query "
                f"(streaming_aggs={part_body.get('streaming_aggs')!r}, "
                f"partitions={len(partitions)}), so the cumulative-vs-disjoint "
                "semantics that dashboards, the Logs page and the alert preview all "
                "depend on went unverified. To actually run it the SERVER needs: "
                "ZO_AGGS_MIN_NUM_PARTITIONS_SECS=0 (required — the default of 3 "
                "collapses every aggregate query over WAL-resident test data to a "
                "single partition; see the comment above) and "
                "ZO_FEATURE_QUERY_STREAMING_AGGS=true (on by default, but force-"
                "disabled when the disk cache is off). Neither is settable over the "
                "API; both must be in the server's environment at boot, or in its "
                ".env followed by a root-only GET /config/reload."
            )

        # --- the streaming run --------------------------------------------------
        # use_cache=false on purpose: it keeps the partition ladder deterministic
        # (no FullyCached/Hybrid collapse) and suppresses the cached-response frame,
        # which is emitted with streaming_aggs=false and would defeat assertion 1.
        #
        # DO NOT ADD "track_total_hits" TO THE QUERY BELOW. Streaming output is
        # only switched on when `streaming_output && !track_total_hits`
        # (src/search_service/src/lib.rs:163-165), so a `true` there disables the
        # streaming-aggs path wholesale: no frame carries streaming_aggs=true,
        # the guard above skips every run, and NOTHING in that skip message —
        # which talks only about server env vars — points at track_total_hits as
        # the cause. Leave it absent.
        stream_payload = {
            "query": {
                "sql": sql,
                "start_time": start_time,
                "end_time": end_time,
                "from": 0,
                "size": -1,
                "quick_mode": False,
            },
            "regions": [],
            "clusters": [],
        }
        resp = session.post(
            f"{url}api/{ORG_ID}/_search_stream?type=logs&search_type=UI&use_cache=false",
            json=stream_payload,
            stream=True,
        )
        assert resp.status_code == 200, f"{resp.status_code} {resp.content}"

        # read_sse_response() collapses the frames (max total, hits concatenated)
        # and so cannot see per-frame semantics — the raw frame list is the point.
        frames = read_sse_frames(resp)
        meta_idx = [i for i, (event, _) in enumerate(frames) if event == "search_response_metadata"]
        assert meta_idx, f"no metadata frames in SSE response: {frames}"
        metas = [frames[i][1] for i in meta_idx]
        # LOAD-BEARING — do not relax or delete this as a redundant restatement
        # of the planner's partition count. A single streaming-aggs frame is
        # simultaneously the "delta" and the cumulative total, so with one frame
        # every assertion below passes under BOTH semantics and the very
        # ambiguity this test exists to detect becomes invisible. This is the
        # only thing standing between this test and a silent tautology.
        assert len(metas) > 1, (
            f"expected one metadata frame per partition (planner reported "
            f"{len(partitions)}), got {len(metas)} — with a single frame this test "
            "cannot distinguish cumulative from disjoint"
        )

        # 1. Every metadata frame must carry the flag. A single false frame means
        #    a consumer switching on it would treat that partition as a page.
        for i, meta in enumerate(metas):
            assert meta.get("streaming_aggs") is True, (
                f"metadata frame {i}/{len(metas)}: expected streaming_aggs=True, "
                f"got {meta.get('streaming_aggs')!r}"
            )

        # How the frames are expected to line up, which is load-bearing for both
        # assertion 2 and assertion 4 and is NOT obvious from the wire:
        # partitions come back NEWEST-FIRST — `to_time_partitions(sql_order_by)`
        # reverses on OrderBy::Desc, which is the default when the SQL has no ORDER
        # BY, and `search_type=UI` with `size == -1` skips the re-sort in
        # execution.rs. streams_setup's rows all carry ~the same ingest timestamp,
        # so they land in FRAME 0 and totals read [K, K, K, ...]: the accumulator
        # reaches its final value immediately and later (empty) partitions re-emit
        # it. Were the order ascending instead, the rows would land in the LAST
        # frame, totals would read [0, ..., 0, K], and `sum == last` would fail
        # assertion 4's second clause for a reason that has nothing to do with the
        # contract. The same shape appears if this test runs more than ~25 minutes
        # after streams_setup, once the rows have aged into the oldest 5-minute
        # partition of the window — see the message on that assertion.
        #
        # 2. Cumulative state never shrinks — for THIS query shape; see below.
        totals = [meta["results"]["total"] for meta in metas]
        assert totals == sorted(totals), (
            "this fixture's totals must be non-decreasing: its query is a bare "
            "GROUP BY with no HAVING and no LIMIT, so merging another partition "
            "can only add groups, never remove one. That is a property of THIS "
            "query shape, not a general streaming-aggs guarantee — a shrinking "
            "HAVING (`< N`, `!= N`) or a top-k makes the merged total FALL as "
            "more data arrives, which is why the frontend takes the last frame "
            f"rather than the max. Got {totals}"
        )

        # 3. The last frame's total describes the last frame's OWN hits, not a
        #    running sum of hits the client was expected to keep.
        last_hits: list[dict] = []
        for event, data in frames[meta_idx[-1] + 1:]:
            if event == "search_response_hits":
                last_hits.extend(data.get("hits") or [])
        assert totals[-1] == len(last_hits), (
            f"last frame reports total={totals[-1]} but carries {len(last_hits)} hits"
        )

        # --- 4. the load-bearing one: same SQL, same window, no streaming --------
        non_streaming = session.post(
            f"{url}api/{ORG_ID}/_search?type=logs&search_type=UI&use_cache=false",
            json={
                "query": {
                    "sql": sql,
                    "start_time": start_time,
                    "end_time": end_time,
                    "from": 0,
                    "size": -1,
                }
            },
        )
        assert non_streaming.status_code == 200, non_streaming.text
        non_streaming_hits = non_streaming.json().get("hits") or []
        assert len(non_streaming_hits) > 0, (
            "non-streaming /_search returned no rows for the same window — the "
            "comparison below would be vacuous"
        )
        # The last frame IS the answer...
        assert totals[-1] == len(non_streaming_hits), (
            f"last streaming-aggs frame total={totals[-1]} but non-streaming "
            f"/_search returned {len(non_streaming_hits)} rows for the same SQL "
            f"and window; per-frame totals were {totals}"
        )
        # ...and summing the frames is WRONG, not merely a different spelling of
        # the same number. If the emitter ever switches to per-partition deltas
        # under an ascending ladder, Σ totals collapses onto the correct answer
        # and this fires.
        #
        # DO NOT DELETE THIS AS REDUNDANT. Taken alone it is close to a tautology:
        # given assertion 2 (non-decreasing) and >1 frame with positive totals,
        # `sum > last` is arithmetic, not a fact about the server. Its value is
        # semantic and only exists in combination with the clause directly above.
        # Together the two say the thing no other assertion here says: the number
        # PreviewAlert.vue computes by summing is NOT the number /_search returns.
        # That is the statement the frontend fix depends on, so it is asserted
        # rather than left as prose.
        assert sum(totals) > totals[-1], (
            f"summing streaming-aggs totals ({sum(totals)}) equals the correct "
            f"answer ({totals[-1]}) across {len(totals)} frames — the frames are "
            "no longer cumulative, so every consumer that takes only the last "
            "frame (dashboards, Logs, alert preview) now under-counts. "
            f"(per-frame totals: {totals}. If they read [0, ..., 0, N] instead, "
            "the module's ingested rows have aged into the OLDEST partition of "
            "this 30-minute window — this class already assumes it runs within "
            "~10 minutes of streams_setup, so that is an infrastructure problem, "
            "not a contract break.)"
        )

    def test_streaming_sql_query_range_function_error(self, streams_setup):
        """A 61-min query window via /_search_stream returns the function_error message."""
        session = streams_setup
        url = ZO_BASE_URL
        now = datetime.now(UTC)
        end_time = int(now.timestamp() * 1_000_000)
        sixty_one_min_ago = int((now - timedelta(minutes=61)).timestamp() * 1_000_000)
        payload = {
            "query": {
                "sql": f'SELECT count(*) AS _max_query_range FROM "{STREAM_NAME}"',
                "start_time": sixty_one_min_ago,
                "end_time": end_time,
                "from": 0,
                "size": 50,
                "quick_mode": False,
            },
        }
        expected_error = "Query duration is modified due to query range restriction of 1 hours"

        for use_cache in (False, True):
            resp = session.post(
                f"{url}api/{ORG_ID}/_search_stream?type=logs&search_type=UI&use_cache={str(use_cache).lower()}",
                json=payload,
                stream=True,
            )
            assert resp.status_code == 200, (
                f"use_cache={use_cache}: {resp.status_code}"
            )
            body = read_sse_response(resp)
            assert "function_error" in body["results"], (
                f"use_cache={use_cache}: missing function_error: {body}"
            )
            assert expected_error in body["results"]["function_error"], (
                f"use_cache={use_cache}: expected {expected_error!r}, got "
                f"{body['results']['function_error']!r}"
            )
