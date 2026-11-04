"""Trace DAG and latest-traces SQL quote the stream name and trace id, so neither can change the query  [regression #15155]."""

from __future__ import annotations

import logging
import re
import secrets
import time
from collections.abc import Generator
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import quote

import pytest

from support.client import OpenObserveClient
from support.otlp_json import now_unix_nano, span, string_attr, traces_request
from support.wait import wait_until

logger = logging.getLogger(__name__)

HOUR_US = 60 * 60 * 1000 * 1000
SQL_LEAK = re.compile(r"SQL error|TokenizerError|Error during planning|SQL execute error", re.IGNORECASE)
SERVICE = "e2e-15155"


@dataclass
class ApiResult:
    status: int
    text: str
    body: dict[str, Any] = field(default_factory=dict)


@dataclass
class SeededTraces:
    a_trace_id: str
    a_root_span_id: str
    a_child_span_id: str
    b_trace_id: str
    b_span_id: str

    @property
    def all_span_ids(self) -> list[str]:
        return [self.a_root_span_id, self.a_child_span_id, self.b_span_id]


@pytest.fixture
def stream(client: OpenObserveClient) -> Generator[str, None, None]:
    name = f"e2e_15155_{secrets.token_hex(4)}"
    yield name
    try:
        client.streams.delete(name, type_="traces")
    except Exception as e:
        logger.warning("could not delete trace stream %s: %s", name, e)


def _path_segment(value: str) -> str:
    return quote(value, safe="!~*'()")


def _search_window() -> dict[str, int]:
    end_us = int(time.time() * 1_000_000) + 60_000_000
    return {"start_time": end_us - HOUR_US, "end_time": end_us}


def _span(trace_id: str, span_id: str, name: str, parent_span_id: str | None) -> dict[str, Any]:
    sp = span(
        name,
        trace_id=trace_id,
        span_id=span_id,
        time_unix_nano=now_unix_nano() - 5_000_000_000,
        duration_nanos=1_000_000_000,
        attributes=[string_attr("gen_ai.operation.name", "chat"), string_attr("gen_ai.request.model", "gpt-4o")],
    )
    if parent_span_id:
        sp["parentSpanId"] = parent_span_id
    sp["status"] = {"code": 1}
    return sp


def _ingest_two_traces(client: OpenObserveClient, stream: str) -> SeededTraces:
    # Trace A has a parent and a child span, trace B one span; gen_ai attributes give the stream the columns the DAG query selects.
    t = SeededTraces(
        a_trace_id=secrets.token_hex(16),
        a_root_span_id=secrets.token_hex(8),
        a_child_span_id=secrets.token_hex(8),
        b_trace_id=secrets.token_hex(16),
        b_span_id=secrets.token_hex(8),
    )
    spans = [
        _span(t.a_trace_id, t.a_root_span_id, "turn-a", None),
        _span(t.a_trace_id, t.a_child_span_id, "turn-a-call", t.a_root_span_id),
        _span(t.b_trace_id, t.b_span_id, "turn-b", None),
    ]
    resp = client.post("v1/traces", json=traces_request(spans, service=SERVICE), headers={"stream-name": stream})
    assert resp.status_code == 200, f"Precondition: both traces must ingest, got {resp.status_code}: {resp.text}"
    return t


def _get_json(client: OpenObserveClient, path: str, params: dict[str, Any]) -> ApiResult:
    resp = client.get(path, params=params)
    try:
        parsed = resp.json()
    except ValueError:
        parsed = {}
    return ApiResult(status=resp.status_code, text=resp.text, body=parsed if isinstance(parsed, dict) else {})


def _get_dag(client: OpenObserveClient, stream: str, trace_id: str) -> ApiResult:
    path = f"{_path_segment(stream)}/traces/{_path_segment(trace_id)}/dag"
    return _get_json(client, path, _search_window())


def _get_latest_traces(client: OpenObserveClient, stream: str, route: str) -> ApiResult:
    return _get_json(client, f"{_path_segment(stream)}/traces/{route}", {**_search_window(), "from": 0, "size": 25})


def _node_span_ids(dag: ApiResult) -> list[str]:
    return sorted(n.get("span_id") for n in dag.body.get("nodes") or [])


