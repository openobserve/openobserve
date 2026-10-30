"""Phase 2 B4b: outage backoff, the outbound health line and the mute sweep (AC-P2.5.6, 5.10, MK-6b).

Needs the flag-on enterprise server of ``slack_helpers`` with ``ZO_ALERT_SCHEDULE_INTERVAL`` low and the
Slack mock at ``SLACK_MOCK_URL``. The 30-minute outage digest and the 1,000-firing budget run in the Rust
leader tests against the fake Slack; here the outage lasts two backoff steps, long enough for Settings ›
Slack to count the waiting message.
"""
from __future__ import annotations

import time
from typing import Any

import pytest

from support.client import OpenObserveClient
from support.wait import wait_until

from tests.alerts.multialert_helpers import AlertsClient
from .slack_helpers import SlackMock
from .test_alert_messages import CHANNEL, GREEN, alerts, color, create, destination, first_post, posts, updates

__all__ = ["alerts", "destination"]


def post_attempts(mock: SlackMock) -> list[dict[str, Any]]:
    """Every ``chat.postMessage`` the leader tried on the channel, failed ones included."""
    return [c for c in mock.calls("chat.postMessage") if c["form"].get("channel") == CHANNEL]


def installation_health(client: OpenObserveClient, org: str, installation_id: str) -> dict[str, Any]:
    resp = client.get("slack/installations", org=org)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    items = body["installations"] if isinstance(body, dict) else body
    mine = [i for i in items if i["id"] == installation_id]
    assert mine, f"installation {installation_id} not listed"
    return mine[0]["health"]


@pytest.mark.enterprise
def test_a_lasting_503_is_probed_per_backoff_step_and_settings_count_the_waiting_message(
    alerts: AlertsClient, destination: str, mock: SlackMock, client: OpenObserveClient, slack_org: str
) -> None:
    mock.mode("chat.postMessage", 503, error="service_unavailable")
    alert_id, payload = create(alerts, "single", destination)
    installation_id = next(
        d["installation_id"] for d in client.get("alerts/destinations", org=slack_org).json() if d["name"] == destination
    )

    wait_until(lambda: len(post_attempts(mock)) >= 2 or None, timeout=180, interval=1,
               msg="the first try and the 1 s probe")
    first_at = post_attempts(mock)[0]["at"]
    third = wait_until(lambda: (post_attempts(mock)[2:3] or [None])[0], timeout=30, interval=1,
                       msg="the 5 s probe")
    assert 4 <= third["at"] - first_at <= 12, "1 s, then 5 s between probes"
    assert len(post_attempts(mock)) == 3, "one probe per step, not one per redelivery"

    def waiting() -> dict[str, Any] | None:
        h = installation_health(client, slack_org, installation_id)
        return h if (h.get("outbound_depth") or 0) >= 1 else None

    health = wait_until(waiting, timeout=40, interval=2, msg="Settings › Slack counts the waiting message")
    assert health["outbound_oldest_age_secs"] is not None and health["outbound_oldest_age_secs"] >= 0

    mock.clear_mode("chat.postMessage")
    post = wait_until(
        lambda: next((p for p in posts(mock) if payload["name"] in p["form"].get("attachments", "")), None),
        timeout=120, interval=2, msg="the 30 s probe posts the full message",
    )
    assert "o2_alert_actions" in post["form"]["attachments"], "a full message with buttons, not a digest line"
    assert len(post_attempts(mock)) <= 5, post_attempts(mock)
    wait_until(
        lambda: installation_health(client, slack_org, installation_id).get("outbound_depth") == 0 or None,
        timeout=40, interval=2, msg="the queue drains",
    )


@pytest.mark.enterprise
def test_a_timed_mute_that_ends_without_a_write_is_re_rendered_within_a_minute(
    alerts: AlertsClient, destination: str, mock: SlackMock, client: OpenObserveClient, slack_org: str
) -> None:
    alert_id, payload = create(alerts, "single", destination)
    post = first_post(mock, payload["name"])
    ts = post["response"]["ts"]

    resp = client.post(f"alerts/{alert_id}/mute", json={"minutes": 1}, org=slack_org, prefix="api/v2/")
    assert resp.status_code == 201, resp.text
    ends_at = resp.json()["ends_at"]

    def muted() -> dict[str, Any] | None:
        edits = [u for u in updates(mock, ts) if "Muted until" in u["form"].get("attachments", "")]
        return edits[-1] if edits else None

    wait_until(muted, timeout=60, interval=2, msg="the mute re-renders the header through the outbox")
    muted_count = len(updates(mock, ts))

    def unmuted() -> dict[str, Any] | None:
        later = updates(mock, ts)[muted_count:]
        plain = [u for u in later if "Muted until" not in u["form"].get("attachments", "")]
        return plain[-1] if plain else None

    edit = wait_until(unmuted, timeout=180, interval=3,
                      msg="the mute ended by time: the 60 s sweep re-renders without a write")
    assert time.time() * 1_000_000 >= ends_at, "re-rendered only once the mute had ended"
    assert color(edit) != GREEN, "still firing, just no longer muted"
    mine = [p for p in posts(mock) if payload["name"] in p["form"].get("attachments", "")]
    assert len(mine) == 1, "no second message"
