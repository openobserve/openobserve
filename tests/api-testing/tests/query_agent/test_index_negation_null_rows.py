"""Negations on a secondary-index field once the data is in parquet with a tantivy index.

The index stores a NULL as "", so on its own it would also match a NULL row for `!=`,
`NOT IN`, `NOT (... = ...)` and `= ''`, which SQL leaves out (#15089). `service_name` is a
default secondary-index field of every stream. This suite runs with
ZO_MAX_FILE_RETENTION_TIME=1, so a flushed file is indexed within seconds.
"""

import logging
from datetime import UTC, datetime, timedelta

import pytest

from support.factories import search_payload, unique_name
from support.wait import wait_until

RECORDS = 1000


def _service_name(i: int) -> str | None:
    # 18 of every 20 records are "api", one is "web" and one has no service_name
    position = i % 20
    if position < 18:
        return "api"
    return "web" if position == 18 else None


@pytest.fixture(scope="module")
def indexed_stream(client):
    """A stream whose only data file has an index with NULL service_name rows."""
    stream = unique_name("index_null")
    base = int((datetime.now(UTC) - timedelta(minutes=10)).timestamp() * 1_000_000)
    records = []
    for i in range(RECORDS):
        record = {"_timestamp": base + i * 100_000, "msg": f"record {i}"}
        service = _service_name(i)
        if service is not None:
            record["service_name"] = service
        records.append(record)
    client.streams.ingest_json(stream, records)
    window = (base, base + RECORDS * 100_000)

    resp = client.put("node/flush", prefix="")
    assert resp.status_code in (200, 404), f"flush: {resp.status_code} {resp.text[:200]}"

    # an equality count is answered by TantivyOptimizeExec only once the file is indexed
    probe = f"EXPLAIN ANALYZE SELECT count(*) AS c FROM \"{stream}\" WHERE service_name = 'api'"

    def _indexed():
        r = client.post(
            "_search?type=logs&use_cache=false",
            json=search_payload(probe, start_time=window[0], end_time=window[1]),
        )
        return r.status_code == 200 and "TantivyOptimizeExec" in str(r.json().get("hits"))

    wait_until(_indexed, timeout=120, interval=2.0, msg=f"{stream} not indexed after flush")
    logging.info("%s: data is in indexed parquet", stream)
    yield stream, window
    try:
        client.streams.delete(stream)
    except Exception as e:
        logging.warning("cleanup of %s failed: %s", stream, e)


def _search(client, stream, window, sql):
    resp = client.post(
        "_search?type=logs&use_cache=false",
        json=search_payload(
            sql.replace("{stream}", f'"{stream}"'),
            start_time=window[0],
            end_time=window[1],
            size=RECORDS,
        ),
    )
    assert resp.status_code == 200, f"{sql}: {resp.status_code} {resp.text[:300]}"
    body = resp.json()
    assert not body.get("is_partial"), f"{sql}: partial result {body.get('function_error')}"
    return body["hits"]


@pytest.mark.parametrize(
    ("where", "expected"),
    [
        ("service_name != 'api'", 50),
        ("service_name NOT IN ('api')", 50),
        ("NOT (service_name = 'api')", 50),
        ("service_name != 'web'", 900),
        ("service_name = ''", 0),
        ("service_name != ''", 950),
        ("service_name IS NULL", 50),
    ],
)
def test_count_leaves_out_null_rows(client, indexed_stream, where, expected):
    stream, window = indexed_stream
    hits = _search(client, stream, window, f"SELECT count(*) AS c FROM {{stream}} WHERE {where}")
    assert hits[0]["c"] == expected, f"{where}: {hits}"


def test_rows_histogram_and_top_n_leave_out_null_rows(client, indexed_stream):
    stream, window = indexed_stream
    rows = _search(
        client,
        stream,
        window,
        "SELECT _timestamp, service_name FROM {stream} WHERE service_name != 'api' ORDER BY _timestamp DESC",
    )
    assert len(rows) == 50, f"{len(rows)} rows"
    assert {row.get("service_name") for row in rows} == {"web"}

    buckets = _search(
        client,
        stream,
        window,
        "SELECT histogram(_timestamp, '1 minute') AS k, count(*) AS c FROM {stream} "
        "WHERE service_name != 'api' GROUP BY k ORDER BY k",
    )
    assert sum(bucket["c"] for bucket in buckets) == 50, buckets

    groups = _search(
        client,
        stream,
        window,
        "SELECT service_name, count(*) AS c FROM {stream} WHERE service_name != 'api' "
        "GROUP BY service_name ORDER BY c DESC LIMIT 10",
    )
    assert [(group.get("service_name"), group["c"]) for group in groups] == [("web", 50)]
