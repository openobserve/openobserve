"""Phase 2 B4a: alert messages from real scheduler runs through the outbound leader (AC-P2.5.1, 5.2, 5.5, 5.11).

Needs the flag-on enterprise server of ``slack_helpers`` with ``ZO_ALERT_SCHEDULE_INTERVAL`` low, so a
``fast_eval`` alert fires within about a minute, and the Slack mock at ``SLACK_MOCK_URL``.
"""
from __future__ import annotations

import json
import uuid
from collections.abc import Generator
from typing import Any

import pytest

from support.client import OpenObserveClient
from support.wait import wait_until

from tests.alerts.multialert_helpers import AlertsClient, fast_eval, multi_alert, simple_alert, uniq
from .slack_helpers import SlackMock, self_hosted_install

CHANNEL = "C0FAKE00011"
GREEN = "#2EB67D"
ACKED = "#ECB22E"


@pytest.fixture
def alerts(client: OpenObserveClient, slack_org: str) -> Generator[AlertsClient, None, None]:
    ac = AlertsClient(client, slack_org)
    ac.seed_alert_fixtures()
    created: list[str] = []
    ac.created = created  # type: ignore[attr-defined]
    try:
        yield ac
    finally:
        ac.delete_alerts(created)


@pytest.fixture
def destination(
    client: OpenObserveClient, slack_org: str, slack_on: None, self_hosted: None, mock: SlackMock
) -> str:
    team = f"T0B4{uuid.uuid4().hex[:6].upper()}"
    mock.add_team(team, "Acme", channels=[
        {"id": CHANNEL, "name": "sre-prod", "is_private": False, "is_member": True, "is_shared": False},
    ])
    inst = self_hosted_install(client, slack_org, team_id=team, mode="http")["installation"]["id"]
    name = f"sre-app-{uuid.uuid4().hex[:6]}"
    body = {
        "name": name, "type": "slack_app", "installation_id": inst, "channel_id": CHANNEL,
        "channel_name": "sre-prod", "buttons": True, "mention": "default", "refire_reuse_minutes": 30,
        "auto_investigate": "off", "shared_channel_confirmed": False, "oncall_room_confirmed": False,
    }
    resp = client.post("alerts/destinations", json=body, org=slack_org)
    assert resp.status_code == 200, resp.text
    return name


def ok_calls(mock: SlackMock, method: str) -> list[dict[str, Any]]:
    return [c for c in mock.calls(method) if c["form"].get("channel") == CHANNEL and "response" in c]


def posts(mock: SlackMock) -> list[dict[str, Any]]:
    return [c for c in ok_calls(mock, "chat.postMessage") if not c["form"].get("thread_ts")]


def replies(mock: SlackMock, ts: str) -> list[dict[str, Any]]:
    return [c for c in ok_calls(mock, "chat.postMessage") if c["form"].get("thread_ts") == ts]


def updates(mock: SlackMock, ts: str) -> list[dict[str, Any]]:
    return [c for c in ok_calls(mock, "chat.update") if c["form"].get("ts") == ts]


def color(call: dict[str, Any]) -> str:
    attachments = json.loads(call["form"].get("attachments") or "[]")
    return attachments[0].get("color", "") if attachments else ""


def create(alerts: AlertsClient, shape: str, destination: str) -> tuple[str, dict[str, Any]]:
    stream = uniq("b4a_msgs")
    alerts.ingest(stream, [{"city": "bangalore", "latency": 900} for _ in range(5)])
    name = uniq(f"b4a_{shape}")
    payload = fast_eval(multi_alert(name) if shape == "multi" else simple_alert(name), stream)
    payload["destinations"] = [destination]
    resp = alerts.create_alert(payload)
    assert resp.status_code == 200, resp.text
    alert_id = alerts.find_alert_id(name)
    alerts.created.append(alert_id)  # type: ignore[attr-defined]
    return alert_id, payload


def first_post(mock: SlackMock, name_hint: str) -> dict[str, Any]:
    def found() -> dict[str, Any] | None:
        mine = [p for p in posts(mock) if name_hint in p["form"].get("text", "") + p["form"].get("attachments", "")]
        return mine[0] if mine else None

    return wait_until(found, timeout=240, interval=3, msg="the alert message is posted")


@pytest.mark.enterprise
@pytest.mark.parametrize("shape", ["multi", "single"])
def test_one_message_per_firing_and_a_green_edit_on_clear(
    alerts: AlertsClient, destination: str, mock: SlackMock, shape: str
) -> None:
    alert_id, payload = create(alerts, shape, destination)
    post = first_post(mock, payload["name"])
    ts = post["response"]["ts"]
    assert json.loads(post["form"]["attachments"])[0]["blocks"], "the message has its blocks"

    if shape == "multi":
        payload["query_condition"]["aggregation"]["having"]["value"] = 5000
    else:
        payload["trigger_condition"]["threshold"] = 100000
    resp = alerts.update_alert(alert_id, payload)
    assert resp.status_code == 200, resp.text

    def green() -> dict[str, Any] | None:
        edits = [u for u in updates(mock, ts) if color(u) == GREEN]
        return edits[-1] if edits else None

    wait_until(green, timeout=240, interval=3, msg="the clear turns the message green")
    mine = [p for p in posts(mock) if payload["name"] in p["form"].get("text", "") + p["form"].get("attachments", "")]
    assert len(mine) == 1, "one message per firing, never a second post"


@pytest.mark.enterprise
def test_a_repeat_replies_in_the_thread_and_an_ack_edits_the_header(
    alerts: AlertsClient, destination: str, mock: SlackMock, client: OpenObserveClient, slack_org: str
) -> None:
    alert_id, payload = create(alerts, "single", destination)
    post = first_post(mock, payload["name"])
    ts = post["response"]["ts"]

    reply = wait_until(lambda: (replies(mock, ts) or [None])[0], timeout=300, interval=5,
                       msg="the repeat after the silence window is a thread reply")
    assert "Still firing" in reply["form"]["text"]
    assert reply["form"].get("reply_broadcast") != "true", "a repeat stays in the thread"

    resp = client.post(f"alerts/{alert_id}/ack", json={}, org=slack_org, prefix="api/v2/")
    assert resp.status_code == 200, resp.text

    def acked() -> dict[str, Any] | None:
        edits = [u for u in updates(mock, ts) if color(u) == ACKED]
        return edits[-1] if edits else None

    edit = wait_until(acked, timeout=60, interval=2, msg="the ack re-renders the header through the outbox")
    assert "acknowledged" in edit["form"]["attachments"].lower()
    mine = [p for p in posts(mock) if payload["name"] in p["form"].get("text", "") + p["form"].get("attachments", "")]
    assert len(mine) == 1, "retried and repeated runs never post a second message"
