"""Commit 11 bridge, O2 side: ``chat_stream`` under a delegated token against the o2-ai mock.

AC-10.10 (I): a Slack turn's audit record has no question text and carries ``slack_event``; a browser
request with a forged ``x-o2-slack-event`` is audited in full as Http. AC-10.14 (I, the O2 producer
half): refusals carry ``error_code``. Also: ``confirm_timeout_secs`` reaches o2-ai capped at 600, the
fork seed survives only for the bridge, the token and ``currentPage`` reach o2-ai.

The server needs ``O2_AI_ENABLED=true``, ``O2_AGENT_URL`` at ``helpers/o2ai_mock.py``, and for the
audit tests ``O2_AUDIT_PUBLISH_INTERVAL=1``. ``O2_RECORD_BRIDGE_BODIES=<file>`` writes every refusal
body seen here, which is how ENT ``slack/testdata/refusals/http_bodies.json`` is recorded.
"""
from __future__ import annotations

import json
import os
import time
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import pytest
import requests

from support.client import OpenObserveClient

from .slack_helpers import make_org, wait_until
from .test_delegated import linked, mint  # noqa: F401

pytestmark = [pytest.mark.enterprise]

QUESTION = "why is checkout slow for tenant-4471?"
SLACK_EVENT = "T0TEAM:C0CHAN:Ev0BRIDGE"


class O2aiMock:
    """Control client for ``helpers/o2ai_mock.py``."""

    def __init__(self) -> None:
        self.base_url = os.environ.get("O2AI_MOCK_URL", "http://127.0.0.1:5098").rstrip("/")

    def reachable(self) -> bool:
        try:
            return requests.get(f"{self.base_url}/_mock/health", timeout=2).ok
        except requests.RequestException:
            return False

    def reset(self) -> None:
        requests.post(f"{self.base_url}/_mock/reset", json={}, timeout=5).raise_for_status()

    def script(self, *responses: dict[str, Any]) -> None:
        requests.post(f"{self.base_url}/_mock/script", json={"responses": list(responses)},
                      timeout=5).raise_for_status()

    def turns(self) -> list[dict[str, Any]]:
        resp = requests.get(f"{self.base_url}/_mock/requests", timeout=5)
        resp.raise_for_status()
        return [r for r in resp.json()["requests"] if r["path"].endswith("/query/stream")]


@pytest.fixture
def o2ai(client: OpenObserveClient, slack_on: None) -> O2aiMock:
    m = O2aiMock()
    if not m.reachable():
        pytest.skip(f"o2-ai mock not reachable at {m.base_url}; run helpers/o2ai_mock.py")
    probe = client.post("ai/chat_stream", json={"messages": []}, org="default")
    if probe.status_code == 400 and "not enabled" in probe.text:
        pytest.skip("start the server with O2_AI_ENABLED=true and O2_AGENT_URL at the o2-ai mock")
    m.reset()
    return m


def prompt(context: dict[str, Any] | None = None, **extra: Any) -> dict[str, Any]:
    return {"messages": [{"role": "user", "content": QUESTION}],
            "context": {"currentPage": "slack", **(context or {})}, **extra}


def chat_stream(client: OpenObserveClient, org: str, body: dict[str, Any], *, token: str | None = None,
                headers: dict[str, str] | None = None) -> requests.Response:
    hdrs = dict(headers or {})
    if token is None:
        return client.post("ai/chat_stream", json=body, headers=hdrs, org=org, timeout=60)
    hdrs["Authorization"] = f"Bearer {token}"
    return requests.post(urljoin(client.base_url, f"api/{org}/ai/chat_stream"), json=body,
                         headers=hdrs, timeout=60)


def frames(resp: requests.Response) -> list[dict[str, Any]]:
    out = []
    for block in resp.text.split("\n\n"):
        for line in block.splitlines():
            if line.startswith("data: "):
                out.append(json.loads(line[len("data: "):]))
    return out


def record(name: str, resp: requests.Response) -> None:
    path = os.environ.get("O2_RECORD_BRIDGE_BODIES")
    if not path:
        return
    try:
        body: Any = resp.json()
    except ValueError:
        body = resp.text
    file = Path(path)
    doc = json.loads(file.read_text()) if file.exists() else {}
    doc[name] = {"status": resp.status_code, "body": body}
    file.write_text(json.dumps(doc, indent=1, sort_keys=True) + "\n")


