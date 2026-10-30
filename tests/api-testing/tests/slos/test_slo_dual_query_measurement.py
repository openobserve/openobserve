"""
SLO measurement for a dual-query count SLI over non-logs streams (#14242).

A dual-query count source names a stream type for each of its two queries,
but the measurement job searched both as logs. A pair over traces (or
metrics) therefore failed its search on every pass: the SLO was accepted,
scheduled and run, yet `computed_at` stayed null with good/total at zero,
while a single-query SLO over the same stream was measured.

The validation suite next door never waits for a measurement, so it could not
see this. Every case here measures the dual SLO beside a single-query control
over the same traces stream. The control proves that measurement is running
in this environment, so a dual SLO that stays unmeasured fails on the dual
path alone and not on slow scheduling.

Two shapes are measured:

* both queries over one traces stream -- the reporter's shape;
* the numerator over traces and the denominator over a logs stream. Each side
  must be searched as its OWN type: reading both as either type, or swapping
  them, leaves one side empty and the SLO unmeasured (or its good count at
  zero), so this is the case that pins per-side typing end to end.
"""

import logging
import random
import time
import uuid
from datetime import datetime, timezone

import pytest

from support.otlp_json import span, string_attr, traces_request
from support.wait import wait_until

logger = logging.getLogger(__name__)

WINDOW_7D = 604800
SLICE_5M = 300
SPAN_COUNT = 200
# The logs denominator holds two records per span, so good < total there.
LOGS_PER_SPAN = 2
# A pass reads slices that closed at least ZO_SLO_INGEST_DELAY_SECS (60 by
# default) ago, and the scheduler polls every few seconds in CI.
MEASURE_TIMEOUT_SECS = 180


def _count(session, base_url, org_id, stream, stream_type, now):
    r = session.post(
        f"{base_url}api/{org_id}/_search?type={stream_type}",
        json={"query": {
            "sql": f'SELECT COUNT(*) AS c FROM "{stream}"',
            "start_time": (now - 3600) * 1_000_000,
            "end_time": (now + 60) * 1_000_000,
            "size": 1,
        }},
    )
    return r.json()["hits"][0]["c"] if r.status_code == 200 else 0


@pytest.fixture(scope="module")
def seeded_streams(create_session, base_url, org_id):
    """A traces stream and a logs stream sharing timestamps, in closed slices.

    Timestamps sit 2 to 14 minutes in the past: late enough that every
    5-minute slice they fall in has closed, recent enough to be inside the
    first pass's recompute window rather than waiting on backfill. Each span
    gets LOGS_PER_SPAN log records at the same instant, so both sides of a
    mixed pair land in the same slices.
    """
    suffix = uuid.uuid4().hex[:8]
    traces, logs = f"slo_dual_t_{suffix}", f"slo_dual_l_{suffix}"
    now = int(datetime.now(timezone.utc).timestamp())
    instants = [now - random.randint(120, 840) for _ in range(SPAN_COUNT)]

    spans = [
        span(
            "GET /checkout",
            trace_id=f"{random.getrandbits(128):032x}",
            span_id=f"{random.getrandbits(64):016x}",
            time_unix_nano=t * 1_000_000_000,
            attributes=[string_attr("outcome", "ok")],
        )
        for t in instants
    ]
    resp = create_session.post(
        f"{base_url}api/{org_id}/v1/traces",
        json=traces_request(spans, service="checkout"),
        headers={"stream-name": traces},
    )
    assert resp.status_code == 200, f"trace ingest failed: {resp.status_code} {resp.text}"

    records = [{"_timestamp": t * 1_000_000, "request": "checkout"}
               for t in instants for _ in range(LOGS_PER_SPAN)]
    resp = create_session.post(f"{base_url}api/{org_id}/{logs}/_json", json=records)
    assert resp.status_code == 200, f"log ingest failed: {resp.status_code} {resp.text}"

    wait_until(
        lambda: (_count(create_session, base_url, org_id, traces, "traces", now) >= SPAN_COUNT
                 and _count(create_session, base_url, org_id, logs, "logs", now)
                 >= SPAN_COUNT * LOGS_PER_SPAN),
        timeout=60, interval=1, msg=f"seeded rows in {traces}/{logs} never became searchable",
    )
    return traces, logs


