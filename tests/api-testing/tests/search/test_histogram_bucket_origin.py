"""histogram() buckets must not depend on partitions, the index, or the result cache.

histogram() counts from 2001-01-01 UTC. Partition edges, the index fast path, and the
result cache counted from 1970-01-01 UTC. The two grids differ for any interval that
does not divide 978,307,200 seconds, such as 2, 3, 5, 7, and 30 days.

The expected rows come from the fixture. Another query cannot give them, because a
filter does not always stop the fast path.

An interval runs only if ZO_INGEST_ALLOWED_UPTO lets its whole bucket in. CI uses 48
hours, which is enough for 1 day. For all intervals, run the server and this test with
ZO_INGEST_ALLOWED_UPTO=2400.
"""

import datetime as dt
import logging
import os
import time
import uuid
import zoneinfo

import pytest
import requests

from support.sse import read_sse_response

logger = logging.getLogger(__name__)

ORG_ID = os.environ.get("TEST_ORG_ID", "default")
ORIGIN_MICROS = 978_307_200 * 1_000_000
HOUR = 3_600_000_000
DAY = 24 * HOUR
WINDOW_HOURS = int(os.environ.get("ZO_INGEST_ALLOWED_UPTO", "5"))
FIXTURE_HOURS = min(WINDOW_HOURS - 1, 100 * 24)
EVENT_STEP = 6 * HOUR if FIXTURE_HOURS > 96 else HOUR // 4
# Lets a local server flush files first, so the same rows also run through the index.
SETTLE_SECS = int(os.environ.get("HISTOGRAM_ORIGIN_SETTLE_SECS", "0"))
# 1 day divides the origin, so it is the control. The others do not.
INTERVAL_DAYS = [1, 2, 3, 5, 7, 30]


