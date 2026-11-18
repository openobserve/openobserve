"""A pipeline's fixed destination stream name is formatted on save like every other stream name (#16639)."""

from __future__ import annotations

from typing import Any

from support.client import OpenObserveClient
from support.factories import unique_name
from support.pipeline_routing import ingest_until_routed
from tests.pipelines.test_pipeline_regression import (  # noqa: F401
    _delete_pipeline_by_name,
    _find_pipeline,
    _realtime_payload,
    seeded_stream,
)


def _stream_node_names(pipeline: dict[str, Any]) -> list[str]:
    return [n["data"]["stream_name"] for n in pipeline["nodes"] if n["data"].get("node_type") == "stream"]


def test_fixed_destination_name_is_formatted_and_receives_the_records(
    client: OpenObserveClient,
    seeded_stream: str,  # noqa: F811
):
    """openobserve#16639: `a b-c.d` was kept as typed, so the pipeline wrote to a stream the editor never created."""
    name = unique_name("pyt_16639")
    # lowercase only, so the expectation holds whether or not the server lowercases stream names
    raw = f"{seeded_stream} out-put.v2"
    formatted = f"{seeded_stream}_out_put_v2"
    try:
        resp = client.post("pipelines", json=_realtime_payload(name, seeded_stream, raw))
        assert resp.status_code == 200, f"create failed: {resp.status_code} {resp.text}"
        pipeline = _find_pipeline(client, name)
        assert pipeline, f"{name} is not listed after create"
        assert _stream_node_names(pipeline) == [seeded_stream, formatted], pipeline["nodes"]

        routed = ingest_until_routed(client, seeded_stream, formatted, [{"m": f"r{i}"} for i in range(3)])
        assert sorted(row["m"] for row in routed) == ["r0", "r1", "r2"], routed
        streams = {s["name"] for s in client.get("streams", params={"type": "logs"}).json().get("list", [])}
        assert raw not in streams, f"a stream named as typed was created: {raw!r}"
    finally:
        _delete_pipeline_by_name(client, name)
        client.delete(f"streams/{formatted}?type=logs")


def test_templated_destination_name_is_left_for_per_record_resolution(
    client: OpenObserveClient,
    seeded_stream: str,  # noqa: F811
):
    """openobserve#16639: formatting must skip `{...}` templates, or dynamic destinations stop resolving."""
    name = unique_name("pyt_16639_tpl")
    template = f"{seeded_stream}_{{kind}}"
    try:
        resp = client.post("pipelines", json=_realtime_payload(name, seeded_stream, template))
        assert resp.status_code == 200, f"create failed: {resp.status_code} {resp.text}"
        pipeline = _find_pipeline(client, name)
        assert pipeline, f"{name} is not listed after create"
        assert _stream_node_names(pipeline) == [seeded_stream, template], pipeline["nodes"]
    finally:
        _delete_pipeline_by_name(client, name)