def _wait_for_trace_a(client: OpenObserveClient, stream: str, t: SeededTraces) -> None:
    wait_until(
        lambda: len(_node_span_ids(_get_dag(client, stream, t.a_trace_id))) == 2,
        timeout=60,
        interval=2,
        msg="the seeded trace must become searchable through the DAG endpoint",
    )


def test_trace_graph_of_a_quoted_trace_id_returns_no_spans_from_other_traces(client: OpenObserveClient, stream: str):
    """#15155: the trace graph of a trace id with quotes in it returns no spans from other traces."""
    t = _ingest_two_traces(client, stream)
    _wait_for_trace_a(client, stream, t)

    normal = _get_dag(client, stream, t.a_trace_id)
    assert normal.status == 200, f"a normal trace id must still load its graph, got {normal.status}: {normal.text}"
    assert _node_span_ids(normal) == sorted([t.a_root_span_id, t.a_child_span_id]), (
        f"a normal trace id must return exactly its own spans: {normal.body}"
    )
    assert normal.body.get("edges") == [{"from": t.a_root_span_id, "to": t.a_child_span_id}], (
        f"a normal trace id must keep its parent-child edge: {normal.body}"
    )

    quoted_ids = [
        f"{t.a_trace_id}' OR trace_id = '{t.b_trace_id}",
        "x' OR '1'='1",
        f"{t.a_trace_id}' --",
        f"{t.a_trace_id}'x",
    ]
    for quoted_id in quoted_ids:
        dag = _get_dag(client, stream, quoted_id)
        logger.info("DAG for a quoted trace id %r: status=%s nodes=%s", quoted_id, dag.status, len(_node_span_ids(dag)))
        assert not SQL_LEAK.search(dag.text), f'#15155: "{quoted_id}" must not reach the SQL parser: {dag.text}'
        assert _node_span_ids(dag) == [], f'#15155: no trace is called "{quoted_id}", so its graph must have no spans'
        assert dag.status < 500, f"an unknown trace id is a client-side miss, never a server error, got {dag.status}"


def test_trace_graph_treats_a_quoted_stream_name_as_one_name(client: OpenObserveClient, stream: str):
    """#15155: the trace graph treats a stream name with quotes or a SQL comment as one name."""
    t = _ingest_two_traces(client, stream)
    _wait_for_trace_a(client, stream, t)

    for quoted_stream in [f"{stream} --", f'{stream}" x']:
        dag = _get_dag(client, quoted_stream, "no-such-trace")
        logger.info(
            "DAG for a quoted stream %r: status=%s nodes=%s", quoted_stream, dag.status, len(_node_span_ids(dag))
        )
        assert not SQL_LEAK.search(dag.text), (
            f'#15155: stream "{quoted_stream}" must not reach the SQL parser: {dag.text}'
        )
        leaked = [i for i in _node_span_ids(dag) if i in t.all_span_ids]
        assert leaked == [], f'#15155: stream "{quoted_stream}" must not read {stream}'
        message = dag.body.get("message") or ""
        assert f"not found: {quoted_stream}" in message, (
            f"the whole quoted name must be looked up as a stream that does not exist, got {message!r}"
        )


def test_trace_list_treats_a_quoted_stream_name_as_one_name(client: OpenObserveClient, stream: str):
    """#15155: the trace list treats a stream name with a quote as one name and leaks no SQL error."""
    t = _ingest_two_traces(client, stream)
    _wait_for_trace_a(client, stream, t)

    normal = _get_latest_traces(client, stream, "latest")
    assert normal.status == 200, f"a normal stream name must still list its traces, got {normal.status}: {normal.text}"
    listed = sorted(h.get("trace_id") for h in normal.body.get("hits") or [])
    assert listed == sorted([t.a_trace_id, t.b_trace_id]), f"a normal stream name must list both traces, got {listed}"

    quoted_stream = f'{stream}" --'
    for route in ["latest", "latest_stream"]:
        result = _get_latest_traces(client, quoted_stream, route)
        logger.info("Trace list for a quoted stream via %s: status=%s text=%s", route, result.status, result.text[:300])
        assert not SQL_LEAK.search(result.text), (
            f'#15155: traces/{route} must not run "{quoted_stream}" as SQL: {result.text}'
        )
        assert "not found" in result.text, (
            f"the whole quoted name must be looked up as a stream that does not exist: {result.text}"
        )
        assert t.a_trace_id not in result.text, f"traces/{route} must not list {stream}'s traces"