def _bucket_edge(ts, interval, offset=0):
    return ts - (ts + offset - ORIGIN_MICROS) % interval


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
        self.end = (int(time.time()) // 3600 - 1) * HOUR
        self.start = self.end - FIXTURE_HOURS * HOUR
        self.events = list(range(self.start + EVENT_STEP // 2, self.end, EVENT_STEP))

    def ingest(self):
        rows = [{"_timestamp": ts, "kind": "origin", "log": "origin"} for ts in self.events]
        resp = self.session.post(
            f"{self.base_url}api/{ORG_ID}/{self.stream}/_json", json=rows
        )
        assert resp.status_code == 200, f"ingest failed: {resp.status_code} {resp.text[:300]}"
        assert resp.json()["status"][0]["failed"] == 0, f"ingest dropped rows: {resp.text[:300]}"

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

    def search_stream(self, sql, start, end, use_cache=False, **query):
        resp: requests.Response = self.session.post(
            f"{self.base_url}api/{ORG_ID}/_search_stream?type=logs&use_cache={str(use_cache).lower()}",
            json={
                "query": {"sql": sql, "start_time": start, "end_time": end,
                          "from": 0, "size": -1, **query},
            },
        )
        assert resp.status_code == 200, f"stream failed: {resp.status_code} {resp.text[:300]}"
        return read_sse_response(resp)["results"]

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

    def whole_buckets(self, interval):
        """The range of whole buckets inside the fixture, or a skip when there are none."""
        first_edge = _bucket_edge(self.start - 1, interval) + interval
        last_edge = _bucket_edge(self.end, interval)
        if last_edge <= first_edge:
            pytest.skip(f"ZO_INGEST_ALLOWED_UPTO={WINDOW_HOURS} holds no whole bucket")
        return first_edge, last_edge


@pytest.fixture(scope="module")
def fixture(create_session, base_url):
    data = Fixture(create_session, base_url)
    data.ingest()
    data.wait_until_searchable()
    time.sleep(SETTLE_SECS)
    yield data
    data.drop()


def _sql(stream, days, filtered, timezone=None):
    tz_arg = f", '{timezone}'" if timezone else ""
    where = " WHERE kind = 'origin'" if filtered else ""
    return (
        f"SELECT histogram(_timestamp, '{days} days'{tz_arg}) AS ts, count(*) AS cnt "
        f'FROM "{stream}"{where} GROUP BY ts ORDER BY ts'
    )


def _rows(body):
    labels = [hit["ts"] for hit in body["hits"]]
    assert len(labels) == len(set(labels)), f"a bucket returned twice: {labels}"
    return {hit["ts"]: hit["cnt"] for hit in body["hits"]}


def _warm_cache(fixture, sql, start, end, expected, **query):
    """Reads back the cache ratio, because a test that never hits the cache proves nothing."""
    assert _rows(fixture.search(sql, start, end, use_cache=True, **query)) == expected
    for _ in range(30):
        body = fixture.search(sql, start, end, use_cache=True, **query)
        assert _rows(body) == expected
        if body.get("result_cache_ratio", 0) > 0:
            return
        time.sleep(1)
    pytest.fail(f"cache was never used for {sql}")


@pytest.mark.parametrize("filtered", [False, True], ids=["plain", "filtered"])
@pytest.mark.parametrize("days", INTERVAL_DAYS)
def test_cache_off_rows_match_the_fixture(fixture, days, filtered):
    interval = days * DAY
    sql = _sql(fixture.stream, days, filtered)
    expected = _expected_rows(fixture.events, fixture.start, fixture.end, interval)
    assert _rows(fixture.search(sql, fixture.start, fixture.end)) == expected
    assert _rows(fixture.search_stream(sql, fixture.start, fixture.end)) == expected


@pytest.mark.parametrize("filtered", [False, True], ids=["plain", "filtered"])
@pytest.mark.parametrize("days", INTERVAL_DAYS)
def test_a_request_inside_a_cached_bucket_counts_only_its_range(fixture, days, filtered):
    interval = days * DAY
    sql = _sql(fixture.stream, days, filtered)
    first_edge, last_edge = fixture.whole_buckets(interval)
    expected = _expected_rows(fixture.events, first_edge, last_edge, interval)
    _warm_cache(fixture, sql, first_edge, last_edge, expected)

    shorter_end = last_edge - interval // 2
    expected = _expected_rows(fixture.events, first_edge, shorter_end, interval)
    assert _rows(fixture.search(sql, first_edge, shorter_end)) == expected
    assert _rows(fixture.search(sql, first_edge, shorter_end, use_cache=True)) == expected
    assert _rows(fixture.search_stream(sql, first_edge, shorter_end, use_cache=True)) == expected

    later_start = first_edge + interval // 2
    expected = _expected_rows(fixture.events, later_start, last_edge, interval)
    assert _rows(fixture.search(sql, later_start, last_edge, use_cache=True)) == expected
    assert _rows(fixture.search_stream(sql, later_start, last_edge, use_cache=True)) == expected


@pytest.mark.parametrize("filtered", [False, True], ids=["plain", "filtered"])
def test_date_bin_with_its_own_origin_keeps_its_labels(fixture, filtered):
    where = " WHERE kind = 'origin'" if filtered else ""
    sql = (
        "SELECT date_bin(interval '30 days', to_timestamp_micros(_timestamp), "
        f"'1970-01-01T00:00:00') AS ts, count(*) AS cnt FROM \"{fixture.stream}\"{where} "
        "GROUP BY ts ORDER BY ts"
    )
    interval = 30 * DAY
    expected = {}
    for ts in fixture.events:
        label = _label(ts - ts % interval)
        expected[label] = expected.get(label, 0) + 1
    assert _rows(fixture.search(sql, fixture.start, fixture.end)) == expected


TIMEZONES = [("+05:30", 19_800_000_000), ("-08:00", -28_800_000_000)]


@pytest.mark.parametrize("filtered", [False, True], ids=["plain", "filtered"])
@pytest.mark.parametrize("days", INTERVAL_DAYS)
@pytest.mark.parametrize("timezone,offset", TIMEZONES, ids=["ist", "pst"])
@pytest.mark.parametrize("use_argument", [True, False], ids=["sql_argument", "request_timezone"])
def test_timezone_rows_match_the_fixture(fixture, days, filtered, timezone, offset, use_argument):
    interval = days * DAY
    sql = _sql(fixture.stream, days, filtered, timezone if use_argument else None)
    query = {} if use_argument else {"timezone": timezone}
    expected = _expected_rows(fixture.events, fixture.start, fixture.end, interval, offset)
    assert _rows(fixture.search(sql, fixture.start, fixture.end, **query)) == expected
    assert _rows(fixture.search_stream(sql, fixture.start, fixture.end, **query)) == expected


@pytest.mark.parametrize("filtered", [False, True], ids=["plain", "filtered"])
@pytest.mark.parametrize("days", INTERVAL_DAYS)
@pytest.mark.parametrize("timezone,offset", TIMEZONES, ids=["ist", "pst"])
@pytest.mark.parametrize("use_argument", [True, False], ids=["sql_argument", "request_timezone"])
def test_timezone_rows_stay_correct_through_the_cache(fixture, days, filtered, timezone, offset, use_argument):
    interval = days * DAY
    sql = _sql(fixture.stream, days, filtered, timezone if use_argument else None)
    query = {} if use_argument else {"timezone": timezone}
    first_edge = _bucket_edge(fixture.start - 1, interval, offset) + interval
    last_edge = _bucket_edge(fixture.end, interval, offset)
    if last_edge <= first_edge:
        pytest.skip(f"ZO_INGEST_ALLOWED_UPTO={WINDOW_HOURS} holds no whole bucket")
    expected = _expected_rows(fixture.events, first_edge, last_edge, interval, offset)
    _warm_cache(fixture, sql, first_edge, last_edge, expected, **query)

    shorter_end = last_edge - interval // 2
    expected = _expected_rows(fixture.events, first_edge, shorter_end, interval, offset)
    assert _rows(fixture.search(sql, first_edge, shorter_end, use_cache=True, **query)) == expected
    assert _rows(fixture.search_stream(sql, first_edge, shorter_end, use_cache=True, **query)) == expected


@pytest.mark.parametrize("days", [1, 30])
def test_a_request_timezone_does_not_share_a_cache_entry_with_utc(fixture, days):
    interval = days * DAY
    sql = _sql(fixture.stream, days, False)
    first_edge, last_edge = fixture.whole_buckets(interval)
    utc = _expected_rows(fixture.events, first_edge, last_edge, interval)
    _warm_cache(fixture, sql, first_edge, last_edge, utc)
    offset = 19_800_000_000
    expected = _expected_rows(fixture.events, first_edge, last_edge, interval, offset)
    body = fixture.search(sql, first_edge, last_edge, use_cache=True, timezone="+05:30")
    assert _rows(body) == expected


def test_a_named_zone_uses_one_offset_for_the_whole_request(fixture):
    interval = 7 * DAY
    sql = _sql(fixture.stream, 7, True, "America/Los_Angeles")
    end_zone = dt.datetime.fromtimestamp(fixture.end / 1_000_000, tz=dt.timezone.utc).astimezone(
        zoneinfo.ZoneInfo("America/Los_Angeles")
    )
    offset = int(end_zone.utcoffset().total_seconds()) * 1_000_000
    expected = _expected_rows(fixture.events, fixture.start, fixture.end, interval, offset)
    assert _rows(fixture.search(sql, fixture.start, fixture.end, use_cache=True)) == expected
    assert _rows(fixture.search_stream(sql, fixture.start, fixture.end)) == expected
