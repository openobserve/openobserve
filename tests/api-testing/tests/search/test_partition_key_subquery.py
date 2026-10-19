import logging
import os
import time

import pytest

from support.wait import wait_until

logger = logging.getLogger(__name__)

ORG_ID = os.environ.get("TEST_ORG_ID", "default")
RECORDS = [{"pk": "a", "msg": "x"}, {"pk": "b", "msg": "x"}, {"pk": "b", "msg": "y"}]

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
    "every_read_filters_pk": (
        "SELECT count(*) AS c FROM \"{s}\" WHERE pk = 'b' AND msg IN (SELECT msg FROM \"{s}\" WHERE pk = 'a')",
        1,
    ),
}


ROW_QUERIES = {
    "literal_equality": ("SELECT pk, msg FROM \"{s}\" WHERE pk = 'a'", [("a", "x")]),
    "literal_in": (
        "SELECT pk, msg FROM \"{s}\" WHERE pk IN ('a', 'b')",
        [("a", "x"), ("b", "x"), ("b", "y")],
    ),
    "column_in": (
        'SELECT pk, msg FROM "{s}" WHERE pk IN (pk)',
        [("a", "x"), ("b", "x"), ("b", "y")],
    ),
    "mixed_in": (
        "SELECT pk, msg FROM \"{s}\" WHERE pk IN ('a', pk)",
        [("a", "x"), ("b", "x"), ("b", "y")],
    ),
    "qualified_mixed_in": (
        'SELECT pk, msg FROM "{s}" WHERE "{s}".pk IN (\'a\', "{s}".pk)',
        [("a", "x"), ("b", "x"), ("b", "y")],
    ),
    "function_in": (
        "SELECT pk, msg FROM \"{s}\" WHERE pk IN (lower('A'))",
        [("a", "x")],
    ),
    "union_nonliteral_in": (
        'SELECT pk, msg FROM "{s}" WHERE pk IN (pk) UNION ALL SELECT pk, msg FROM "{s}" WHERE pk = \'a\' ORDER BY pk, msg',
        [("a", "x"), ("a", "x"), ("b", "x"), ("b", "y")],
    ),
    "table_alias_collision": (
        'SELECT p.pk, p.msg FROM "{s}" AS p JOIN "{plain}" AS "{s}" '
        'ON p.msg = "{s}".msg WHERE "{s}".pk = \'a\' ORDER BY p.pk, p.msg',
        [("a", "x"), ("b", "x")],
    ),
}


def _search(session, base_url, sql, start, end):
    resp = session.post(
        f"{base_url}api/{ORG_ID}/_search?type=logs&use_cache=false",
        json={"query": {"sql": sql, "start_time": start, "end_time": end, "from": 0, "size": 100}},
    )
    assert resp.status_code == 200, f"search failed: {resp.status_code} {resp.text[:300]}"
    return resp.json()


@pytest.fixture(scope="module", params=[False, True], ids=["memory", "flushed"])
def partitioned_stream(create_session, base_url, random_string, request):
    session = create_session
    stream = f"pytest_pk_subquery_{random_string(6).lower()}"
    plain = f"{stream}_plain"
    now = int(time.time() * 1_000_000)

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

    wait_until(has_partition_key, timeout=30, interval=0.5, msg="partition key not in the stream settings")

    rows = [{"_timestamp": now - (10 - i) * 60_000_000, **r} for i, r in enumerate(RECORDS)]
    resp = session.post(f"{base_url}api/{ORG_ID}/{stream}/_json", json=rows)
    assert resp.status_code == 200, f"ingest failed: {resp.status_code} {resp.text[:300]}"

    resp = session.post(f"{base_url}api/{ORG_ID}/{plain}/_json", json=rows)
    assert resp.status_code == 200, f"plain ingest failed: {resp.status_code} {resp.text[:300]}"

    start, end = now - 3600_000_000, now + 60_000_000

    def all_rows_searchable():
        for name in (stream, plain):
            hits = _search(session, base_url, f'SELECT count(*) AS c FROM "{name}"', start, end).get("hits", [])
            if not hits or hits[0].get("c") != len(RECORDS):
                return False
        return True

    wait_until(all_rows_searchable, timeout=60, interval=1, msg="ingested rows not searchable")
    try:
        if request.param:
            resp = session.put(f"{base_url}node/flush")
            if resp.status_code == 404:
                pytest.skip("the test endpoint is not an ingester")
            assert resp.status_code == 200, f"flush failed: {resp.status_code} {resp.text[:300]}"
        yield stream, plain, start, end
    finally:
        for name in (stream, plain):
            session.delete(f"{base_url}api/{ORG_ID}/streams/{name}?type=logs")


@pytest.mark.parametrize("name", list(QUERIES))
def test_complex_partition_queries_preserve_counts(create_session, base_url, partitioned_stream, name):
    stream, plain, start, end = partitioned_stream
    sql, expected = QUERIES[name]
    sql = sql.format(s=stream, plain=plain)
    body = _search(create_session, base_url, sql, start, end)
    hits = body.get("hits", [])
    logger.info("%s -> %s", name, hits)
    assert not body.get("is_partial"), f"{name}: partial result {body.get('function_error')} for {sql}"
    assert hits, f"{name}: no rows for {sql}"
    assert hits[0].get("c") == expected, f"#15147 {name}: expected c = {expected}, got {hits[0]} for {sql}"


@pytest.mark.parametrize("name", list(ROW_QUERIES))
def test_partition_pruning_preserves_matching_rows(create_session, base_url, partitioned_stream, name):
    stream, plain, start, end = partitioned_stream
    sql, expected = ROW_QUERIES[name]
    sql = sql.format(s=stream, plain=plain)
    body = _search(create_session, base_url, sql, start, end)
    assert not body.get("is_partial"), f"{name}: partial result for {sql}"
    rows = sorted((hit["pk"], hit["msg"]) for hit in body.get("hits", []))
    assert rows == expected, f"{name}: wrong rows for {sql}"
