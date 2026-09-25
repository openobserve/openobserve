"""SQL LIMIT precedence and awkward stream names  [regressions #8372, #10378].

#8372 (PR #14473): an explicit SQL `LIMIT` must win over the request's `size`.
`_search` already honoured it because `AddSortAndLimit` leaves an existing Limit
node alone; the streaming path did not. The contract asserted here is the one
both paths must agree on -- LIMIT decides, size does not override it.

#10378 (PR #10394): a stream whose name contains `:` produced a ParserError
because the name was interpolated into SQL unquoted. Quoting it fixes the parse,
so the assertion is that such a stream is queryable at all.
"""

import logging
import os
import time
import uuid

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

ORG_ID = os.environ.get("TEST_ORG_ID", "default")

def _drop(session, base_url, stream, stream_type="logs"):
    """Follows the suite convention: the test that seeds a stream drops it."""
    session.delete(f"{base_url}api/{ORG_ID}/streams/{stream}?type={stream_type}")

ROW_COUNT = 30
SQL_LIMIT = 7
REQUEST_SIZE = 100


def _window():
    now = int(time.time() * 1_000_000)
    return now - 3_600_000_000, now + 60_000_000


def _seed(session, base_url, stream, rows=ROW_COUNT):
    now = int(time.time() * 1_000_000)
    payload = [
        {"_timestamp": now - i * 1_000_000, "job": "pytest_sql_limit", "n": i,
         "message": f"row {i}"}
        for i in range(rows)
    ]
    resp = session.post(f"{base_url}api/{ORG_ID}/{stream}/_json", json=payload)
    assert resp.status_code == 200, f"ingest failed: {resp.status_code} {resp.text[:400]}"

    start, end = _window()
    for _ in range(30):
        r = session.post(
            f"{base_url}api/{ORG_ID}/_search?type=logs",
            json={"query": {"sql": f'SELECT count(*) AS n FROM "{stream}"',
                            "start_time": start, "end_time": end, "from": 0, "size": 1}},
        )
        if r.status_code == 200 and (r.json().get("hits") or [{}])[0].get("n", 0) >= rows:
            return
        time.sleep(1)
    raise AssertionError(f"stream {stream} never became searchable")


def test_explicit_sql_limit_wins_over_request_size(create_session, base_url):
    """`LIMIT 7` with `size: 100` must return 7 rows, not 100."""
    session = create_session
    stream = f"e2e_sqllimit_{uuid.uuid4().hex[:8]}"
    try:
        _seed(session, base_url, stream)
        start, end = _window()

        resp = session.post(
            f"{base_url}api/{ORG_ID}/_search?type=logs",
            json={"query": {
                "sql": f'SELECT * FROM "{stream}" ORDER BY _timestamp DESC LIMIT {SQL_LIMIT}',
                "start_time": start, "end_time": end, "from": 0, "size": REQUEST_SIZE,
            }},
        )
        assert resp.status_code == 200, f"search failed: {resp.status_code} {resp.text[:400]}"
        hits = resp.json().get("hits", [])
        logger.info("LIMIT %s with size %s returned %s rows", SQL_LIMIT, REQUEST_SIZE, len(hits))

        # There are more rows than the LIMIT, so a build that ignores it returns more.
        assert len(hits) == SQL_LIMIT, \
            f"explicit SQL LIMIT {SQL_LIMIT} must decide the row count, got {len(hits)}"
    finally:
        _drop(session, base_url, stream)

def test_request_size_still_applies_without_an_explicit_limit(create_session, base_url):
    """A negative control: with no SQL LIMIT, `size` is what caps the result."""
    session = create_session
    stream = f"e2e_sqllimit_{uuid.uuid4().hex[:8]}"
    try:
        _seed(session, base_url, stream)
        start, end = _window()

        size = 5
        resp = session.post(
            f"{base_url}api/{ORG_ID}/_search?type=logs",
            json={"query": {"sql": f'SELECT * FROM "{stream}"',
                            "start_time": start, "end_time": end, "from": 0, "size": size}},
        )
        assert resp.status_code == 200, f"search failed: {resp.status_code} {resp.text[:400]}"
        hits = resp.json().get("hits", [])
        logger.info("no SQL LIMIT, size %s returned %s rows", size, len(hits))
        assert len(hits) == size, f"size must cap the result when the SQL has no LIMIT, got {len(hits)}"
    finally:
        _drop(session, base_url, stream)

def test_stream_name_containing_a_colon_is_queryable(create_session, base_url):
    """A `:` in the stream name must be quoted into the SQL, not raise a ParserError."""
    session = create_session
    stream = f"e2e:colon:{uuid.uuid4().hex[:6]}"
    try:
        _seed(session, base_url, stream, rows=5)
        start, end = _window()

        resp = session.post(
            f"{base_url}api/{ORG_ID}/_search?type=logs",
            json={"query": {"sql": f'SELECT * FROM "{stream}"',
                            "start_time": start, "end_time": end, "from": 0, "size": 10}},
        )
        logger.info("colon-named stream answered %s", resp.status_code)
        assert resp.status_code == 200, \
            f"a colon in the stream name must not break parsing: {resp.status_code} {resp.text[:400]}"
        assert "ParserError" not in resp.text, f"ParserError surfaced: {resp.text[:300]}"
        assert len(resp.json().get("hits", [])) == 5, "all seeded rows must come back"
    finally:
        _drop(session, base_url, stream)