def audit_records(client: OpenObserveClient, org: str, since_us: int) -> list[dict[str, Any]]:
    now = int(time.time() * 1_000_000)
    sql = f"SELECT * FROM \"audit\" WHERE http_path = '/api/{org}/ai/chat_stream'"
    body = {"query": {"sql": sql, "start_time": since_us, "end_time": now + 60_000_000, "from": 0,
                      "size": 50}}
    resp = client.post("_search?type=logs", json=body, org="_meta")
    return resp.json().get("hits", []) if resp.status_code == 200 else []


def delegated_token(linked: dict[str, Any]) -> str:  # noqa: F811
    return mint(linked["key"], sub=linked["email"], org=linked["org"], lid=linked["link"]["id"])


def test_a_slack_turn_streams_the_recorded_answer_and_reaches_o2ai_as_sent(
    client: OpenObserveClient, linked: dict[str, Any], o2ai: O2aiMock,  # noqa: F811
) -> None:
    token = delegated_token(linked)
    body = prompt({"o2_fork_seed": True}, confirm_timeout_secs=900)
    resp = chat_stream(client, linked["org"], body, token=token, headers={"x-o2-slack-event": SLACK_EVENT})
    assert resp.status_code == 200, resp.text
    complete = frames(resp)[-1]
    assert complete["type"] == "complete"
    assert complete["chart_series"]["x_unit"] == "us"
    assert complete["confidence"] == "high"
    assert complete["searched_range"]["start_us"] < complete["searched_range"]["end_us"]

    sent = o2ai.turns()[-1]
    assert sent["headers"]["authorization"] == f"Bearer {token}"
    assert sent["body"]["query"] == QUESTION
    assert sent["body"]["confirm_timeout_secs"] == 600
    assert sent["body"]["context"]["currentPage"] == "slack"
    assert sent["body"]["context"]["org_id"] == linked["org"]
    assert sent["body"]["context"]["o2_fork_seed"] is True


def test_a_browser_fork_seed_is_stripped_and_a_short_timeout_kept(
    client: OpenObserveClient, o2ai: O2aiMock,
) -> None:
    resp = chat_stream(client, "default", prompt({"o2_fork_seed": True}, confirm_timeout_secs=45))
    assert resp.status_code == 200, resp.text
    sent = o2ai.turns()[-1]
    assert "o2_fork_seed" not in sent["body"]["context"]
    assert sent["body"]["confirm_timeout_secs"] == 45


def test_slack_audit_hides_the_question_and_a_forged_header_changes_nothing(
    client: OpenObserveClient, linked: dict[str, Any], o2ai: O2aiMock,  # noqa: F811
) -> None:
    since = int(time.time() * 1_000_000) - 5_000_000
    token = delegated_token(linked)
    slack = chat_stream(client, linked["org"], prompt(), token=token, headers={"x-o2-slack-event": SLACK_EVENT})
    assert slack.status_code == 200, slack.text
    forged = chat_stream(client, linked["org"], prompt(), headers={"x-o2-slack-event": "T0X:C0X:EvFORGED"})
    assert forged.status_code == 200, forged.text

    records = wait_until(
        lambda: (r := audit_records(client, linked["org"], since)) and len(r) >= 2 and r,
        "both chat_stream audit records in the _meta audit stream (O2_AUDIT_PUBLISH_INTERVAL=1)",
        timeout=40,
    )
    by_user = {r["user_email"]: r for r in records}
    slack_rec = by_user[linked["email"]]
    assert slack_rec["protocol"] == "Slack"
    assert QUESTION not in slack_rec["http_body"]
    slack_body = json.loads(slack_rec["http_body"])
    assert slack_body["messages"] == "[REDACTED: slack]"
    assert slack_body["slack_event"] == SLACK_EVENT

    browser_rec = by_user[client.email]
    assert browser_rec["protocol"] == "Http"
    browser_body = json.loads(browser_rec["http_body"])
    assert browser_body["messages"][0]["content"] == QUESTION
    assert "slack_event" not in browser_body


@pytest.mark.parametrize(
    ("script", "status", "code"),
    [
        ({"error": "session_not_found"}, 404, "session_not_found"),
        ({"error": "turn_in_progress"}, 409, "turn_in_progress"),
        ({"error": "session_owner_unavailable"}, 409, "session_owner_unavailable"),
    ],
)
def test_o2ai_refusals_carry_error_code(
    client: OpenObserveClient, linked: dict[str, Any], o2ai: O2aiMock,  # noqa: F811
    script: dict[str, Any], status: int, code: str,
) -> None:
    o2ai.script(script)
    session = str(uuid.uuid4())
    resp = chat_stream(client, linked["org"], prompt(), token=delegated_token(linked),
                       headers={"x-o2-assistant-session-id": session})
    record(f"a_{code}", resp)
    assert resp.status_code == status, resp.text
    assert resp.json()["error_code"] == code


