"""OTLP/HTTP + JSON request handling on the logs and traces endpoints.

Two regressions this pins, both from o2-enterprise#2661:

1. The logs endpoint used to answer an ``application/json`` request with a
   protobuf-encoded ``ExportLogsServiceResponse`` body. OTLP requires the
   response to carry the same Content-Type the request did, so a JSON client
   got bytes it could not parse — and the partial-success report inside them
   was therefore invisible. Traces always did this correctly.

2. Traces and logs deserialised OTLP/JSON straight into the prost type, which
   rejects the legal ``{"doubleValue": 3.5}`` attribute form with HTTP 400
   ("invalid type: map, expected f64"). 400 is non-retryable in OTLP, so a
   collector dropped the whole batch permanently over one float attribute —
   and float attributes are ordinary (``http.server.duration``, ratios,
   prices). Metrics were unaffected because they normalise JSON first.
"""
from __future__ import annotations

import logging
import uuid

import pytest

from support.otlp_json import double_attr, log_record, logs_request, now_unix_nano, span, traces_request

logger = logging.getLogger(__name__)

# Far enough outside any sane ZO_INGEST_ALLOWED_UPTO that the record is
# certainly rejected, which is what makes the server produce a partial-success
# body to encode in the first place.
STALE_OFFSET_NANOS = 60 * 24 * 60 * 60 * 1_000_000_000


def _hex(length: int) -> str:
    return uuid.uuid4().hex[:length].ljust(length, "0")


def test_logs_answer_a_json_request_with_json(client):
    """A JSON OTLP logs request must come back as parseable JSON, not protobuf."""
    stale = now_unix_nano() - STALE_OFFSET_NANOS
    payload = logs_request([log_record("outside the ingest window", time_unix_nano=stale)])

    resp = client.post(
        "v1/logs",
        json=payload,
        headers={"stream-name": f"otlp_json_ct_{_hex(8)}"},
    )

    assert resp.status_code == 200, resp.text
    content_type = resp.headers.get("content-type", "")
    assert content_type.startswith("application/json"), (
        f"OTLP requires the response Content-Type to match the request's; got {content_type!r} "
        f"with body {resp.content[:60]!r}"
    )
    # The point of the contract: a JSON client can actually read the rejection.
    body = resp.json()
    assert "partialSuccess" in body, body


@pytest.mark.parametrize("signal", ["traces", "logs"])
def test_double_value_attribute_is_accepted(client, signal):
    """A ``doubleValue`` attribute is legal OTLP/JSON and must not fail the batch."""
    marker = _hex(8)
    attributes = [double_attr("http.server.duration", 3.5)]

    if signal == "traces":
        payload = traces_request(
            [span(f"dv_{marker}", trace_id=_hex(32), span_id=_hex(16), attributes=attributes)]
        )
        resp = client.post("v1/traces", json=payload)
    else:
        payload = logs_request([log_record(f"dv_{marker}", attributes=attributes)])
        resp = client.post("v1/logs", json=payload, headers={"stream-name": f"otlp_json_dv_{marker}"})

    assert resp.status_code != 400, (
        f"{signal}: a legal OTLP/JSON doubleValue attribute was rejected with a non-retryable "
        f"400, so the collector drops the whole batch: {resp.text[:200]}"
    )
    assert resp.status_code == 200, resp.text
