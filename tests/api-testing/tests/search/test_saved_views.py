"""Saved views: the optional `view_type` field over the HTTP API."""
from __future__ import annotations

import uuid

from support.client import OpenObserveClient
from support.fixtures import client  # noqa: F401


def _create(client: OpenObserveClient, **extra) -> str:
    payload = {"data": {"v": 1}, "view_name": f"sv-{uuid.uuid4().hex[:12]}", **extra}
    resp = client.post("savedviews", json=payload)
    assert resp.status_code == 200, resp.text
    return resp.json()["view_id"]


def test_view_type_is_omitted_when_unset_and_kept_when_set(client: OpenObserveClient):
    """A view saved without `view_type` (the legacy shape) reads back without the key."""
    plain_id = _create(client)
    traces_id = _create(client, view_type="traces")
    try:
        plain = client.get(f"savedviews/{plain_id}")
        assert plain.status_code == 200, plain.text
        assert "view_type" not in plain.json()

        traces = client.get(f"savedviews/{traces_id}")
        assert traces.status_code == 200, traces.text
        assert traces.json()["view_type"] == "traces"

        listed = {v["view_id"]: v for v in client.get("savedviews").json()["views"]}
        assert "view_type" not in listed[plain_id]
        assert listed[traces_id]["view_type"] == "traces"
    finally:
        client.delete(f"savedviews/{plain_id}")
        client.delete(f"savedviews/{traces_id}")
