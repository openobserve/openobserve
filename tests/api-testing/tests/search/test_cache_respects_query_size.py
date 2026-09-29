"""The result cache must key on query size  [regression #10382].

`query.size` was missing from the cache hash, so a second search for the same
SQL over the same range with a DIFFERENT size was served the first size's cached
rows. PR #10384 includes size in the hash.

Order matters: the small query must run first so its result is what a
size-blind cache would wrongly replay for the larger one.
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

ROW_COUNT = 40
SMALL, LARGE = 5, 25


def _seed(session, base_url, stream):
    now = int(time.time() * 1_000_000)
    rows = [{"_timestamp": now - i * 1_000_000, "job": "pytest_cache_size", "n": i}
            for i in range(ROW_COUNT)]
    r = session.post(f"{base_url}api/{ORG_ID}/{stream}/_json", json=rows)
    assert r.status_code == 200, f"ingest failed: {r.status_code} {r.text[:300]}"
    start, end = now - 3_600_000_000, now + 60_000_000
    for _ in range(30):
        q = session.post(f"{base_url}api/{ORG_ID}/_search?type=logs",
                         json={"query": {"sql": f'SELECT count(*) AS n FROM "{stream}"',
                                         "start_time": start, "end_time": end,
                                         "from": 0, "size": 1}})
        if q.status_code == 200 and (q.json().get("hits") or [{}])[0].get("n", 0) >= ROW_COUNT:
            return start, end
        time.sleep(1)
    raise AssertionError(f"stream {stream} never became searchable")


def test_cached_result_is_not_replayed_for_a_different_size(create_session, base_url):
    session = create_session
    stream = f"e2e_cachesize_{uuid.uuid4().hex[:8]}"
    try:
        start, end = _seed(session, base_url, stream)
        sql = f'SELECT * FROM "{stream}" ORDER BY _timestamp DESC'

        def run(size):
            r = session.post(
                f"{base_url}api/{ORG_ID}/_search?type=logs&use_cache=true",
                json={"query": {"sql": sql, "start_time": start, "end_time": end,
                                "from": 0, "size": size}},
            )
            assert r.status_code == 200, f"search failed: {r.status_code} {r.text[:300]}"
            return len(r.json().get("hits", []))

        small = run(SMALL)
        large = run(LARGE)
        logger.info("size %s -> %s rows; size %s -> %s rows", SMALL, small, LARGE, large)

        assert small == SMALL, f"first query must return {SMALL} rows, got {small}"
        # A size-blind cache replays the first result here, returning SMALL again.
        assert large == LARGE, \
            f"second query must return {LARGE} rows, got {large} (cache ignored query size)"
    finally:
        _drop(session, base_url, stream)
