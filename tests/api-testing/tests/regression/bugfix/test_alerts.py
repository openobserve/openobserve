"""
Alert regressions — openobserve#5745 and #4795.

Assertions were taken from behaviour observed against a live deployment first.
#5745's stale "not asserted because #5745" note in tests/alerts/test_v2.py is
replaced by the real assertion here.
"""

from __future__ import annotations

import logging
import time

from support.client import OpenObserveClient
from support.factories import unique_name

from .conftest import alert_payload

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


def test_trigger_populates_last_triggered_at(client: OpenObserveClient, temp_alert: str):
    """#5745: last_triggered_at stayed null in the DB and the API response after a trigger."""
    before = client.get(f"alerts/{temp_alert}", prefix="api/v2/").json().get("last_triggered_at")

    resp = client.patch(f"alerts/{temp_alert}/trigger?type=logs", prefix="api/v2/")
    assert resp.status_code == 200, f"trigger failed: {resp.status_code} {resp.text}"

    # The scheduler writes this asynchronously, so poll rather than reading once.
    last = None
    for _ in range(20):
        last = client.get(f"alerts/{temp_alert}", prefix="api/v2/").json().get("last_triggered_at")
        if last:
            break
        time.sleep(1)

    logger.info("#5745 last_triggered_at: before=%r after=%r", before, last)
    assert last, f"#5745: last_triggered_at must be populated after a trigger, got {last!r}"
    assert isinstance(last, int), f"#5745: it must be an epoch integer, got {last!r}"
    assert last > 0, f"#5745: it must be a positive epoch value, got {last!r}"


def test_float_threshold_alert_does_not_panic(
    client: OpenObserveClient, alert_prereqs: dict[str, str]
):
    """#4795: a float in the alert condition panicked job_runtime on ParseIntError."""
    payload = alert_payload(
        name=unique_name("bfx_float"),
        folder_id=alert_prereqs["folder_id"],
        template=alert_prereqs["template_name"],
        destination=alert_prereqs["destination_name"],
    )
    # The panic was on parsing the condition value.
    payload["query_condition"]["conditions"][0]["value"] = "80.5"
    payload["trigger_condition"]["threshold"] = 1

    resp = client.post(
        f"alerts?folder={alert_prereqs['folder_id']}", prefix="api/v2/", json=payload
    )
    assert resp.status_code == 200, \
        f"#4795: an alert with a float condition must be accepted, got {resp.status_code} {resp.text}"
    alert_id = resp.json().get("id") or resp.json().get("alert_id")

    try:
        resp = client.patch(f"alerts/{alert_id}/trigger?type=logs", prefix="api/v2/")
        assert resp.status_code == 200, \
            f"#4795: triggering must not error, got {resp.status_code} {resp.text}"

        # A panic in job_runtime takes the scheduler down, so the alert still
        # being retrievable is the real assertion.
        time.sleep(5)
        resp_get = client.get(f"alerts/{alert_id}", prefix="api/v2/")
        assert resp_get.status_code == 200, (
            f"#4795: the alert must still be retrievable after a float-condition trigger, "
            f"got {resp_get.status_code}"
        )
    finally:
        client.delete(f"alerts/{alert_id}", prefix="api/v2/")
