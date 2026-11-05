"""histogram() buckets must not depend on partitions, the index, or the result cache.

histogram() counts from 2001-01-01 UTC. Partition edges, the index fast path, and the
result cache counted from 1970-01-01 UTC. The two grids differ for any interval that
does not divide 978,307,200 seconds, such as 7 hours. The 30-day dashboard bug has the
same cause, but a 7-hour bucket fits inside the backfill window of this suite.

The expected rows come from the fixture. Another query cannot give them, because a
filter does not always stop the fast path.
"""

import datetime as dt
import logging
import os
import time
import uuid

import pytest

logger = logging.getLogger(__name__)

ORG_ID = os.environ.get("TEST_ORG_ID", "default")
ORIGIN_SECS = 978_307_200
HOUR = 3_600_000_000
# 7 hours and 5 hours do not divide the origin. 1 hour does, so it is the control.
INTERVALS_HOURS = [7, 5, 1]
EVENTS_PER_HOUR = 4
FIXTURE_HOURS = 42


def _bucket_edge(ts, interval, offset=0):
    return ts - (ts + offset - ORIGIN_SECS * 1_000_000) % interval


def _label(ts):
    moment = dt.datetime.fromtimestamp(ts / 1_000_000, tz=dt.timezone.utc)
    return moment.strftime("%Y-%m-%dT%H:%M:%S")


def _expected_rows(events, start, end, interval, offset=0):
    rows = {}
    for ts in events:
        if start <= ts < end:
            label = _label(_bucket_edge(ts, interval, offset) + offset)
            rows[label] = rows.get(label, 0) + 1
    return rows


class Fixture:
    def __init__(self, session, base_url):
        self.session = session
        self.base_url = base_url
        self.stream = f"e2e_hist_origin_{uuid.uuid4().hex[:8]}"
        # Stay inside the ZO_INGEST_ALLOWED_UPTO window of 48 hours, and on a whole hour.
        self.start = (int(time.time()) // 3600 - FIXTURE_HOURS - 1) * 1_000_000 * 3600
        self.end = self.start + FIXTURE_HOURS * HOUR
        step = HOUR // EVENTS_PER_HOUR
        self.events = list(range(self.start + step // 2, self.end, step))

    def ingest(self):
        rows = [{"_timestamp": ts, "kind": "origin"} for ts in self.events]
        resp = self.session.post(
            f"{self.base_url}api/{ORG_ID}/{self.stream}/_json", json=rows
        )
        assert resp.status_code == 200, f"ingest failed: {resp.status_code} {resp.text[:300]}"

    def search(self, sql, start, end, use_cache=False, **query):
        resp = self.session.post(
            f"{self.base_url}api/{ORG_ID}/_search?type=logs&use_cache={str(use_cache).lower()}",
            json={
                "query": {"sql": sql, "start_time": start, "end_time": end,
                          "from": 0, "size": -1, **query},
            },
        )
        assert resp.status_code == 200, f"search failed: {resp.status_code} {resp.text[:300]}"
        return resp.json()

    def wait_until_searchable(self):
        sql = f'SELECT count(*) AS cnt FROM "{self.stream}"'
        for _ in range(60):
            hits = self.search(sql, self.start, self.end).get("hits", [])
            if hits and hits[0]["cnt"] == len(self.events):
                return
            time.sleep(1)
        pytest.fail(f"{self.stream} did not reach {len(self.events)} events")

    def drop(self):
        self.session.delete(f"{self.base_url}api/{ORG_ID}/streams/{self.stream}?type=logs")


@pytest.fixture(scope="module")
def fixture(create_session, base_url):
    data = Fixture(create_session, base_url)
    data.ingest()
    data.wait_until_searchable()
    yield data
    data.drop()


def _sql(stream, hours, filtered, timezone=None):
    tz_arg = f", '{timezone}'" if timezone else ""
    where = " WHERE kind = 'origin'" if filtered else ""
    return (
        f"SELECT histogram(_timestamp, '{hours} hours'{tz_arg}) AS ts, count(*) AS cnt "
        f'FROM "{stream}"{where} GROUP BY ts ORDER BY ts'
    )


def _rows(body):
    labels = [hit["ts"] for hit in body["hits"]]
    assert len(labels) == len(set(labels)), f"a bucket returned twice: {labels}"
    return {hit["ts"]: hit["cnt"] for hit in body["hits"]}


def _warm_cache(fixture, sql, start, end, expected, **query):
    """Reports the cache ratio, because a test that never hits the cache proves nothing."""
    assert _rows(fixture.search(sql, start, end, use_cache=True, **query)) == expected
    for _ in range(30):
        body = fixture.search(sql, start, end, use_cache=True, **query)
        assert _rows(body) == expected
        if body.get("result_cache_ratio", 0) > 0:
            return
        time.sleep(1)
    pytest.fail(f"cache was never used for {sql}")


@pytest.mark.parametrize("filtered", [False, True], ids=["plain", "filtered"])
@pytest.mark.parametrize("hours", INTERVALS_HOURS)
def test_cache_off_rows_match_the_fixture(fixture, hours, filtered):
    interval = hours * HOUR
    sql = _sql(fixture.stream, hours, filtered)
    expected = _expected_rows(fixture.events, fixture.start, fixture.end, interval)
    assert _rows(fixture.search(sql, fixture.start, fixture.end)) == expected


@pytest.mark.parametrize("filtered", [False, True], ids=["plain", "filtered"])
@pytest.mark.parametrize("hours", INTERVALS_HOURS)
def test_a_request_inside_the_last_cached_bucket_counts_only_its_range(fixture, hours, filtered):
    interval = hours * HOUR
    sql = _sql(fixture.stream, hours, filtered)
    first_edge = _bucket_edge(fixture.start, interval) + interval
    last_edge = _bucket_edge(fixture.end, interval)
    expected = _expected_rows(fixture.events, first_edge, last_edge, interval)
    _warm_cache(fixture, sql, first_edge, last_edge, expected)

    shorter_end = last_edge - interval // 2
    expected = _expected_rows(fixture.events, first_edge, shorter_end, interval)
    assert _rows(fixture.search(sql, first_edge, shorter_end)) == expected
    assert _rows(fixture.search(sql, first_edge, shorter_end, use_cache=True)) == expected

    # A later start inside a cached bucket must also leave that bucket partial.
    later_start = first_edge + interval // 2
    expected = _expected_rows(fixture.events, later_start, last_edge, interval)
    assert _rows(fixture.search(sql, later_start, last_edge, use_cache=True)) == expected


@pytest.mark.parametrize("filtered", [False, True], ids=["plain", "filtered"])
def test_date_bin_with_its_own_origin_keeps_its_labels(fixture, filtered):
    where = " WHERE kind = 'origin'" if filtered else ""
    sql = (
        "SELECT date_bin(interval '7 hours', to_timestamp_micros(_timestamp), "
        f"to_timestamp_micros('1970-01-01T00:00:00')) AS ts, count(*) AS cnt FROM \"{fixture.stream}\"{where} "
        "GROUP BY ts ORDER BY ts"
    )
    interval = 7 * HOUR
    expected = {}
    for ts in fixture.events:
        label = _label(ts - ts % interval)
        expected[label] = expected.get(label, 0) + 1
    assert _rows(fixture.search(sql, fixture.start, fixture.end)) == expected
