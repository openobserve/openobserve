"""Fixtures for the Alerts 4.0 (multi-alert) API tests.

`alerts` yields an `AlertsClient` bound to the shared `default` org, with the
template + destination + seed stream already provisioned (mirrors the Playwright
`seedAlertFixtures` beforeEach) and best-effort cleanup of any alert_ids the test
registers on `alerts.created`.
"""
from __future__ import annotations

from collections.abc import Generator

import pytest

from support.client import OpenObserveClient

from .multialert_helpers import AlertsClient


class _Tracked(AlertsClient):
    """AlertsClient that remembers created alert_ids for auto-teardown."""

    def __init__(self, client: OpenObserveClient):
        super().__init__(client)
        self.created: list[str] = []


@pytest.fixture
def alerts(client: OpenObserveClient) -> Generator[_Tracked, None, None]:
    ac = _Tracked(client)
    ac.seed_alert_fixtures()
    try:
        yield ac
    finally:
        ac.delete_alerts(ac.created)


# ---- firing-cycle helpers (alert_states.firing_started_at) --------------------

FAILING_DEST = "auto_p0_failing_dest"


def firing_starts(alerts: AlertsClient, alert_id: str) -> dict[str, int | None]:
    """group_labels -> firing_started_at for every tracked group of a multi-alert."""
    return {g.get("group_labels"): g.get("firing_started_at") for g in alerts.get_alert_groups(alert_id).get("list", [])}


def group_outcomes(alerts: AlertsClient, alert_id: str) -> dict[str, tuple[str | None, int | None]]:
    """group_labels -> (last_outcome, last_outcome_at)."""
    return {
        g.get("group_labels"): (g.get("last_outcome"), g.get("last_outcome_at"))
        for g in alerts.get_alert_groups(alert_id).get("list", [])
    }


@pytest.fixture
def failing_destination(alerts: AlertsClient) -> str:
    """A destination whose every delivery is refused (no auth on this instance's own ingest)."""
    base = alerts._c.base_url.rstrip("/")
    destination = {
        "name": FAILING_DEST,
        "url": f"{base}/api/{alerts.org}/alerts_refused_sink/_json",
        "method": "post", "template": "auto_p0_tmpl", "type": "http", "headers": {},
    }
    alerts._v1("POST", "alerts/destinations", json=destination)
    alerts._v1("PUT", f"alerts/destinations/{FAILING_DEST}", json=destination)
    return FAILING_DEST
