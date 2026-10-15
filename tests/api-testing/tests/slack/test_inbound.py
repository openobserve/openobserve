"""AC-8.2, 8.1, 8.3 and 8.5: Slack's inbound requests on ``/api/slack/*`` (spec sections 7.1, 9.1).

Runs against the flag-on server. Requests carry no O2 auth, only Slack's signature over
``v0:{ts}:{body}`` with the installation's signing secret (the mock's ``signing-{app_id}``).
"""
from __future__ import annotations

import hashlib
import hmac
import json
import time
import uuid
from collections.abc import Iterator
from typing import Any
from urllib.parse import urlencode, urljoin

import pytest
import requests

from support.client import OpenObserveClient

from .slack_helpers import MOCK_TEAM, SlackMock, self_hosted_install

pytestmark = [pytest.mark.enterprise]

MAX_BODY = 1_048_576


@pytest.fixture
def ready(slack_on: None, self_hosted: None, mock: SlackMock) -> SlackMock:
    return mock


def sign(secret: str, ts: str, body: bytes) -> str:
    return "v0=" + hmac.new(secret.encode(), b"v0:" + ts.encode() + b":" + body, hashlib.sha256).hexdigest()


def slack_post(
    client: OpenObserveClient,
    kind: str,
    body: bytes,
    secret: str,
    *,
    ts: int | None = None,
    content_type: str = "application/json",
    signature: str | None = None,
) -> requests.Response:
    """POST as Slack does: no O2 credentials, only the signature headers."""
    stamp = str(int(time.time()) if ts is None else ts)
    headers = {
        "Content-Type": content_type,
        "X-Slack-Request-Timestamp": stamp,
        "X-Slack-Signature": signature if signature is not None else sign(secret, stamp, body),
    }
    return requests.post(urljoin(client.base_url, f"api/slack/{kind}"), data=body, headers=headers, timeout=15)


def installation(client: OpenObserveClient, org: str, installation_id: str) -> dict[str, Any]:
    resp = client.get("slack/installations", org=org)
    assert resp.status_code == 200, resp.text
    return next(i for i in resp.json()["installations"] if i["id"] == installation_id)


def remove(client: OpenObserveClient, org: str, installation_id: str) -> None:
    resp = client.delete(f"slack/installations/{installation_id}", org=org)
    assert resp.status_code in (200, 404), resp.text


@pytest.fixture
def pending_http(client: OpenObserveClient, slack_org: str, ready: SlackMock) -> Iterator[dict[str, Any]]:
    """An HTTP-mode app created from a configuration token, not yet allowed in Slack."""
    resp = client.post(
        "slack/installations",
        json={"mode": "http", "config_refresh_token": f"xoxe-1-{uuid.uuid4().hex[:8]}", "app_name": "O2 inbound"},
        org=slack_org,
    )
    assert resp.status_code == 201, resp.text
    inst = resp.json()["installation"]
    assert inst["status"] == "pending"
    yield inst
    remove(client, slack_org, inst["id"])


@pytest.fixture
def installed_http(client: OpenObserveClient, slack_org: str, ready: SlackMock) -> Iterator[dict[str, Any]]:
    """An allowed HTTP-mode installation in the mock's team."""
    exchanged = self_hosted_install(client, slack_org, mode="http")
    inst = installation(client, slack_org, exchanged["installation"]["id"])
    yield inst
    remove(client, slack_org, inst["id"])


def mention(app_id: str, event_id: str, *, thread_ts: str | None = None) -> bytes:
    """An ``app_mention`` event_callback in the shape Slack sends (ids anonymized); the user is a mock member, as commit 10 reads ``users.info``."""
    event: dict[str, Any] = {
        "type": "app_mention", "user": "U0DANA", "text": "<@U0BOT> errors in checkout?",
        "ts": f"{time.time():.6f}", "team": MOCK_TEAM, "user_team": MOCK_TEAM,
        "channel": "C0OPS", "event_ts": f"{time.time():.6f}",
    }
    if thread_ts:
        event["thread_ts"] = thread_ts
    body = {
        "token": "ignored", "team_id": MOCK_TEAM, "api_app_id": app_id, "event": event,
        "type": "event_callback", "event_id": event_id, "event_time": int(time.time()),
        "authorizations": [{"enterprise_id": None, "team_id": MOCK_TEAM, "user_id": "U0BOT",
                            "is_bot": True, "is_enterprise_install": False}],
        "is_ext_shared_channel": False,
    }
    return json.dumps(body).encode()


def inbound_count(client: OpenObserveClient, event_type: str, result: str) -> float:
    text = requests.get(urljoin(client.base_url, "metrics"), timeout=15).text
    total = 0.0
    for line in text.splitlines():
        if line.startswith("zo_slack_inbound_events_total{") and f'type="{event_type}"' in line \
                and f'result="{result}"' in line:
            total += float(line.rsplit(" ", 1)[1])
    return total


def wait_for(predicate, what: str, timeout: float = 15.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return
        time.sleep(0.25)
    raise AssertionError(f"timed out waiting for {what}")


def test_url_verification_with_a_pending_http_installations_secret(
    client: OpenObserveClient, pending_http: dict[str, Any]
) -> None:
    body = json.dumps({"token": "Jhj5dZrVaK7ZwHHjRyZWjbDl", "challenge": "c-" + uuid.uuid4().hex,
                       "type": "url_verification"}).encode()
    resp = slack_post(client, "events", body, f"signing-{pending_http['app_id']}")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"challenge": json.loads(body)["challenge"]}


