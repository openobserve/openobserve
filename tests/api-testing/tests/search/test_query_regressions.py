"""
Search/query regressions from the closed Needs-Automation queue.

Covers openobserve#3864, #6771, #7502 and #9664. Each assertion was taken from
the behaviour observed against a live deployment first, not from the issue text.

The module seeds its own stream rather than leaning on `stream_pytest_data`,
because three of the four need specific numeric and categorical columns to
order and group by.
"""

import logging
import os
import time

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

ORG_ID = os.environ.get("TEST_ORG_ID", "default")
ROW_COUNT = 40
LEVELS = ["info", "warn", "error"]


def _window():
    now = int(time.time() * 1_000_000)
    return now - 3_600_000_000, now


def _search(session, base_url, sql, size=100, use_cache=False):
    start, end = _window()
    resp = session.post(
        f"{base_url}api/{ORG_ID}/_search?type=logs&use_cache={'true' if use_cache else 'false'}",
        json={"query": {"sql": sql, "start_time": start, "end_time": end, "from": 0, "size": size}},
    )
    assert resp.status_code == 200, f"search failed: {resp.status_code} {resp.text}"
    return resp.json()


def _partition(session, base_url, payload):
    return session.post(f"{base_url}api/{ORG_ID}/_search_partition?type=logs", json=payload)


def _seed(session, base_url, stream):
    now = int(time.time() * 1_000_000)
    rows = [
        {
            "_timestamp": now - i * 1_000_000,
            "level": LEVELS[i % len(LEVELS)],
            "code": 200 + i,
            "val": (i * 7) % 13,
            "job": "pytest_query_regression",
            "message": f"row {i}",
        }
        for i in range(ROW_COUNT)
    ]
    resp = session.post(f"{base_url}api/{ORG_ID}/{stream}/_json", json=rows)
    assert resp.status_code == 200, f"ingest failed: {resp.status_code} {resp.text}"

    # The ingest ack lands before the rows are searchable.
    for _ in range(30):
        hits = _search(session, base_url, f'SELECT * FROM "{stream}"').get("hits", [])
        if len(hits) >= ROW_COUNT:
            return
        time.sleep(1)
    raise AssertionError(f"{stream} never became searchable with {ROW_COUNT} rows")


def _drop(session, base_url, stream):
    session.delete(f"{base_url}api/{ORG_ID}/streams/{stream}?type=logs")


class TestQueryRegressions:
    def test_max_with_alias_returns_a_value(self, create_session, base_url, random_string):
        """#3864: MAX(_timestamp) aliased to latest_timestamp returned nothing."""
        session = create_session
        stream = f"pytest_3864_{random_string(6).lower()}"
        _seed(session, base_url, stream)
        try:
            body = _search(
                session, base_url,
                f'SELECT MAX(_timestamp) as latest_timestamp FROM "{stream}"',
            )
            hits = body.get("hits", [])
            logger.info("#3864 hits: %s", hits)

            assert len(hits) == 1, f"#3864: an aggregate must return exactly one row, got {hits}"
            assert "latest_timestamp" in hits[0], \
                f"#3864: the alias must be projected, got keys {list(hits[0])}"
            assert isinstance(hits[0]["latest_timestamp"], int) and hits[0]["latest_timestamp"] > 0, \
                f"#3864: the alias must carry the max timestamp, got {hits[0]}"
        finally:
            _drop(session, base_url, stream)

    def test_partition_api_accepts_a_distinct_query(self, create_session, base_url, random_string):
        """#6771: the page-count/partition call failed once streaming_output was in the payload."""
        session = create_session
        stream = f"pytest_6771_{random_string(6).lower()}"
        _seed(session, base_url, stream)
        start, end = _window()
        try:
            distinct_sql = f'SELECT DISTINCT(level) FROM "{stream}"'

            resp = _partition(session, base_url,
                              {"sql": distinct_sql, "start_time": start, "end_time": end})
            assert resp.status_code == 200, \
                f"#6771: a DISTINCT partition request must succeed, got {resp.status_code} {resp.text}"
            assert resp.json().get("partitions"), \
                f"#6771: the response must carry partitions, got {resp.text[:200]}"

            # streaming_output is the key whose presence used to break this.
            resp = _partition(session, base_url, {
                "sql": distinct_sql, "start_time": start, "end_time": end,
                "streaming_output": True,
            })
            assert resp.status_code == 200, (
                f"#6771: streaming_output in the partition payload must be tolerated, "
                f"got {resp.status_code} {resp.text}"
            )
            assert resp.json().get("partitions"), \
                f"#6771: partitions must still be returned with streaming_output set, got {resp.text[:200]}"
        finally:
            _drop(session, base_url, stream)

    def test_order_by_is_honored_on_a_derived_column(self, create_session, base_url, random_string):
        """#7502: ORDER BY was dropped when the SQL carried a derived filter."""
        session = create_session
        stream = f"pytest_7502_{random_string(6).lower()}"
        _seed(session, base_url, stream)
        try:
            body = _search(
                session, base_url,
                f'SELECT CAST(code AS BIGINT) as c FROM "{stream}" '
                f'WHERE CAST(code AS BIGINT) > 210 ORDER BY c DESC',
                size=50,
            )
            values = [h["c"] for h in body.get("hits", [])]
            logger.info("#7502 derived values: %s", values[:15])

            assert len(values) > 1, \
                f"#7502: the derived filter must still return rows to order, got {values}"
            assert values == sorted(values, reverse=True), \
                f"#7502: ORDER BY c DESC must be honored alongside a derived filter, got {values}"
            assert min(values) > 210, \
                f"#7502: the derived filter must actually apply, got {values}"
        finally:
            _drop(session, base_url, stream)

    def test_order_by_is_stable_across_repeats_and_cache_modes(
        self, create_session, base_url, random_string
    ):
        """#9664: ORDER BY failed intermittently, with and without cache."""
        session = create_session
        stream = f"pytest_9664_{random_string(6).lower()}"
        _seed(session, base_url, stream)
        try:
            sql = f'SELECT val FROM "{stream}" ORDER BY val DESC'
            baseline = None

            # The bug was intermittent, so one pass proves nothing: repeat, and
            # cover both cache paths since the report named both.
            for attempt in range(3):
                for use_cache in (False, True):
                    values = [h["val"] for h in
                              _search(session, base_url, sql, size=50, use_cache=use_cache).get("hits", [])]
                    assert values == sorted(values, reverse=True), (
                        f"#9664: ORDER BY val DESC must hold on attempt {attempt + 1} "
                        f"(use_cache={use_cache}), got {values}"
                    )
                    if baseline is None:
                        baseline = values
                    else:
                        assert values == baseline, (
                            f"#9664: the same query must return the same order every time; "
                            f"attempt {attempt + 1} (use_cache={use_cache}) gave {values}, "
                            f"baseline was {baseline}"
                        )
            logger.info("#9664 stable order across 6 runs: %s", baseline[:15])
        finally:
            _drop(session, base_url, stream)