def test_an_upstream_429_and_an_unreachable_agent_still_name_error_code(
    client: OpenObserveClient, linked: dict[str, Any], o2ai: O2aiMock,  # noqa: F811
) -> None:
    o2ai.script({"status": 429, "body": {"detail": "rate limited"}})
    resp = chat_stream(client, linked["org"], prompt(), token=delegated_token(linked))
    record("a_rate_limited", resp)
    assert resp.status_code == 429, resp.text
    assert "error_code" in resp.json()


def test_an_in_band_restore_required_frame_passes_through(
    client: OpenObserveClient, linked: dict[str, Any], o2ai: O2aiMock,  # noqa: F811
) -> None:
    o2ai.script({"in_band": "restore_required"})
    resp = chat_stream(client, linked["org"], prompt(), token=delegated_token(linked))
    assert resp.status_code == 200, resp.text
    errors = [f for f in frames(resp) if f.get("type") == "error"]
    assert [e["code"] for e in errors] == ["restore_required"]


def test_validator_refusals_are_recorded_for_the_bridge(
    client: OpenObserveClient, linked: dict[str, Any], o2ai: O2aiMock,  # noqa: F811
) -> None:
    token = delegated_token(linked)
    forged = token[:-4] + ("AAAA" if not token.endswith("AAAA") else "BBBB")
    resp = chat_stream(client, linked["org"], prompt(), token=forged)
    record("b_validator_401", resp)
    assert resp.status_code == 401, resp.text

    other = make_org(client)
    resp = chat_stream(client, other, prompt(), token=token)
    record("b_validator_403", resp)
    assert resp.status_code == 403, resp.text
    assert [t for t in o2ai.turns() if (t["body"] or {}).get("query") == QUESTION] == [], \
        "neither refused call reached o2-ai (the fixture's own mention may still be answered)"


def test_cli_approval_after_demotion(
    client: OpenObserveClient, slack_org: str, slack_on: None, self_hosted: None, mock: Any,
    o2ai: O2aiMock,
) -> None:
    """AC-4.6 (I), OpenFGA on (ai_toolsets PUT) or off (org Admin): a demoted asker's CLI approval is refused in 30 s."""
    from .slack_helpers import http_install, make_user, new_team, slack_user
    from .test_bridge_slack import CHANNEL, answers_in, event, send, uniq
    from .test_interactions import approval_post, click, element, ephemerals, o2ai_requests

    email = f"lee_{uniq()}@acme.test"
    make_user(client, slack_org, "admin", email=email)
    team = new_team(mock, slack_user("U0LEE", "", email))
    inst = http_install(client, slack_org, team)
    put = client.put(f"slack/installations/{inst['id']}/linking", json={"enabled": True, "domains": ["acme.test"]},
                     org=slack_org)
    assert put.status_code == 200, put.text
    tag = uniq()
    o2ai.script({"confirm": "cli", "wait_secs": 90, "match": tag})
    body, ts, _ = event(inst, team, "U0LEE", f"<@U0BOT> restart checkout {tag}")
    send(client, inst, body)
    post = approval_post(mock, ts)
    approve = element(json.loads(post["form"]["blocks"]), "o2_approve")
    session = [t for t in o2ai.turns() if tag in (t["body"] or {}).get("query", "")][0]["headers"][
        "x-o2-assistant-session-id"]
    confirms = lambda: [r for r in o2ai_requests(o2ai, "/confirm") if r["path"].endswith(session)]  # noqa: E731

    demoted = client.put(f"users/{email}", json={"role": "viewer"}, org=slack_org)
    assert demoted.status_code == 200, demoted.text
    demoted_at = time.time()
    click(client, inst, team, "U0LEE", channel=CHANNEL, message_ts=post["response"]["ts"], thread_ts=ts,
          action=approve)
    wait_until(lambda: [e for e in ephemerals(mock, "U0LEE") if "AI toolsets access" in e.get("text", "")],
               "the refusal after demotion", timeout=30)
    assert time.time() - demoted_at < 30
    assert confirms() == [], "the Viewer's approval never reached o2-ai"

    promoted = client.put(f"users/{email}", json={"role": "admin"}, org=slack_org)
    assert promoted.status_code == 200, promoted.text
    click(client, inst, team, "U0LEE", channel=CHANNEL, message_ts=post["response"]["ts"], thread_ts=ts,
          action=approve)
    wait_until(confirms, "the Admin's approval at o2-ai", timeout=30)
    wait_until(lambda: answers_in(mock, ts), "the turn to finish after the approval", timeout=30)
