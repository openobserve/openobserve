"""A scheduled pipeline on a cron with a seconds field keeps moving its window (o2-enterprise#3567)."""

from __future__ import annotations

import logging
import time
from typing import Any

import pytest

from support.client import OpenObserveClient
from support.factories import unique_name
from support.wait import wait_until
from tests.pipelines.test_pipeline_regression import _delete_pipeline_by_name, _find_pipeline, _rows, _scheduled_payload

logger = logging.getLogger(__name__)


def _cron_payload(name: str, source: str, destination: str, cron: str) -> dict[str, Any]:
    payload = _scheduled_payload(name, source, destination)
    payload["nodes"][0]["data"]["trigger_condition"].update({"frequency_type": "cron", "cron": cron, "timezone": "UTC"})
    return payload


def _history(client: OpenObserveClient, pipeline_id: str, since: int) -> list[dict[str, Any]]:
    resp = client.get(
        "pipelines/history",
        params={"pipeline_id": pipeline_id, "start_time": since, "end_time": (int(time.time()) + 60) * 1_000_000, "size": 100},
    )
    assert resp.status_code == 200, f"pipeline history: {resp.status_code} {resp.text}"
    return resp.json()["hits"]


@pytest.mark.slow
def test_scheduled_pipeline_with_a_cron_seconds_field_keeps_running(client: OpenObserveClient):
    """o2-enterprise#3567: with `7 * * * * *` every run after the first got an empty window and skipped forever."""
    name = unique_name("pyt_3567")
    source = unique_name("pyt_3567_src").lower()
    destination = f"{source}_out"
    created_at = int(time.time()) * 1_000_000

    try:
        seed = {"_timestamp": (int(time.time()) - 600) * 1_000_000, "kind": "seed"}
        resp = client.post(f"{source}/_json", json=[seed])
        assert resp.status_code == 200, f"ingest failed: {resp.status_code} {resp.text}"
        resp = client.post("pipelines", json=_cron_payload(name, source, destination, "7 * * * * *"))
        assert resp.status_code == 200, f"create failed: {resp.status_code} {resp.text}"
        pipeline = _find_pipeline(client, name)
        assert pipeline, f"{name} is not listed after create"

        # One record in each of the next three minutes, so three consecutive runs must each move the window.
        minute = int(time.time()) // 60 * 60_000_000
        expected = [(minute + k * 60_000_000 + 30_000_000, f"r{k}") for k in range(3)]
        resp = client.post(f"{source}/_json", json=[{"_timestamp": ts, "kind": kind} for ts, kind in expected])
        assert resp.status_code == 200, f"ingest failed: {resp.status_code} {resp.text}"

        def delivered() -> list[tuple[int, str]] | None:
            got = _rows(client, destination, minute - 60_000_000, minute + 4 * 60_000_000)
            return got if set(expected) <= set(got) else None

        got = wait_until(delivered, timeout=5 * 60, interval=5, msg=f"the cron pipeline stopped delivering into {destination}")
        assert len(got) == len(set(got)), f"records reached {destination} more than once: {sorted(got)}"

        def three_runs() -> list[dict[str, Any]] | None:
            runs = _history(client, pipeline["pipeline_id"], created_at)
            return runs if len(runs) >= 3 else None

        runs = wait_until(three_runs, timeout=60, interval=2, msg=f"pipeline history never recorded three runs of {name}")
        assert {h["pipeline_name"] for h in runs} == {name}, runs
        skipped = [h for h in runs if h["status"] == "skipped" or "Invalid timerange" in (h.get("error") or "")]
        assert not skipped, f"a run was skipped with an empty window: {skipped}"
        windows = sorted((h["start_time"], h["end_time"]) for h in runs)
        assert all(start < end for start, end in windows), f"a run searched an empty window: {windows}"
    finally:
        _delete_pipeline_by_name(client, name)
        for stream in (source, destination):
            try:
                client.delete(f"streams/{stream}?type=logs")
            except Exception as e:
                logger.warning("stream cleanup failed for %s: %s", stream, e)
