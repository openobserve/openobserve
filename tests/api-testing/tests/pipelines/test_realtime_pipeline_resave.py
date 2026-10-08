"""Re-saving a realtime pipeline must not duplicate events  [regression #13228].

Saving an already-enabled realtime pipeline left the previous entry in the
ingester's pipeline cache, so every subsequent record was processed once per
save and the destination stream over-counted until the service was restarted.
Fixed in PR #13186 by deduping the cache on save.

The oracle is the destination row count after a known ingest, because the
pipeline list looks identical either way -- the duplication lived in the cache,
not in the stored definition.
"""
from __future__ import annotations

import logging
import time
import uuid
from collections.abc import Generator
from typing import Any

import pytest

from support.client import OpenObserveClient
from support.factories import unique_name

logger = logging.getLogger(__name__)

ORG_ID = "default"

SAVE_COUNT = 3
EVENT_COUNT = 10
ROUTING_TIMEOUT = 120


def _realtime_payload(name: str, source_stream: str, destination_stream: str) -> dict[str, Any]:
    input_id = str(uuid.uuid4())
    output_id = str(uuid.uuid4())
    return {
        "name": name,
        "description": "",
        "source": {"source_type": "realtime"},
        "nodes": [
            {
                "id": input_id,
                "type": "input",
                "data": {
                    "node_type": "stream",
                    "stream_name": source_stream,
                    "stream_type": "logs",
                    "org_id": ORG_ID,
                },
                "position": {"x": 100, "y": 100},
                "io_type": "input",
            },
            {
                "id": output_id,
                "type": "output",
                "data": {
                    "node_type": "stream",
                    "stream_name": destination_stream,
                    "stream_type": "logs",
                    "org_id": ORG_ID,
                },
                "position": {"x": 300, "y": 100},
                "io_type": "output",
            },
        ],
        "edges": [{"id": f"e-{input_id}-{output_id}", "source": input_id, "target": output_id}],
        "org": ORG_ID,
    }


def _find_pipeline(client: OpenObserveClient, name: str) -> dict[str, Any] | None:
    pipelines = client.get("pipelines").json().get("list", [])
    return next((p for p in pipelines if p["name"] == name.lower()), None)


def _count_rows(client: OpenObserveClient, stream: str) -> int:
    now = int(time.time() * 1_000_000)
    resp = client.post(
        "_search?type=logs&use_cache=false",
        json={
            "query": {
                "sql": f'SELECT COUNT(*) AS cnt FROM "{stream}"',
                "start_time": now - 3_600_000_000,
                "end_time": now + 3_600_000_000,
                "size": -1,
            }
        },
    )
    if resp.status_code != 200:
        return 0
    hits = resp.json().get("hits") or []
    return hits[0].get("cnt", 0) if hits else 0


def _wait_for_rows(client: OpenObserveClient, stream: str, expected: int) -> int:
    """Settle on a count, then hold to catch a late duplicate arriving after it."""
    deadline = time.time() + ROUTING_TIMEOUT
    while time.time() < deadline:
        if _count_rows(client, stream) >= expected:
            break
        time.sleep(3)
    time.sleep(10)
    return _count_rows(client, stream)


@pytest.fixture
def resaved_pipeline(client: OpenObserveClient) -> Generator[tuple[str, str], None, None]:
    """A realtime pipeline saved SAVE_COUNT times, as the bug required."""
    name = unique_name("pyt_13228").lower()
    source = f"{name}_src"
    destination = f"{name}_dst"

    seed = client.post(f"{source}/_json", json=[{"level": "info", "msg": "seed"}])
    assert seed.status_code == 200, f"seed ingest failed: {seed.text}"

    resp = client.post("pipelines", json=_realtime_payload(name, source, destination))
    assert resp.status_code == 200, f"create failed: {resp.text}"

    pipeline = _find_pipeline(client, name)
    assert pipeline is not None, f"created pipeline {name} not in list"

    # Saves are guarded by `version`, so each one re-reads the stored pipeline.
    for attempt in range(SAVE_COUNT):
        current = _find_pipeline(client, name)
        assert current is not None, f"pipeline {name} vanished before re-save {attempt}"

        payload = _realtime_payload(name, source, destination)
        payload["pipeline_id"] = current["pipeline_id"]
        payload["id"] = current["pipeline_id"]
        payload["version"] = current["version"]
        payload["enabled"] = current["enabled"]

        update = client.put("pipelines", json=payload)
        assert update.status_code == 200, f"re-save {attempt} failed: {update.text}"
        time.sleep(2)

    yield source, destination

    found = _find_pipeline(client, name)
    if found is not None:
        client.delete(f"pipelines/{found['pipeline_id']}")
    for stream in (source, destination):
        client.delete(f"streams/{stream}?type=logs")


def test_resaving_a_realtime_pipeline_routes_each_event_once(
    client: OpenObserveClient, resaved_pipeline
):
    """Each ingested record must land once, however many times the pipeline was saved."""
    source, destination = resaved_pipeline
    now = int(time.time() * 1_000_000)
    records = [
        {"_timestamp": now + i, "seq": i, "msg": "routed"} for i in range(EVENT_COUNT)
    ]

    resp = client.post(f"{source}/_json", json=records)
    assert resp.status_code == 200, f"ingest failed: {resp.text}"

    delivered = _wait_for_rows(client, destination, EVENT_COUNT)

    assert delivered == EVENT_COUNT, (
        f"expected {EVENT_COUNT} routed records after {SAVE_COUNT} saves, "
        f"got {delivered} -- a multiple means the pipeline cache kept a stale entry"
    )
