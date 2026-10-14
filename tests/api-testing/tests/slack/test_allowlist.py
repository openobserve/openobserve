"""AC-1.7 and AC-1.8: ``O2_SLACK_ALLOWED_ORGS`` turns Slack on per org.

Start the server with ``O2_SLACK_ENABLED=true`` and ``O2_SLACK_ALLOWED_ORGS=<the test org>``, and export
the same value as ``SLACK_ALLOWED_ORGS`` for pytest. A freshly created org is outside the list.
"""
from __future__ import annotations

import os

import pytest

from support.client import OpenObserveClient

from .slack_helpers import ROUTES, call, make_org, slack_config

pytestmark = [pytest.mark.enterprise]


@pytest.fixture(scope="module")
def outside_org(client: OpenObserveClient, slack_org: str, slack_on: None) -> str:
    allowed = [o.strip() for o in os.environ.get("SLACK_ALLOWED_ORGS", "").split(",") if o.strip()]
    if slack_org not in allowed:
        pytest.skip("export SLACK_ALLOWED_ORGS (the server's O2_SLACK_ALLOWED_ORGS) including the test org")
    return make_org(client)


def test_config_per_org(client: OpenObserveClient, slack_org: str, outside_org: str) -> None:
    inside = slack_config(client, slack_org)
    outside = slack_config(client, outside_org)
    assert inside["slack_enabled"] is True
    assert inside["slack_disabled_reason"] is None
    assert outside["slack_enabled"] is False
    assert outside["slack_disabled_reason"] == "allowlist"


@pytest.mark.parametrize(("method", "path", "body"), ROUTES, ids=[f"{m} {p}" for m, p, _ in ROUTES])
def test_an_org_outside_the_list_gets_404(
    client: OpenObserveClient, outside_org: str, method: str, path: str, body: dict | None
) -> None:
    resp = call(client, method, path, body, org=outside_org)
    assert resp.status_code == 404, resp.text
    assert resp.json()["message"] == "Slack is not enabled"


def test_the_allowed_org_answers(client: OpenObserveClient, slack_org: str, outside_org: str) -> None:
    resp = client.get("slack/installations", org=slack_org)
    assert resp.status_code == 200, resp.text
    assert "installations" in resp.json()
