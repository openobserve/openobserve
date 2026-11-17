"""A fractional epoch `_timestamp` keeps its sub-second part on every path #16568 fixed (#16567).

`parse_timestamp_micro_from_value` and `parse_str_to_time` cast the float to `i64` before scaling it, so
`1762596925.123456`, as a JSON number or a string, was stored as `1762596925000000`. The same functions back
the columnar `_json`/`_bulk` path, the row path `_multi` takes, the metrics JSON ingest and the PromQL
`time`/`start`/`end` parameters.
"""

from __future__ import annotations

import json
import time
from collections.abc import Callable, Generator
from typing import Any

import pytest

from support.client import OpenObserveClient
from support.factories import unique_name
from support.wait import wait_until

SEARCH_MINUTES = 30
SEED = "ms-int"


@pytest.fixture
def second() -> int:
    """A whole second inside the ingestion and search windows."""
    return int(time.time()) - 600


@pytest.fixture
def metric_stream(client: OpenObserveClient) -> Generator[str, None, None]:
    name = unique_name("pytest_fractional_epoch")
    yield name
    client.streams.delete(name, type_="metrics")


def _shapes(second: int) -> dict[str, tuple[Any, int]]:
    """Each `_timestamp` shape, as the value sent and the microseconds it must be stored as."""
    base = second * 1_000_000
    return {
        SEED: (second * 1_000 + 123, base + 123_000),
        "sec-float": (float(f"{second}.123456"), base + 123_456),
        # 0.9 has no exact binary form, so the scaled fraction must be rounded, not truncated.
        "sec-float-rounds": (float(f"{second}.9"), base + 900_000),
        "sec-string": (f"{second}.123456", base + 123_456),
        "sec-string-rounds": (f"{second}.9", base + 900_000),
        "ms-float": (float(f"{second}123.456"), base + 123_456),
        "ms-string": (f"{second}123.456", base + 123_456),
        "us-float": (float(base + 123_456), base + 123_456),
    }


def _assert_accepted(resp, record: dict[str, Any]) -> None:
    assert resp.status_code == 200, f"{record}: {resp.status_code} {resp.text[:300]}"
    status = resp.json()["status"][0]
    assert (status["successful"], status["failed"]) == (1, 0), f"#16567 {record}: {status}"


def _send_json(client: OpenObserveClient, stream: str, record: dict[str, Any]) -> None:
    _assert_accepted(client.post(f"{stream}/_json", json=[record]), record)


def _send_multi(client: OpenObserveClient, stream: str, record: dict[str, Any]) -> None:
    resp = client.post(f"{stream}/_multi", data=json.dumps(record), headers={"Content-Type": "application/json"})
    _assert_accepted(resp, record)


def _send_bulk(client: OpenObserveClient, stream: str, record: dict[str, Any]) -> None:
    body = f"{json.dumps({'index': {'_index': stream}})}\n{json.dumps(record)}\n"
    resp = client.post("_bulk", data=body, headers={"Content-Type": "application/json"})
    assert resp.status_code == 200, f"{record}: {resp.status_code} {resp.text[:300]}"
    assert resp.json()["errors"] is False, f"#16567 {record}: {resp.text[:300]}"


def _stored(client: OpenObserveClient, stream: str, count: int, type_: str = "logs") -> dict[str, int]:
    def every_shape() -> dict[str, int] | None:
        resp = client.search.sql(
            f'SELECT shape, _timestamp FROM "{stream}"', minutes=SEARCH_MINUTES, type_=type_, raise_for_status=False
        )
        if resp.status_code != 200:
            return None
        stored = {hit["shape"]: hit["_timestamp"] for hit in resp.json().get("hits", [])}
        return stored if len(stored) == count else None

    return wait_until(every_shape, timeout=60, interval=1, msg=f"{stream} never held all {count} shapes")


def _promql(client: OpenObserveClient, endpoint: str, params: dict[str, str]) -> Any:
    resp = client.get(f"prometheus/api/v1/{endpoint}", params=params)
    assert resp.status_code == 200, f"#16567 {params}: {resp.status_code} {resp.text[:300]}"
    body = resp.json()
    assert body["status"] == "success", body
    return body["data"]["result"]


@pytest.mark.parametrize(
    "send",
    [pytest.param(_send_json, id="json"), pytest.param(_send_multi, id="multi"), pytest.param(_send_bulk, id="bulk")],
)
def test_logs_ingest_keeps_the_fraction(
    client: OpenObserveClient,
    temp_stream_name: str,
    second: int,
    send: Callable[[OpenObserveClient, str, dict[str, Any]], None],
):
    shapes = _shapes(second)
    send(client, temp_stream_name, {"shape": SEED, "_timestamp": shapes[SEED][0]})
    # A stream with no schema skips the columnar fast path, so the seed creates it before the shapes go in.
    wait_until(
        lambda: "shape" in {f["name"] for f in client.streams.schema(temp_stream_name).get("schema", [])},
        timeout=30,
        msg=f"{temp_stream_name} schema never listed `shape`",
    )
    for shape, (value, _) in shapes.items():
        if shape != SEED:
            send(client, temp_stream_name, {"shape": shape, "_timestamp": value})

    stored = _stored(client, temp_stream_name, len(shapes))
    assert stored == {shape: micros for shape, (_, micros) in shapes.items()}, "#16567"


def test_metrics_json_ingest_keeps_the_fraction(client: OpenObserveClient, metric_stream: str, second: int):
    # The metrics JSON ingest refuses a string `_timestamp`, so only the numeric shapes apply.
    shapes = {shape: sent for shape, sent in _shapes(second).items() if not isinstance(sent[0], str)}
    rows = [
        {"__name__": metric_stream, "__type__": "gauge", "shape": shape, "_timestamp": value, "value": 1}
        for shape, (value, _) in shapes.items()
    ]
    resp = client.post("ingest/metrics/_json", json=rows)
    assert resp.status_code == 200, f"{resp.status_code} {resp.text[:300]}"
    statuses = resp.json()["status"]
    accepted = (sum(s["successful"] for s in statuses), sum(s["failed"] for s in statuses))
    assert accepted == (len(rows), 0), f"#16567: {statuses}"

    stored = _stored(client, metric_stream, len(shapes), type_="metrics")
    assert stored == {shape: micros for shape, (_, micros) in shapes.items()}, "#16567"


def test_promql_instant_time_keeps_the_fraction(client: OpenObserveClient, second: int):
    result = _promql(client, "query", {"query": "time()", "time": f"{second}.9"})
    assert float(result[1]) == (second * 1_000 + 900) / 1_000, f"#16567: time()={result}"


def test_promql_range_start_and_end_keep_the_fraction(client: OpenObserveClient, second: int):
    start = second - 120
    params = {"query": "time()", "start": f"{start}.25", "end": f"{second}.25", "step": "60s", "use_cache": "false"}
    result = _promql(client, "query_range", params)
    assert len(result) == 1, f"#16567: {result}"
    # A truncated `end` drops the last step and a truncated `start` moves every step to a whole second.
    assert [float(v) for _, v in result[0]["values"]] == [start + 0.25, start + 60.25, start + 120.25], "#16567"
