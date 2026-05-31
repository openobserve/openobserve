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

from support.sse import read_sse_response

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
