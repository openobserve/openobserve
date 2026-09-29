"""Traces list ordering and duration filtering  [regressions #10986, #11339, #11505].

#10986 (PR #10993): the traces list did not come back ordered by `_timestamp`
descending, so the newest trace was not first.

#11339 (PR #11334): partition ordering ignored the requested sort direction --
partitions stay as-is for `zo_sql_timestamp DESC` and must be reversed for ASC.
Asserting both directions is the point: a build that always returns one fixed
order satisfies a single-direction test.

#11505 (PR #11514): filtering the list by duration produced blank rows, because
the per-trace enrichment query was unbounded. The contract is that a filtered
row still carries its trace identity, not that some number of rows comes back.
"""

import logging
import os
import time
import uuid

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

ORG_ID = os.environ.get("TEST_ORG_ID", "default")
TRACE_COUNT = 6
STREAM = "default"


def _span(trace_id, span_id, start_ns, dur_ns, name):
    return {
        "traceId": trace_id, "spanId": span_id, "parentSpanId": "", "flags": 1,
        "name": name, "kind": 2,
        "startTimeUnixNano": str(start_ns), "endTimeUnixNano": str(start_ns + dur_ns),
        "attributes": [{"key": "http.route", "value": {"stringValue": "/probe"}}],
        "status": {"code": 0},
    }


def _seed_traces(session, base_url):
    """Six traces a second apart, with deliberately different durations."""
    base_ns = int(time.time() * 1e9) - 300 * 10**9
    ids = []
    spans = []
    for i in range(TRACE_COUNT):
        tid = uuid.uuid4().hex
        ids.append(tid)
        spans.append(_span(tid, uuid.uuid4().hex[:16], base_ns + i * 10**9,
                           (i + 1) * 5 * 10**6, f"op_{i}"))
    payload = {"resourceSpans": [{
        "resource": {"attributes": [{"key": "service.name",
                                     "value": {"stringValue": "pytest_traces_order"}}]},
        "scopeSpans": [{"scope": {"name": "pytest"}, "spans": spans}],
    }]}
    r = session.post(f"{base_url}api/{ORG_ID}/v1/traces", json=payload)
    assert r.status_code == 200, f"trace ingest failed: {r.status_code} {r.text[:300]}"
    return ids, base_ns


def _seed_window(base_ns):
    """Bound the query to the seeded span only.

    The traces stream is shared and earlier runs leave data behind. With a wide
    window `sort_order=asc` returns the oldest traces in the whole stream and
    `size` truncates before this module's trace_id filter can apply, so the two
    directions would compare different populations.
    """
    start_us = int(base_ns / 1000) - 1_000_000
    end_us = int(base_ns / 1000) + (TRACE_COUNT + 2) * 1_000_000
    return start_us, end_us


def _latest(session, base_url, start_us, end_us, **extra):
    params = {"start_time": start_us, "end_time": end_us, "from": 0, "size": 20}
    params.update(extra)
    r = session.get(f"{base_url}api/{ORG_ID}/{STREAM}/traces/latest", params=params)
    assert r.status_code == 200, f"latest traces failed: {r.status_code} {r.text[:300]}"
    return r.json()


def _wait_for_traces(session, base_url, ids, start_us, end_us):
    for _ in range(40):
        body = _latest(session, base_url, start_us, end_us)
        got = {h.get("trace_id") for h in body.get("hits", [])}
        if len([i for i in ids if i in got]) >= TRACE_COUNT:
            return body
        time.sleep(2)
    raise AssertionError("seeded traces never became visible in the latest-traces list")


def test_latest_traces_are_ordered_newest_first(create_session, base_url):
    session = create_session
    ids, base_ns = _seed_traces(session, base_url)
    start_us, end_us = _seed_window(base_ns)

    body = _wait_for_traces(session, base_url, ids, start_us, end_us)

    # Restrict to this run's traces; the stream is shared and older ones linger.
    mine = [h for h in body["hits"] if h.get("trace_id") in set(ids)]
    assert len(mine) == TRACE_COUNT, f"expected {TRACE_COUNT} seeded traces, got {len(mine)}"

    stamps = [h["start_time"] for h in mine]
    logger.info("latest-traces start_times: %s", stamps)
    # Seeded one second apart, so a stable sort cannot mask a wrong direction.
    assert stamps == sorted(stamps, reverse=True), \
        f"traces must be newest-first, got {stamps}"


def test_duration_filtered_rows_are_not_blank(create_session, base_url):
    session = create_session
    ids, base_ns = _seed_traces(session, base_url)
    start_us, end_us = _seed_window(base_ns)
    _wait_for_traces(session, base_url, ids, start_us, end_us)

    # Durations are (i+1)*5ms, so this threshold must exclude the shortest traces
    # rather than matching everything -- a filter that is a no-op proves nothing.
    threshold_us = 15_000
    body = _latest(session, base_url, start_us, end_us, filter=f"duration > {threshold_us}")
    mine = [h for h in body.get("hits", []) if h.get("trace_id") in set(ids)]
    logger.info("duration-filtered rows: %s of %s seeded", len(mine), TRACE_COUNT)

    assert mine, "a duration filter matching some traces must still return rows"
    assert len(mine) < TRACE_COUNT, \
        f"the filter must exclude the shorter traces, got all {len(mine)}"

    # The defect rendered rows with no trace identity, so populated rows are the contract.
    for h in mine:
        assert h.get("trace_id"), f"filtered row came back blank: {h}"
        assert h.get("duration", 0) > threshold_us, \
            f"row below the duration threshold leaked through: {h.get('duration')}"


def test_sort_order_asc_reverses_the_list(create_session, base_url):
    """`sort_order=asc` must reverse the order, not return the same fixed list."""
    session = create_session
    ids, base_ns = _seed_traces(session, base_url)
    start_us, end_us = _seed_window(base_ns)
    _wait_for_traces(session, base_url, ids, start_us, end_us)

    seeded = set(ids)
    desc = [h["start_time"] for h in
            _latest(session, base_url, start_us, end_us, sort_order="desc")["hits"]
            if h.get("trace_id") in seeded]
    asc = [h["start_time"] for h in
           _latest(session, base_url, start_us, end_us, sort_order="asc")["hits"]
           if h.get("trace_id") in seeded]
    logger.info("desc=%s asc=%s", desc, asc)

    assert desc == sorted(desc, reverse=True), f"desc must be newest-first, got {desc}"
    assert asc == sorted(asc), f"asc must be oldest-first, got {asc}"
    # The defect ignored the requested direction, so the two must actually differ.
    assert asc == list(reversed(desc)), \
        f"asc must be the reverse of desc; asc={asc} desc={desc}"

