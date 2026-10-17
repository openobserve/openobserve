"""A partition-key filter prunes only the read of the stream it filters (openobserve#15147).

The equalities on partition keys used to be collected from every SELECT of the statement and applied
to every read of the stream, so `count(*) ... WHERE msg IN (SELECT msg ... WHERE pk = 'a')` read only
the pk=a files for the outer count too and answered 1 instead of 2, with `is_partial: false`.
"""

import logging
import os
import time

import pytest

from support.wait import wait_until

logger = logging.getLogger(__name__)

ORG_ID = os.environ.get("TEST_ORG_ID", "default")
RECORDS = [{"pk": "a", "msg": "x"}, {"pk": "b", "msg": "x"}, {"pk": "b", "msg": "y"}]

# {s} is the stream; each answer is the count over RECORDS
QUERIES = {
    "in_subquery": (
        'SELECT count(*) AS c FROM "{s}" WHERE msg IN (SELECT msg FROM "{s}" WHERE pk = \'a\')',
        2,
    ),
    "cte": (
        "WITH a AS (SELECT msg FROM \"{s}\" WHERE pk = 'a') "
        'SELECT count(*) AS c FROM "{s}" WHERE msg IN (SELECT msg FROM a)',
        2,
    ),
    "scalar_subquery": (
        'SELECT count(*) AS c, (SELECT count(*) FROM "{s}" WHERE pk = \'a\') AS a FROM "{s}"',
        3,
    ),
    "self_join": (
        'SELECT count(*) AS c FROM "{s}" JOIN "{s}" AS p2 ON "{s}".msg = p2.msg WHERE "{s}".pk = \'a\'',
        2,
    ),
    "outer_filter_on_an_aggregate_alias": (
        "SELECT count(*) AS c FROM (SELECT msg, max(pk) AS pk FROM \"{s}\" GROUP BY msg) t WHERE pk = 'a'",
        0,
    ),
    # both reads filter pk, so the pruning has to keep the files of both values
    "every_read_filters_pk": (
        "SELECT count(*) AS c FROM \"{s}\" WHERE pk = 'b' AND msg IN (SELECT msg FROM \"{s}\" WHERE pk = 'a')",
        1,
    ),
}


def _search(session, base_url, sql, start, end):
    resp = session.post(
        f"{base_url}api/{ORG_ID}/_search?type=logs&use_cache=false",
        json={"query": {"sql": sql, "start_time": start, "end_time": end, "from": 0, "size": 100}},
    )
    assert resp.status_code == 200, f"search failed: {resp.status_code} {resp.text[:300]}"
    return resp.json()


@pytest.fixture(scope="module")
def partitioned_stream(create_session, base_url, random_string):
    session = create_session
    stream = f"pytest_pk_subquery_{random_string(6).lower()}"
    now = int(time.time() * 1_000_000)

    # the stream has to exist before its settings can change; this record is outside the window
    resp = session.post(
        f"{base_url}api/{ORG_ID}/{stream}/_json",
        json=[{"_timestamp": now - 3 * 3600_000_000, "pk": "seed", "msg": "seed"}],
    )
    assert resp.status_code == 200, f"seed ingest failed: {resp.status_code} {resp.text[:300]}"
    resp = session.put(
        f"{base_url}api/{ORG_ID}/streams/{stream}/settings?type=logs",
        json={"partition_keys": {"add": [{"field": "pk", "types": "value"}], "remove": []}},
    )
    assert resp.status_code == 200, f"setting the partition key failed: {resp.status_code} {resp.text[:300]}"

    def has_partition_key():
        r = session.get(f"{base_url}api/{ORG_ID}/streams/{stream}/schema?type=logs")
        return r.status_code == 200 and bool(r.json().get("settings", {}).get("partition_keys"))

    # records ingested before the key is in place would not be split by pk
    wait_until(has_partition_key, timeout=30, interval=0.5, msg="partition key not in the stream settings")

    rows = [{"_timestamp": now - (10 - i) * 60_000_000, **r} for i, r in enumerate(RECORDS)]
    resp = session.post(f"{base_url}api/{ORG_ID}/{stream}/_json", json=rows)
    assert resp.status_code == 200, f"ingest failed: {resp.status_code} {resp.text[:300]}"

    start, end = now - 3600_000_000, now + 60_000_000

    def all_rows_searchable():
        hits = _search(session, base_url, f'SELECT count(*) AS c FROM "{stream}"', start, end).get("hits", [])
        return bool(hits) and hits[0].get("c") == len(RECORDS)

    wait_until(all_rows_searchable, timeout=60, interval=1, msg="ingested rows not searchable")
    yield stream, start, end
    session.delete(f"{base_url}api/{ORG_ID}/streams/{stream}?type=logs")


@pytest.mark.parametrize("name", list(QUERIES))
def test_partition_key_filter_prunes_only_its_own_read(create_session, base_url, partitioned_stream, name):
    stream, start, end = partitioned_stream
    sql, expected = QUERIES[name]
    sql = sql.format(s=stream)
    body = _search(create_session, base_url, sql, start, end)
    hits = body.get("hits", [])
    logger.info("%s -> %s", name, hits)
    # the wrong answers came back as complete results, so a partial one is a different failure
    assert not body.get("is_partial"), f"{name}: partial result {body.get('function_error')} for {sql}"
    assert hits, f"{name}: no rows for {sql}"
    assert hits[0].get("c") == expected, f"#15147 {name}: expected c = {expected}, got {hits[0]} for {sql}"
