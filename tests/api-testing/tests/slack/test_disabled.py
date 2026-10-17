"""AC-1.1 and AC-1.10: Slack ships dark.

Runs against a server with ``O2_SLACK_ENABLED`` off; skips itself when Slack is on for the org.
"""
from __future__ import annotations

from urllib.parse import urljoin

import pytest
import requests

from support.client import OpenObserveClient

from .slack_helpers import ROUTES, call, make_user

PREREQUISITE_IDS = {"master_key", "delegation_key", "web_url", "agent"}


@pytest.fixture(scope="module")
def slack_off(slack_state: dict) -> dict:
    if slack_state["slack_enabled"]:
        pytest.skip("Slack is on for this org; run test_disabled.py against a server with O2_SLACK_ENABLED unset")
    if slack_state["slack_disabled_reason"] not in ("flag", "edition"):
        pytest.skip(f"Slack is off for {slack_state['slack_disabled_reason']}, not the flag; test_master_key.py covers that run")
    return slack_state


@pytest.fixture(scope="module")
def member(client: OpenObserveClient, slack_org: str, slack_off: dict) -> OpenObserveClient:
    _, as_member = make_user(client, slack_org, "admin")
    return as_member


def test_org_config_says_why_slack_is_off(client: OpenObserveClient, slack_org: str, slack_off: dict) -> None:
    want = "edition" if slack_off["build_type"] == "opensource" else "flag"
    assert slack_off["slack_enabled"] is False
    assert slack_off["slack_disabled_reason"] == want
    resp = client.get("config", org=slack_org)
    assert resp.status_code == 200, resp.text
    assert "slack_home_region" not in resp.json()


@pytest.mark.parametrize(("method", "path", "body"), ROUTES, ids=[f"{m} {p}" for m, p, _ in ROUTES])
def test_every_org_route_is_404_for_root(
    client: OpenObserveClient, slack_org: str, slack_off: dict, method: str, path: str, body: dict | None
) -> None:
    resp = call(client, method, path, body, org=slack_org)
    if slack_off["build_type"] == "opensource":
        assert resp.status_code == 403, resp.text
        assert resp.json()["message"] == "Not Supported"
        return
    assert resp.status_code == 404, resp.text
    assert resp.json() == {"code": 404, "message": "Slack is not enabled"}


@pytest.mark.parametrize(("method", "path", "body"), ROUTES, ids=[f"{m} {p}" for m, p, _ in ROUTES])
def test_every_org_route_is_404_for_an_org_admin(
    member: OpenObserveClient, slack_org: str, slack_off: dict, method: str, path: str, body: dict | None
) -> None:
    resp = call(member, method, path, body, org=slack_org)
    expected = 403 if slack_off["build_type"] == "opensource" else 404
    assert resp.status_code == expected, resp.text


def test_a_bad_body_is_still_404(client: OpenObserveClient, slack_org: str, slack_off: dict) -> None:
    if slack_off["build_type"] == "opensource":
        pytest.skip("OSS answers 403 for every body")
    resp = client.post("slack/installations/I1/connection", json={"ticket": 1}, org=slack_org)
    assert resp.status_code == 404, resp.text


def test_prerequisites_are_readable_by_root(client: OpenObserveClient, slack_org: str, slack_off: dict) -> None:
    resp = client.get("slack/prerequisites", org=slack_org)
    if slack_off["build_type"] == "opensource":
        assert resp.status_code == 403, resp.text
        return
    assert resp.status_code == 200, resp.text
    checks = resp.json()["checks"]
    assert PREREQUISITE_IDS <= {c["id"] for c in checks}, checks
    for c in checks:
        assert c["status"] in ("pass", "fail", "warn"), c


def test_prerequisites_are_readable_by_a_meta_admin(client: OpenObserveClient, slack_off: dict) -> None:
    if slack_off["build_type"] == "opensource":
        pytest.skip("OSS has no prerequisites")
    _, meta_admin = make_user(client, "_meta", "admin")
    resp = meta_admin.get("slack/prerequisites", org="_meta")
    assert resp.status_code == 200, resp.text
    assert PREREQUISITE_IDS <= {c["id"] for c in resp.json()["checks"]}


def test_prerequisites_are_404_for_an_org_admin_while_the_flag_is_off(
    member: OpenObserveClient, slack_org: str, slack_off: dict
) -> None:
    if slack_off["build_type"] == "opensource":
        pytest.skip("OSS answers 403")
    resp = member.get("slack/prerequisites", org=slack_org)
    assert resp.status_code == 404, resp.text


@pytest.mark.parametrize("kind", ["events", "commands", "interactions"])
def test_inbound_slack_routes_are_404(client: OpenObserveClient, slack_off: dict, kind: str) -> None:
    """AC-1.1 and AC-1.10: Slack's own requests carry no O2 credentials and still get 404."""
    resp = requests.post(
        urljoin(client.base_url, f"api/slack/{kind}"),
        data=b'{"type": "url_verification", "challenge": "c"}',
        headers={"Content-Type": "application/json", "X-Slack-Request-Timestamp": "1", "X-Slack-Signature": "v0=00"},
        timeout=10,
    )
    assert resp.status_code == 404, resp.text
    assert resp.json() == {"code": 404, "message": "Slack is not enabled"}
