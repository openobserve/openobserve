"""Ingest helper that waits for a new realtime pipeline to start routing, with no fixed sleep."""

from __future__ import annotations

import logging
import time
import uuid
from typing import Any

from .client import OpenObserveClient
from .wait import wait_until

log = logging.getLogger("o2-api")


def _rows_by_batch(client: OpenObserveClient, stream: str) -> dict[str, list[dict[str, Any]]]:
    now = int(time.time())
    resp = client.post(
        "_search?type=logs&use_cache=false",
        json={
            "query": {
                "sql": f'SELECT * FROM "{stream}"',
                "start_time": (now - 600) * 1_000_000,
                "end_time": (now + 60) * 1_000_000,
                "size": 1000,
            }
        },
    )
    if resp.status_code != 200:
        return {}
    grouped: dict[str, list[dict[str, Any]]] = {}
    for hit in resp.json().get("hits", []):
        if hit.get("batch"):
            grouped.setdefault(hit["batch"], []).append(hit)
    return grouped


def ingest_until_routed(
    client: OpenObserveClient,
    source: str,
    destination: str,
    records: list[dict[str, Any]],
    *,
    timeout: float = 45.0,
) -> list[dict[str, Any]]:
    """Send `records` with a fresh `batch` value until a batch reaches `destination`; return the earliest routed batch's rows."""
    sent: list[str] = []

    def attempt() -> list[dict[str, Any]] | None:
        # the pipeline joins the ingest path a few ms after its create returns, so an early batch can pass it by
        marker = uuid.uuid4().hex
        resp = client.post(f"{source}/_json", json=[{**r, "batch": marker} for r in records])
        assert resp.status_code == 200, f"ingest failed: {resp.status_code} {resp.text}"
        sent.append(marker)
        routed = _rows_by_batch(client, destination)
        first = next((m for m in sent if m in routed), None)
        if first is None:
            return None
        log.info("%s: batch %d of %d sent was the first routed", destination, sent.index(first) + 1, len(sent))
        return routed[first]

    return wait_until(attempt, timeout=timeout, interval=1.0, msg=f"{destination} got no batch from {source}")
