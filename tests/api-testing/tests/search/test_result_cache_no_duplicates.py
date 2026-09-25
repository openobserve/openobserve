"""The result cache must not return duplicate records  [regression #4274].

Overlapping cached ranges replayed rows that the fresh half of the query also
returned, so a search spanning a cached window came back with duplicates. PR
#4293 dedupes on timestamp.

The first query must be cached and the second must OVERLAP it -- a
non-overlapping range exercises nothing, and running only one query cannot
produce the duplication at all.
"""

import logging
import os
import time
import uuid

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

ORG_ID = os.environ.get("TEST_ORG_ID", "default")
ROW_COUNT = 40


def test_overlapping_cached_ranges_do_not_duplicate_rows(create_session, base_url):
    session = create_session
    stream = f"e2e_cachedup_{uuid.uuid4().hex[:8]}"
    now = int(time.time() * 1_000_000)
    rows = [{"_timestamp": now - i * 1_000_000, "job": "pytest_cache_dup", "n": i}
            for i in range(ROW_COUNT)]
    r = session.post(f"{base_url}api/{ORG_ID}/{stream}/_json", json=rows)
    assert r.status_code == 200, f"ingest failed: {r.status_code} {r.text[:300]}"

    oldest = now - (ROW_COUNT - 1) * 1_000_000
    sql = f'SELECT _timestamp, n FROM "{stream}" ORDER BY _timestamp DESC'

    def run(start, end):
        resp = session.post(
            f"{base_url}api/{ORG_ID}/_search?type=logs&use_cache=true",
            json={"query": {"sql": sql, "start_time": start, "end_time": end,
                            "from": 0, "size": 200}},
        )
        assert resp.status_code == 200, f"search failed: {resp.status_code} {resp.text[:300]}"
        return resp.json().get("hits", [])

    for _ in range(30):
        if len(run(oldest - 60_000_000, now + 60_000_000)) >= ROW_COUNT:
            break
        time.sleep(1)

    # Warm the cache over the inner half, then query a window that overlaps it.
    inner = run(oldest + 10 * 1_000_000, now - 5 * 1_000_000)
    outer = run(oldest - 60_000_000, now + 60_000_000)
    logger.info("inner=%s outer=%s rows", len(inner), len(outer))

    stamps = [h["_timestamp"] for h in outer]
    dupes = {t for t in stamps if stamps.count(t) > 1}
    assert not dupes, f"{len(dupes)} timestamps were returned more than once: {sorted(dupes)[:5]}"
    assert len(stamps) == len(set(stamps)) == ROW_COUNT, \
        f"expected {ROW_COUNT} unique rows, got {len(stamps)} ({len(set(stamps))} unique)"
