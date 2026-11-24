"""A scheduled pipeline's delay postpones the run and keeps the window ending at the slot (o2-enterprise#3553)."""

from __future__ import annotations

import logging
import time
from typing import Any

import pytest

from support.client import OpenObserveClient
from support.factories import unique_name
from support.wait import wait_until
from tests.pipelines.test_pipeline_regression import _delete_pipeline_by_name, _find_pipeline, _scheduled_payload
from tests.regression.test_pipeline_cron_seconds import _history

logger = logging.getLogger(__name__)

MINUTE_US = 60_000_000
# the scheduler interval plus the run's own tolerance, well under the minute the pre-fix lag adds
LATE_RUN_SLACK_US = 45_000_000


def _delayed_payload(name: str, source: str, destination: str, every_minutes: int, delay: int) -> dict[str, Any]:
    payload = _scheduled_payload(name, source, destination)
    data = payload["nodes"][0]["data"]
    data["trigger_condition"].update({"period": every_minutes, "frequency": every_minutes})
    data["delay"] = delay
    return payload


@pytest.mark.parametrize("delay", [-1, 365 * 24 * 60 + 1])
def test_save_refuses_an_out_of_range_delay(client: OpenObserveClient, delay: int):
    """o2-enterprise#3553: a negative or over-a-year delay was saved and silently skewed every window."""
    name = unique_name("pyt_3553_bad")
    source = unique_name("pyt_3553_bad_src").lower()
    try:
        # a real source stream, so the delay is the only thing the save can refuse
        resp = client.post(f"{source}/_json", json=[{"kind": "seed"}])
        assert resp.status_code == 200, f"ingest failed: {resp.status_code} {resp.text}"
        resp = client.post("pipelines", json=_delayed_payload(name, source, f"{source}_out", 1, delay))
        assert resp.status_code == 400, f"delay {delay} must be refused: {resp.status_code} {resp.text}"
        assert "delay must be between 0 and" in resp.text, resp.text
    finally:
        _delete_pipeline_by_name(client, name)
        client.delete(f"streams/{source}?type=logs")


@pytest.mark.slow
def test_delayed_run_searches_the_window_that_ends_at_its_slot(client: OpenObserveClient):
    """o2-enterprise#3553: every 2 min with delay 1 ran at the slot and searched the window before the previous one."""
    name = unique_name("pyt_3553")
    source = unique_name("pyt_3553_src").lower()
    destination = f"{source}_out"
    created_at = int(time.time()) * 1_000_000
    try:
        resp = client.post(f"{source}/_json", json=[{"kind": "seed"}])
        assert resp.status_code == 200, f"ingest failed: {resp.status_code} {resp.text}"
        resp = client.post("pipelines", json=_delayed_payload(name, source, destination, 2, 1))
        assert resp.status_code == 200, f"create failed: {resp.status_code} {resp.text}"
        pipeline = _find_pipeline(client, name)
        assert pipeline, f"{name} is not listed after create"

        # the first run happens at save time, so only the runs the scheduler planned show the delay
        def planned_runs() -> list[dict[str, Any]] | None:
            runs = sorted(_history(client, pipeline["pipeline_id"], created_at), key=lambda h: h["timestamp"])
            return runs[1:] if len(runs) >= 3 else None

        runs = wait_until(planned_runs, timeout=7 * 60, interval=5, msg=f"{name} did not run three times")
        for run in runs:
            window = (run["start_time"], run["end_time"], run["timestamp"])
            assert run["end_time"] % (2 * MINUTE_US) == 0, f"window must end on a 2-minute slot: {window}"
            assert run["end_time"] - run["start_time"] == 2 * MINUTE_US, f"window must be one period: {window}"
            lag = run["timestamp"] - run["end_time"]
            assert MINUTE_US <= lag < MINUTE_US + LATE_RUN_SLACK_US, (
                f"a run must start one delay after its window ends, not a period later: lag {lag} us, {window}"
            )
    finally:
        _delete_pipeline_by_name(client, name)
        for stream in (source, destination):
            try:
                client.delete(f"streams/{stream}?type=logs")
            except Exception as e:
                logger.warning("stream cleanup failed for %s: %s", stream, e)
