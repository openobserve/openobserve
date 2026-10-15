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

from .slack_helpers import MOCK_TEAM, SlackMock, mention, self_hosted_install, wait_until
from .test_bridge import O2aiMock, o2ai  # noqa: F401
from .test_bridge_slack import answers_in, ask, event, send, setup_team, turns_for

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
    retry: int | None = None,
) -> requests.Response:
    """POST as Slack does: no O2 credentials, only the signature headers (and Slack's retry headers)."""
    stamp = str(int(time.time()) if ts is None else ts)
    headers = {
        "Content-Type": content_type,
        "X-Slack-Request-Timestamp": stamp,
        "X-Slack-Signature": signature if signature is not None else sign(secret, stamp, body),
    }
    if retry is not None:
        headers |= {"X-Slack-Retry-Num": str(retry), "X-Slack-Retry-Reason": "http_timeout"}
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
    body = mention(installed_http, MOCK_TEAM, "U0DANA")
    ts = str(int(time.time()))
    tampered = body.replace(b"errors in checkout", b"drop every table")
    assert slack_post(client, "events", tampered, secret, ts=int(ts), signature=sign(secret, ts, body)).status_code == 401
    assert slack_post(client, "events", body, "signing-wrong").status_code == 401
    assert slack_post(client, "events", body, secret, signature="").status_code == 401


@pytest.mark.parametrize("skew", [-360, 360])
def test_a_timestamp_six_minutes_off_is_401(client: OpenObserveClient, installed_http: dict[str, Any], skew: int) -> None:
    body = mention(installed_http, MOCK_TEAM, "U0DANA")
    resp = slack_post(client, "events", body, f"signing-{installed_http['app_id']}", ts=int(time.time()) + skew)
    assert resp.status_code == 401, resp.text


def test_over_1_mib_is_413(client: OpenObserveClient, installed_http: dict[str, Any]) -> None:
    body = b" " * (MAX_BODY + 1)
    resp = slack_post(client, "events", body, f"signing-{installed_http['app_id']}")
    assert resp.status_code == 413, resp.text


def test_an_unknown_app_is_404(client: OpenObserveClient, installed_http: dict[str, Any]) -> None:
    body = mention({"app_id": "A0NOSUCHAPP"}, MOCK_TEAM, "U0DANA")
    resp = slack_post(client, "events", body, f"signing-{installed_http['app_id']}")
    assert resp.status_code == 404, resp.text


def test_the_same_event_id_three_times_is_one_answer(
    client: OpenObserveClient, slack_org: str, ready: SlackMock, o2ai: O2aiMock,  # noqa: F811
) -> None:
    """AC-8.2: Slack's delivery and two retries (``X-Slack-Retry-Num`` 1, 2) of one event id are one turn and one answer."""
    team, inst, _ = setup_team(client, slack_org, ready, "U0DUP")
    tag = uuid.uuid4().hex[:8]
    body, ts, _ = event(inst, team, "U0DUP", f"<@U0BOT> errors in checkout? {tag}")
    for retry in (None, 1, 2):
        resp = slack_post(client, "events", body, f"signing-{inst['app_id']}", retry=retry)
        assert resp.status_code == 200, f"retry {retry}: {resp.text}"
        assert resp.json() == {}
    wait_until(lambda: answers_in(ready, ts), "the answer to the event")
    # Copies of one thread are settled in order, so once a later question there is answered none is left.
    ask(client, inst, team, ready, "U0DUP", f"and in payments? {tag}", thread_ts=ts, kind="message")
    queries = [t["body"]["query"] for t in turns_for(o2ai, tag)]
    assert queries == [f"errors in checkout? {tag}", f"and in payments? {tag}"], queries
    assert len(answers_in(ready, ts)) == 2


def test_a_command_and_a_click_are_acked_as_slack_expects(
    client: OpenObserveClient, installed_http: dict[str, Any], ready: SlackMock,
) -> None:
    secret = f"signing-{installed_http['app_id']}"
    user = f"U0HLP{uuid.uuid4().hex[:6].upper()}"
    command = urlencode({
        "token": "t", "team_id": MOCK_TEAM, "team_domain": "mock", "channel_id": "C0OPS", "channel_name": "ops",
        "user_id": user, "user_name": "alice", "command": "/o2", "text": "help",
        "api_app_id": installed_http["app_id"], "is_enterprise_install": "false",
        "response_url": "https://hooks.slack.com/commands/T0MOCK/1/x", "trigger_id": uuid.uuid4().hex,
    }).encode()
    resp = slack_post(client, "commands", command, secret, content_type="application/x-www-form-urlencoded")
    assert resp.status_code == 200, resp.text
    assert resp.content == b"", "LIVE-RESULTS B-LIVE-13: Slack shows any ack text beside the real reply"
    wait_until(lambda: [c for c in ready.calls("chat.postEphemeral")
                        if c["form"].get("user") == user and "/o2 ask" in c["form"].get("text", "")],
               "the /o2 help reply, posted apart from the ack")
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


def test_parallel_threads(client: OpenObserveClient, slack_org: str, ready: SlackMock, o2ai: O2aiMock) -> None:  # noqa: F811
    """AC-8.5: one thread runs in order with no 409, two threads in parallel (asserted on the o2-ai mock's log)."""
    team, inst, _ = setup_team(client, slack_org, ready, "U0PAT")
    tag = uuid.uuid4().hex[:8]
    ask(client, inst, team, ready, "U0PAT", "<@U0BOT> warm up")
    o2ai.script(*[{"turn": "chart", "hold_secs": 3, "match": tag}] * 3)
    thread_a, thread_b = f"{time.time():.6f}", f"{time.time() + 1:.6f}"
    a1, _, _ = event(inst, team, "U0PAT", f"<@U0BOT> first in A {tag}", ts=thread_a)
    a2, _, _ = event(inst, team, "U0PAT", f"<@U0BOT> second in A {tag}", thread_ts=thread_a)
    b1, _, _ = event(inst, team, "U0PAT", f"<@U0BOT> first in B {tag}", ts=thread_b)
    for body in (a1, a2, b1):
        send(client, inst, body)
    wait_until(lambda: len(answers_in(ready, thread_a)) >= 2 and answers_in(ready, thread_b), "three answers",
               timeout=40)
    turns = turns_for(o2ai, tag)
    assert len(turns) == 3, "no turn was refused or retried"
    by_query = {t["body"]["query"]: t for t in turns}
    first_a, second_a, first_b = (by_query[f"{q} {tag}"] for q in ("first in A", "second in A", "first in B"))
    session = "x-o2-assistant-session-id"
    assert first_a["headers"][session] == second_a["headers"][session]
    assert first_b["headers"][session] != first_a["headers"][session]
    earlier_a, later_a = sorted((first_a, second_a), key=lambda t: t["at"])
    assert later_a["at"] >= earlier_a["last_frame_at"], "a thread's next question starts after its last one ended"
    assert first_b["at"] < earlier_a["last_frame_at"], "thread B starts while thread A's first question is open"
    assert earlier_a["at"] < first_b["last_frame_at"], "thread A's first question starts while thread B's is open"