@pytest.fixture
def slo_ids(create_session, base_url, org_id):
    """Delete every SLO a test created, whatever the outcome."""
    created = []
    yield created
    for slo_id in created:
        for attempt in range(5):
            resp = create_session.delete(f"{base_url}api/{org_id}/slos/{slo_id}")
            if resp.status_code < 500:
                break
            time.sleep(0.5 * (attempt + 1))


def _bucketed_count_sql(stream, where=""):
    return (
        "SELECT histogram(_timestamp, '5 minute') AS slice_start, "
        f'COUNT(*) AS zo_slo_value FROM "{stream}" {where} '
        "GROUP BY slice_start ORDER BY slice_start"
    )


def _definition(name, source):
    return {
        "name": name,
        "description": "dual-query measurement",
        "sli_type": "count",
        "config": {"source": source},
        "group_by": None,
        "groups_estimate": None,
        "window_secs": WINDOW_7D,
        "slice_interval_secs": SLICE_5M,
        "target": 99,
        "tags": ["api-test"],
        "enabled": True,
    }


def _create(session, base_url, org_id, definition, track):
    resp = session.post(f"{base_url}api/{org_id}/slos", json=definition)
    assert resp.status_code == 200, f"create failed: {resp.status_code} {resp.text}"
    slo_id = resp.json()["id"]
    track.append(slo_id)
    return slo_id


def _measured_status(session, base_url, org_id, slo_id):
    """The SLO's status once a pass has committed a measurement, else None."""
    body = session.get(f"{base_url}api/{org_id}/slos/{slo_id}").json()
    status = body.get("status") or {}
    if status.get("computed_at") and (status.get("total") or 0) > 0:
        return status
    return None


@pytest.mark.parametrize("total_side", ["traces", "logs"],
                         ids=["traces-pair", "traces-good-logs-total"])
def test_dual_query_slo_over_traces_is_measured(
        create_session, base_url, org_id, seeded_streams, slo_ids, total_side):
    """A dual-query count SLO over traces is measured like a single-query one.

    On the unfixed build the single-query control reaches a committed status
    while the dual SLO keeps computed_at null and good/total at zero for as
    long as it runs.
    """
    traces, logs = seeded_streams
    total_stream = traces if total_side == "traces" else logs

    control_id = _create(create_session, base_url, org_id, _definition(
        f"slo_dual_control_{uuid.uuid4().hex[:8]}",
        {"mode": "single_query", "query": {
            "stream": traces, "stream_type": "traces", "good_expr": "duration >= 0"}},
    ), slo_ids)
    dual_id = _create(create_session, base_url, org_id, _definition(
        f"slo_dual_{uuid.uuid4().hex[:8]}",
        {"mode": "dual_query", "query": {
            "good": {"stream": traces, "stream_type": "traces",
                     "sql": _bucketed_count_sql(traces, "WHERE duration >= 0")},
            "total": {"stream": total_stream, "stream_type": total_side,
                      "sql": _bucketed_count_sql(total_stream)},
        }},
    ), slo_ids)

    control = wait_until(
        lambda: _measured_status(create_session, base_url, org_id, control_id),
        timeout=MEASURE_TIMEOUT_SECS, interval=2,
        msg="the single-query control over the same traces stream was never measured",
    )
    logger.debug("control measured: %s", control)

    dual = wait_until(
        lambda: _measured_status(create_session, base_url, org_id, dual_id),
        timeout=MEASURE_TIMEOUT_SECS, interval=2,
        msg=f"the dual-query SLO (good: traces, total: {total_side}) was never measured "
            "(computed_at stayed null) while the single-query control over the same "
            "traces stream was",
    )
    # A numerator read from the wrong stream would join as zero good.
    assert dual["good"] > 0, f"the traces numerator must count its spans: {dual}"
    assert dual["good"] <= dual["total"], f"good cannot exceed total: {dual}"
    if total_side == "logs":
        # Two log records per span: a denominator read from the traces stream by
        # mistake would equal the numerator instead.
        assert dual["good"] < dual["total"], f"the logs denominator was not read: {dual}"
