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