def test_url_verification_with_an_unknown_secret_is_401(client: OpenObserveClient, pending_http: dict[str, Any]) -> None:
    body = json.dumps({"token": "t", "challenge": "c", "type": "url_verification"}).encode()
    resp = slack_post(client, "events", body, "signing-someone-else")
    assert resp.status_code == 401, resp.text
    assert resp.json()["code"] == 401


def test_a_bad_signature_is_401(client: OpenObserveClient, installed_http: dict[str, Any]) -> None:
    secret = f"signing-{installed_http['app_id']}"
    body = mention(installed_http["app_id"], "Ev" + uuid.uuid4().hex[:10])
    ts = str(int(time.time()))
    tampered = body.replace(b"errors in checkout", b"drop every table")
    assert slack_post(client, "events", tampered, secret, ts=int(ts), signature=sign(secret, ts, body)).status_code == 401
    assert slack_post(client, "events", body, "signing-wrong").status_code == 401
    assert slack_post(client, "events", body, secret, signature="").status_code == 401


@pytest.mark.parametrize("skew", [-360, 360])
def test_a_timestamp_six_minutes_off_is_401(client: OpenObserveClient, installed_http: dict[str, Any], skew: int) -> None:
    body = mention(installed_http["app_id"], "Ev" + uuid.uuid4().hex[:10])
    resp = slack_post(client, "events", body, f"signing-{installed_http['app_id']}", ts=int(time.time()) + skew)
    assert resp.status_code == 401, resp.text


def test_over_1_mib_is_413(client: OpenObserveClient, installed_http: dict[str, Any]) -> None:
    body = b" " * (MAX_BODY + 1)
    resp = slack_post(client, "events", body, f"signing-{installed_http['app_id']}")
    assert resp.status_code == 413, resp.text


def test_an_unknown_app_is_404(client: OpenObserveClient, installed_http: dict[str, Any]) -> None:
    body = mention("A0NOSUCHAPP", "Ev" + uuid.uuid4().hex[:10])
    resp = slack_post(client, "events", body, f"signing-{installed_http['app_id']}")
    assert resp.status_code == 404, resp.text


def test_the_same_event_id_three_times_is_one_message(client: OpenObserveClient, installed_http: dict[str, Any]) -> None:
    secret = f"signing-{installed_http['app_id']}"
    body = mention(installed_http["app_id"], "Ev" + uuid.uuid4().hex[:10])
    dispatched = inbound_count(client, "app_mention", "dispatched")
    duplicates = inbound_count(client, "app_mention", "duplicate")
    for attempt in range(3):
        resp = slack_post(client, "events", body, secret)
        assert resp.status_code == 200, f"attempt {attempt}: {resp.text}"
        assert resp.json() == {}
    wait_for(lambda: inbound_count(client, "app_mention", "dispatched") == dispatched + 1, "one dispatch")
    # NATS drops the copies at publish (duplicate window); the memory queue leaves them to the consumer.
    time.sleep(1)
    assert inbound_count(client, "app_mention", "dispatched") == dispatched + 1
    assert inbound_count(client, "app_mention", "duplicate") - duplicates in (0, 2)


def test_a_command_and_a_click_are_acked_as_slack_expects(client: OpenObserveClient, installed_http: dict[str, Any]) -> None:
    secret = f"signing-{installed_http['app_id']}"
    command = urlencode({
        "token": "t", "team_id": MOCK_TEAM, "team_domain": "mock", "channel_id": "C0OPS", "channel_name": "ops",
        "user_id": "U0ALICE", "user_name": "alice", "command": "/o2", "text": "help",
        "api_app_id": installed_http["app_id"], "is_enterprise_install": "false",
        "response_url": "https://hooks.slack.com/commands/T0MOCK/1/x", "trigger_id": uuid.uuid4().hex,
    }).encode()
    resp = slack_post(client, "commands", command, secret, content_type="application/x-www-form-urlencoded")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"response_type": "ephemeral", "text": "Working on it…"}
    click = {
        "type": "block_actions", "user": {"id": "U0ALICE", "username": "alice", "team_id": MOCK_TEAM},
        "api_app_id": installed_http["app_id"], "trigger_id": uuid.uuid4().hex,
        "team": {"id": MOCK_TEAM, "domain": "mock"}, "enterprise": None, "is_enterprise_install": False,
        "channel": {"id": "C0OPS", "name": "ops"}, "actions": [{"action_id": "noop", "type": "button"}],
    }
    form = urlencode({"payload": json.dumps(click)}).encode()
    resp = slack_post(client, "interactions", form, secret, content_type="application/x-www-form-urlencoded")
    assert resp.status_code == 200, resp.text
    assert resp.content == b""


@pytest.mark.skip(reason="needs commit 11 bridge: the turn runner and the o2-ai mock record the answer order")
def test_parallel_threads(client: OpenObserveClient, installed_http: dict[str, Any]) -> None:
    """AC-8.5: one thread runs in order with no 409, two threads in parallel (asserted on the o2-ai mock's log)."""
    secret = f"signing-{installed_http['app_id']}"
    thread = f"{time.time():.6f}"
    for event_id, ts in [("EvA1", thread), ("EvA2", thread), ("EvB1", f"{time.time() + 1:.6f}")]:
        body = mention(installed_http["app_id"], event_id + uuid.uuid4().hex[:6], thread_ts=ts)
        assert slack_post(client, "events", body, secret).status_code == 200
