"""User-defined schemas keep columns the product needs when they first arrive after the schema was saved (#16307).

#16675: a metrics UDS saved before any histogram sample left `le` out, so later bucket samples packed `le`
into `_all` and `WHERE le = ...` matched nothing. #16771: a UDS saved without an enabled partition key packed
that key into `_all` too, so new rows partitioned as null. Both need ZO_ALLOW_USER_DEFINED_SCHEMAS=true, which
only the `uds_enabled` regression shard sets.
"""

from __future__ import annotations

import time
from collections.abc import Generator
from typing import Any

import pytest

from support.client import OpenObserveClient
from support.factories import search_payload, time_window, unique_name
from support.wait import wait_until


@pytest.fixture
def created_streams(client: OpenObserveClient) -> Generator[list[tuple[str, str]], None, None]:
    streams: list[tuple[str, str]] = []
    yield streams
    for name, stream_type in streams:
        client.streams.delete(name, type_=stream_type)


def _hits(client: OpenObserveClient, sql: str, stream_type: str) -> list[dict[str, Any]]:
    start, end = time_window(minutes=30)
    resp = client.post("_search", params={"type": stream_type}, json=search_payload(sql, start_time=start, end_time=end))
    return resp.json().get("hits", []) if resp.status_code == 200 else []


def _settings(client: OpenObserveClient, name: str, stream_type: str) -> dict[str, Any]:
    resp = client.get(f"streams/{name}/schema", params={"type": stream_type})
    assert resp.status_code == 200, resp.text
    return resp.json().get("settings", {})


def _has_schema(client: OpenObserveClient, name: str, stream_type: str) -> bool:
    resp = client.get(f"streams/{name}/schema", params={"type": stream_type})
    return resp.status_code == 200 and bool(resp.json().get("schema"))


def _save_uds(client: OpenObserveClient, name: str, stream_type: str, fields: list[str]) -> None:
    resp = client.streams.update_settings(name, type_=stream_type, defined_schema_fields={"add": fields})
    assert resp.status_code == 200, f"saving the UDS failed (is ZO_ALLOW_USER_DEFINED_SCHEMAS on?): {resp.text}"
    saved = _settings(client, name, stream_type).get("defined_schema_fields") or []
    assert set(fields) <= set(saved), f"the UDS was not saved: {saved}"


def test_metrics_uds_saved_before_histogram_samples_keeps_le_queryable(
    client: OpenObserveClient, created_streams: list[tuple[str, str]]
):
    """#16675: bucket samples arriving after the UDS was saved kept `le` as its own column."""
    metric = unique_name("pytest_uds_le")
    created_streams.append((metric, "metrics"))
    now_ms = int(time.time() * 1000)
    resp = client.post("ingest/metrics/_json", json=[{"__name__": metric, "job": "uds", "_timestamp": now_ms - 120_000, "value": 1}])
    assert resp.status_code == 200, resp.text
    wait_until(lambda: _has_schema(client, metric, "metrics"), timeout=30, msg=f"{metric} was never created")
    _save_uds(client, metric, "metrics", ["job"])

    buckets = [("0.5", 3), ("1", 5), ("+Inf", 7)]
    rows = [{"__name__": metric, "job": "uds", "le": le, "_timestamp": now_ms - 60_000, "value": v} for le, v in buckets]
    resp = client.post("ingest/metrics/_json", json=rows)
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"][0]["successful"] == len(rows), resp.text

    got = wait_until(
        lambda: _hits(client, f"SELECT le, value FROM \"{metric}\" WHERE le = '1'", "metrics"),
        timeout=30,
        msg=f"WHERE le = '1' never matched in {metric}; `le` was packed into _all",
    )
    assert [(h["le"], h["value"]) for h in got] == [("1", 5)], got
    schema = client.get(f"streams/{metric}/schema", params={"type": "metrics"}).json().get("schema", [])
    assert "le" in {field["name"] for field in schema}, f"`le` is not a column of {metric}: {schema}"


def test_uds_saved_without_an_enabled_partition_key_keeps_partitioning_on_it(
    client: OpenObserveClient, created_streams: list[tuple[str, str]]
):
    """#16771: a UDS that omits an enabled partition key kept the key, so new rows stay findable by it."""
    stream = unique_name("pytest_uds_pkey")
    created_streams.append((stream, "logs"))
    resp = client.post(f"{stream}/_json", json=[{"host": "seed", "msg": "seed"}])
    assert resp.status_code == 200, resp.text
    wait_until(lambda: _has_schema(client, stream, "logs"), timeout=30, msg=f"{stream} was never created")
    resp = client.streams.update_settings(stream, partition_keys={"add": [{"field": "host", "types": "value"}]})
    assert resp.status_code == 200, resp.text
    _save_uds(client, stream, "logs", ["msg"])

    settings = _settings(client, stream, "logs")
    keys = [key["field"] for key in (settings.get("partition_keys") or {}).values() if not key.get("disabled")]
    assert keys == ["host"], f"the partition key was dropped by the UDS save: {settings}"

    resp = client.post(f"{stream}/_json", json=[{"host": "x", "msg": f"after-uds-{i}"} for i in range(3)])
    assert resp.status_code == 200, resp.text
    got = wait_until(
        lambda: _hits(client, f"SELECT msg FROM \"{stream}\" WHERE host = 'x'", "logs"),
        timeout=30,
        msg=f"WHERE host = 'x' never matched in {stream}; the key was packed into _all",
    )
    assert sorted(h["msg"] for h in got) == [f"after-uds-{i}" for i in range(3)], got
