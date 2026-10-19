"""
DB Monitoring must keep measuring when `db_response_returned_rows` is a string
column (#14744).

OTLP stores every span attribute value as a string, so an integer
`db.response.returned_rows` -- sent exactly as an SDK sends it -- lands in the
trace stream as a Utf8 column. The DBM SQL summed that column directly, which
DataFusion refuses at plan time (`sum` has no Utf8 signature). The rollup job
then failed on every tick without ever advancing its offset, and the read
path's live tail failed the same way, so the Databases page stayed empty for
good.

This test reads the Databases endpoint, whose live tail runs the same metric
SQL as the rollup job, immediately after ingest. A numeric column (which OTLP
never produces) is covered by the unit test that runs the SQL itself over both
column types.
"""

import logging
import random
import uuid
from datetime import datetime, timezone

from support.wait import wait_until

logger = logging.getLogger(__name__)

SPAN_COUNT = 10
ROWS_PER_CALL = 18


def _attr(key, value):
    if isinstance(value, int):
        # proto3 JSON encodes int64 as a string; this decodes to AnyValue::IntValue.
        return {"key": key, "value": {"intValue": str(value)}}
    return {"key": key, "value": {"stringValue": value}}


def _db_spans(instance, now):
    """CLIENT spans that qualify for DBM enrichment, each reporting 18 rows.

    Placed 30 to 180 seconds in the past, which keeps them in one place:
    * inside the live tail, which reads back `rollup::delta_budget` (four
      rollup intervals plus the settle delay, 540s at the shortest interval);
    * outside every rolled-up window, since the rollup only settles windows
      older than ZO_CACHE_DELAY_SECS (300s). A span in a window the rollup is
      writing could briefly be read twice.
    """
    spans = []
    for _ in range(SPAN_COUNT):
        start = (now - random.randint(30, 180)) * 1_000_000_000
        spans.append({
            "traceId": f"{random.getrandbits(128):032x}",
            "spanId": f"{random.getrandbits(64):016x}",
            "name": "SELECT users",
            "kind": 3,  # CLIENT
            "startTimeUnixNano": str(start),
            "endTimeUnixNano": str(start + 5_000_000),
            "attributes": [
                _attr("db.system", "postgresql"),
                _attr("db.statement", "SELECT * FROM users WHERE id = 1"),
                _attr("server.address", instance),
                _attr("db.response.returned_rows", ROWS_PER_CALL),
            ],
            "status": {},
        })
    return {"resourceSpans": [{
        "resource": {"attributes": [_attr("service.name", "dbm-rows-test")]},
        "scopeSpans": [{"scope": {"name": "dbm-rows-test"}, "spans": spans}],
    }]}


def _span_count(session, base_url, org_id, stream, now):
    r = session.post(
        f"{base_url}api/{org_id}/_search?type=traces",
        json={"query": {
            "sql": f'SELECT COUNT(*) AS c FROM "{stream}"',
            "start_time": (now - 3600) * 1_000_000,
            "end_time": (now + 60) * 1_000_000,
            "size": 1,
        }},
    )
    return r.json()["hits"][0]["c"] if r.status_code == 200 else 0


def _measured_row(session, base_url, org_id, stream, instance, now):
    """The Databases row for `instance` once it counts every call, else None."""
    r = session.get(
        f"{base_url}api/{org_id}/db_monitoring/databases",
        params={
            "start_time": (now - 3600) * 1_000_000,
            "end_time": (now + 60) * 1_000_000,
            "stream": stream,
        },
    )
    assert r.status_code == 200, f"databases read failed: {r.status_code} {r.text[:300]}"
    for row in r.json().get("hits", []):
        if row.get("db_instance") == instance and row.get("calls") == SPAN_COUNT:
            return row
    return None


def test_databases_page_measures_an_integer_rows_attribute(create_session, base_url, org_id):
    """An integer row count sent over OTLP must not empty the Databases page."""
    session = create_session
    suffix = uuid.uuid4().hex[:8]
    stream, instance = f"dbm_rows_{suffix}", f"db-{suffix}"
    now = int(datetime.now(timezone.utc).timestamp())

    resp = session.post(
        f"{base_url}api/{org_id}/v1/traces",
        json=_db_spans(instance, now),
        headers={"stream-name": stream},
    )
    assert resp.status_code == 200, f"trace ingest failed: {resp.status_code} {resp.text}"
    wait_until(
        lambda: _span_count(session, base_url, org_id, stream, now) >= SPAN_COUNT,
        timeout=60, interval=1, msg=f"spans in {stream} never became searchable",
    )

    schema = session.get(f"{base_url}api/{org_id}/streams/{stream}/schema?type=traces").json()
    types = {f["name"]: f["type"] for f in schema.get("schema", [])}
    assert "o2_db_fingerprint" in types, "the spans must have been enriched as DB spans"
    logger.debug("db_response_returned_rows is %s", types.get("db_response_returned_rows"))

    row = wait_until(
        lambda: _measured_row(session, base_url, org_id, stream, instance, now),
        timeout=60, interval=2,
        msg=f"the Databases page never reported {instance} with all {SPAN_COUNT} calls -- "
            "the DBM metric query cannot plan over a string db_response_returned_rows column",
    )
    assert row["rows_returned"] == SPAN_COUNT * ROWS_PER_CALL, (
        f"the string row counts must be summed, not dropped: {row}"
    )
    assert row["rows_emitting_calls"] == SPAN_COUNT, f"every call reported rows: {row}"
