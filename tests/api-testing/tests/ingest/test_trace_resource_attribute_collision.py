"""Resource attributes must survive span flattening  [regression #12448].

When a span attribute used the same key as a resource-derived field, flattening
let the span value overwrite it -- so a span carrying its own `service.name`
replaced the resource's, and the trace was attributed to the wrong service.
PR #12456 keeps the resource value canonical and moves the colliding span
attribute aside.

The control span (no collision) is what makes this meaningful: without it a
build that simply ignored span attributes entirely would also pass.
"""

import logging
import os
import time
import uuid

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

ORG_ID = os.environ.get("TEST_ORG_ID", "default")
RESOURCE_SERVICE = "pytest_resource_svc"
SPAN_SERVICE = "pytest_span_override"


def test_span_attribute_does_not_overwrite_resource_service_name(create_session, base_url):
    session = create_session
    now_ns = int(time.time() * 1e9) - 120 * 10**9
    colliding_id = uuid.uuid4().hex
    control_id = uuid.uuid4().hex

    def span(trace_id, name, attrs):
        return {
            "traceId": trace_id, "spanId": uuid.uuid4().hex[:16], "parentSpanId": "",
            "flags": 1, "name": name, "kind": 2,
            "startTimeUnixNano": str(now_ns), "endTimeUnixNano": str(now_ns + 5 * 10**6),
            "attributes": attrs, "status": {"code": 0},
        }

    payload = {"resourceSpans": [{
        "resource": {"attributes": [
            {"key": "service.name", "value": {"stringValue": RESOURCE_SERVICE}}]},
        "scopeSpans": [{"scope": {"name": "pytest"}, "spans": [
            # Collides with the resource-derived service_name.
            span(colliding_id, "colliding",
                 [{"key": "service.name", "value": {"stringValue": SPAN_SERVICE}}]),
            span(control_id, "control",
                 [{"key": "http.route", "value": {"stringValue": "/control"}}]),
        ]}],
    }]}

    r = session.post(f"{base_url}api/{ORG_ID}/v1/traces", json=payload)
    assert r.status_code == 200, f"trace ingest failed: {r.status_code} {r.text[:300]}"

    start_us, end_us = int(now_ns / 1000) - 60_000_000, int(time.time() * 1_000_000)
    rows = []
    for _ in range(40):
        q = session.post(
            f"{base_url}api/{ORG_ID}/_search?type=traces",
            json={"query": {
                "sql": 'SELECT trace_id, service_name, operation_name FROM "default" '
                       f"WHERE trace_id IN ('{colliding_id}','{control_id}')",
                "start_time": start_us, "end_time": end_us, "from": 0, "size": 20}},
        )
        if q.status_code == 200 and len(q.json().get("hits", [])) >= 2:
            rows = q.json()["hits"]
            break
        time.sleep(2)
    assert len(rows) >= 2, f"seeded spans never became searchable, got {rows}"

    by_trace = {r_["trace_id"]: r_.get("service_name") for r_ in rows}
    logger.info("service_name by trace: %s", by_trace)

    assert by_trace.get(control_id) == RESOURCE_SERVICE, \
        f"control span should carry the resource service, got {by_trace.get(control_id)}"
    # The defect let the span attribute win here.
    assert by_trace.get(colliding_id) == RESOURCE_SERVICE, \
        (f"a span attribute must not overwrite the resource service_name: "
         f"got {by_trace.get(colliding_id)!r}, expected {RESOURCE_SERVICE!r}")
