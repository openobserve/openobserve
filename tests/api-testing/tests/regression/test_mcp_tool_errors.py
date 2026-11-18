"""MCP error codes, tool failures as results, bounded results and tool_search stemming (#16350)."""

from __future__ import annotations

import json
from typing import Any

import pytest

from support.client import OpenObserveClient
from support.factories import search_payload, time_window
from support.wait import wait_until

JSONRPC_INVALID_PARAMS = -32602


def _rpc(client: OpenObserveClient, method: str, params: dict[str, Any], rpc_id: int = 1) -> dict[str, Any]:
    resp = client.post("mcp", json={"jsonrpc": "2.0", "id": rpc_id, "method": method, "params": params})
    assert resp.status_code == 200, f"{method}: {resp.status_code} {resp.text[:500]}"
    return resp.json()


def _call(client: OpenObserveClient, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    return _rpc(client, "tools/call", {"name": name, "arguments": arguments})


def test_initialize_does_not_advertise_completions(client: OpenObserveClient):
    """openobserve#16350: completion/complete was never implemented, so the capability must not be offered."""
    body = _rpc(
        client,
        "initialize",
        {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "pytest", "version": "1"}},
    )
    caps = body["result"]["capabilities"]
    assert "tools" in caps, body
    assert "completions" not in caps, body


@pytest.mark.parametrize(
    "params",
    [
        pytest.param({"name": "NoSuchToolPytest", "arguments": {}}, id="unknown-tool"),
        pytest.param({"arguments": {}}, id="missing-name"),
        pytest.param({"name": "tool_search", "arguments": {}}, id="tool-search-without-query"),
    ],
)
def test_unknown_tool_and_malformed_params_are_invalid_params(client: OpenObserveClient, params: dict[str, Any]):
    """openobserve#16350: these were -32603 internal errors; a client must see -32602 to stop retrying."""
    body = _rpc(client, "tools/call", params)
    assert "result" not in body, body
    assert body["error"]["code"] == JSONRPC_INVALID_PARAMS, body


def test_tool_input_validation_failure_is_an_is_error_result(client: OpenObserveClient):
    """openobserve#16350: a missing required tool argument must come back as an isError result the model can read."""
    body = _call(client, "StreamSchema", {})
    assert "error" not in body, f"must not be a JSON-RPC error: {body}"
    result = body["result"]
    assert result["isError"] is True, result
    assert "stream_name" in result["content"][0]["text"], result


@pytest.mark.parametrize(
    ("query", "tool"),
    [
        ("creating an alert", "CreateAlert"),
        ("deleting alerts", "DeleteAlert"),
        ("muting alerts", "MuteAlert"),
        ("dashboard list", "ListDashboards"),
    ],
)
def test_tool_search_matches_verb_and_plural_forms(client: OpenObserveClient, query: str, tool: str):
    """openobserve#16350: tool_search matched only exact word forms, so these tools were outside the top 20."""
    body = _call(client, "tool_search", {"query": query})
    assert body["result"].get("isError") is not True, body
    names = [t["name"] for t in json.loads(body["result"]["content"][0]["text"])["tools"]]
    assert tool in names[:3], f"{query!r}: {tool} not in the top 3 of {names}"


def test_a_tool_result_over_one_mib_is_refused_with_a_hint(client: OpenObserveClient, temp_stream_name: str):
    """openobserve#16350: an unbounded tool result could overflow the client; over 1 MiB must be an isError hint."""
    pad = "x" * 1024
    client.streams.ingest_json(temp_stream_name, [{"n": i, "pad": pad} for i in range(1500)])
    start, end = time_window(minutes=30)
    sql = f'SELECT * FROM "{temp_stream_name}"'

    def _stored() -> bool:
        count_sql = f'SELECT count(*) AS c FROM "{temp_stream_name}"'
        resp = client.post("_search", json=search_payload(count_sql, start_time=start, end_time=end))
        return resp.status_code == 200 and resp.json()["hits"][0]["c"] == 1500

    wait_until(_stored, timeout=30, msg=f"{temp_stream_name} did not store 1500 rows")
    body = _call(
        client,
        "SearchSQL",
        {"request_body": {"query": {"sql": sql, "start_time": start, "end_time": end, "from": 0, "size": 1500}}},
    )
    assert "error" not in body, body
    result = body["result"]
    assert result["isError"] is True, f"a >1 MiB result must be refused: {str(result)[:300]}"
    text = result["content"][0]["text"]
    assert text.startswith("Result too large"), text[:300]
    assert len(text) < 4096, "the refusal must replace the result, not carry it"
