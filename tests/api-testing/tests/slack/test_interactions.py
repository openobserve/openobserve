"""Commit 11 part 3, end to end: clicks and ``/o2`` commands reach the bridge and o2-ai.

AC-10.9 (I): a thumbs-down reason reaches o2-ai's feedback ``comment``. AC-10.8 (I): Approve calls
``/confirm`` once and the message reads Approved. AC-10.2 (I): Re-ask in answers again in the thread
in the picked org; in a channel it is offered by "Re-ask in another org", which lists the clicker's
own orgs privately. AC-10.16 (I): ``/o2 ask`` in a channel answers by DM. AC-5.6 (I, OpenFGA off):
approving an org CLI tool needs org Admin; a delete approval only the asker.

Needs the flag-on self-hosted server with ``O2_AI_ENABLED=true`` and ``O2_AGENT_URL`` at
``helpers/o2ai_mock.py`` (``run/p11/start.sh``).
"""
from __future__ import annotations

import json
import time
import uuid
from typing import Any
from urllib.parse import urlencode

import pytest
import requests

from support.client import OpenObserveClient

from .slack_helpers import (
    SlackMock,
    add_to_org,
    connect_with_proof,
    make_slack_org,
    signed_post,
    wait_until,
)
from .test_bridge import O2aiMock, o2ai  # noqa: F401
from .test_bridge_slack import CHANNEL, answers_in, event, send, setup_team, turns_for, uniq

pytestmark = [pytest.mark.enterprise]


@pytest.fixture
def ready(slack_on: None, self_hosted: None, mock: SlackMock) -> SlackMock:
    return mock


def o2ai_requests(o2ai: O2aiMock, suffix: str) -> list[dict[str, Any]]:  # noqa: F811
    resp = requests.get(f"{o2ai.base_url}/_mock/requests", timeout=5)
    resp.raise_for_status()
    return [r for r in resp.json()["requests"] if r["path"].split("?", 1)[0].endswith(suffix)
            or (suffix == "/confirm" and "/confirm/" in r["path"])]


def click(client: OpenObserveClient, inst: dict[str, Any], team: str, user: str, *, channel: str,
          message_ts: str, thread_ts: str | None, action: dict[str, Any], ephemeral: bool = False) -> None:
    """A ``block_actions`` payload as Slack posts it (form ``payload=``), signed."""
    container: dict[str, Any] = {"type": "message", "message_ts": message_ts, "channel_id": channel,
                                 "is_ephemeral": ephemeral}
    message: dict[str, Any] = {"type": "message", "ts": message_ts, "user": "U0BOT", "bot_id": "B0BOT"}
    if thread_ts:
        container["thread_ts"] = thread_ts
        message["thread_ts"] = thread_ts
    payload = {
        "type": "block_actions", "user": {"id": user, "username": user[2:].lower(), "team_id": team},
        "api_app_id": inst["app_id"], "token": "ignored", "container": container,
        "trigger_id": f"{int(time.time())}.1.{uuid.uuid4().hex[:12]}", "team": {"id": team, "domain": "acme"},
        "enterprise": None, "is_enterprise_install": False, "channel": {"id": channel, "name": "ops"},
        "message": message, "response_url": "https://hooks.slack.com/actions/T0/1/x",
        "actions": [{**action, "action_ts": f"{time.time():.6f}"}],
    }
    body = urlencode({"payload": json.dumps(payload)}).encode()
    resp = signed_post(client, "interactions", body, f"signing-{inst['app_id']}",
                       content_type="application/x-www-form-urlencoded")
    assert resp.status_code == 200, resp.text


def element(blocks: list[dict[str, Any]], action_id: str) -> dict[str, Any]:
    for b in blocks:
        for e in [*b.get("elements", []), *([b["accessory"]] if "accessory" in b else [])]:
            if e.get("action_id") == action_id:
                return e
    raise AssertionError(f"no {action_id} in {blocks}")


def approval_post(mock: SlackMock, thread_ts: str) -> dict[str, Any]:
    """The approval message of this test's question: other tests' turns may still post in the background."""
    def found() -> list[dict[str, Any]]:
        return [c for c in mock.calls("chat.postMessage") if "o2_approve" in c["form"].get("blocks", "")
                and c["form"].get("thread_ts") == thread_ts]
    return wait_until(found, "the approval message", timeout=30)[0]


def ephemerals(mock: SlackMock, user: str) -> list[dict[str, str]]:
    return [c["form"] for c in mock.calls("chat.postEphemeral") if c["form"].get("user") == user]


def test_thumbs_down_reason_reaches_o2ais_feedback_comment(
    client: OpenObserveClient, slack_org: str, ready: SlackMock, o2ai: O2aiMock,  # noqa: F811
) -> None:
    team, inst, _ = setup_team(client, slack_org, ready, "U0ANN")
    tag = uniq()
    body, ts, _ = event(inst, team, "U0ANN", f"<@U0BOT> how many queries per minute? {tag}")
    send(client, inst, body)
    answer = wait_until(lambda: answers_in(ready, ts), "the answer", timeout=30)[-1]
    session = turns_for(o2ai, tag)[0]["headers"]["x-o2-assistant-session-id"]
    down = element(json.loads(answer["blocks"]), "o2_feedback_down")
    click(client, inst, team, "U0ANN", channel=CHANNEL, message_ts=answer["ts"], thread_ts=ts, action=down)
    follow_up = wait_until(lambda: [e for e in ephemerals(ready, "U0ANN") if "o2_feedback" in e.get("blocks", "")],
                           "the reasons follow-up")[-1]
    reason = next(e for e in json.loads(follow_up["blocks"])[1]["elements"] if e["text"]["text"] == "Wrong time range")
    assert o2ai_requests(o2ai, "/feedback") == [], "nothing is recorded before a reason"
    click(client, inst, team, "U0ANN", channel=CHANNEL, message_ts=answer["ts"], thread_ts=ts, action=reason)

    sent = wait_until(lambda: o2ai_requests(o2ai, "/feedback"), "the feedback at o2-ai")
    assert len(sent) == 1
    assert sent[0]["body"]["comment"] == "Wrong time range"
    assert sent[0]["body"]["feedback_type"] == "thumbs_down"
    assert sent[0]["body"]["trace_id"] == "trace-1"
    assert sent[0]["headers"]["x-o2-assistant-session-id"] == session
    thanks = wait_until(lambda: [e for e in ephemerals(ready, "U0ANN") if "Thanks, noted" in e.get("text", "")],
                        "the thanks note")
    assert "o2_retry" in thanks[-1]["blocks"], "Try again offered"


def card_edits(mock: SlackMock, message_ts: str, words: str) -> list[dict[str, str]]:
    return [c["form"] for c in mock.calls("chat.update")
            if c["form"].get("ts") == message_ts and words in c["form"].get("blocks", "")]


def card_head(form: dict[str, str]) -> str:
    return json.loads(form["blocks"])[0]["text"]["text"]


def test_approve_runs_confirm_once_and_the_card_says_what_was_deleted(
    client: OpenObserveClient, slack_org: str, ready: SlackMock, o2ai: O2aiMock,  # noqa: F811
) -> None:
    team, inst, _ = setup_team(client, slack_org, ready, "U0ANN")
    tag = uniq()
    o2ai.script({"confirm": "o2_delete", "wait_secs": 30, "match": tag})
    body, ts, _ = event(inst, team, "U0ANN", f"<@U0BOT> delete the checkout dashboard {tag}")
    send(client, inst, body)
    post = approval_post(ready, ts)
    approve = element(json.loads(post["form"]["blocks"]), "o2_approve")
    message_ts = post["response"]["ts"]
    click(client, inst, team, "U0BOB", channel=CHANNEL, message_ts=message_ts, thread_ts=ts, action=approve)
    wait_until(lambda: [e for e in ephemerals(ready, "U0BOB") if "Only the person who asked" in e.get("text", "")],
               "the refusal to a colleague")
    assert o2ai_requests(o2ai, "/confirm") == []

    click(client, inst, team, "U0ANN", channel=CHANNEL, message_ts=message_ts, thread_ts=ts, action=approve)
    confirms = wait_until(lambda: o2ai_requests(o2ai, "/confirm"), "the confirm at o2-ai")
    session = turns_for(o2ai, tag)[0]["headers"]["x-o2-assistant-session-id"]
    assert confirms[0]["path"].endswith(f"/confirm/{session}")
    assert confirms[0]["body"]["approved"] is True
    edited = wait_until(lambda: card_edits(ready, message_ts, "Approved by"), "the Approved edit")
    head = card_head(edited[-1])
    assert head.startswith("✓ Approved by <@U0ANN>"), head
    assert head.endswith(' · Deleted dashboard "Checkout"'), "never a bare Approved: " + head
    wait_until(lambda: [a for a in answers_in(ready, ts) if "Hello! How" in a["blocks"]],
               "the turn's answer after the approval")

    click(client, inst, team, "U0ANN", channel=CHANNEL, message_ts=message_ts, thread_ts=ts, action=approve)
    wait_until(lambda: [e for e in ephemerals(ready, "U0ANN") if "already answered" in e.get("text", "")],
               "the second click's note")
    assert len(o2ai_requests(o2ai, "/confirm")) == 1, "confirm runs once"


def test_a_delete_o2_refuses_after_the_approval_says_so_on_the_card(
    client: OpenObserveClient, slack_org: str, ready: SlackMock, o2ai: O2aiMock,  # noqa: F811
) -> None:
    team, inst, _ = setup_team(client, slack_org, ready, "U0ANN")
    tag = uniq()
    o2ai.script({"confirm": "o2_delete", "delete_status": 403, "match": tag})
    body, ts, _ = event(inst, team, "U0ANN", f"<@U0BOT> delete the checkout dashboard {tag}")
    send(client, inst, body)
    post = approval_post(ready, ts)
    wait_until(lambda: answers_in(ready, ts), "the turn's answer: o2-ai answers deletes after the turn")
    approve = element(json.loads(post["form"]["blocks"]), "o2_approve")
    message_ts = post["response"]["ts"]
    assert card_edits(ready, message_ts, "") == [], "a delete stays answerable after its turn"
    click(client, inst, team, "U0ANN", channel=CHANNEL, message_ts=message_ts, thread_ts=ts, action=approve)
    edited = wait_until(lambda: card_edits(ready, message_ts, "Approved by"), "the outcome on the card")
    head = card_head(edited[-1])
    assert head.startswith("⚠️ Approved by <@U0ANN>"), head
    assert head.endswith(', but it did not succeed · dashboard "Checkout" not deleted '
                         "(OpenObserve refused: 403 Unauthorized Access)"), head


def test_org_cli_approval_needs_admin_when_openfga_is_off(
    client: OpenObserveClient, slack_org: str, ready: SlackMock, o2ai: O2aiMock,  # noqa: F811
) -> None:
    if client.get("config", org=slack_org).json().get("rbac_enabled"):
        pytest.skip("OpenFGA decides with ai_toolsets PUT, which an editor role holds; see test_cli_approval_after_demotion")
    team, inst, _ = setup_team(client, slack_org, ready, "U0ANN")
    tag = uniq()
    o2ai.script({"confirm": "cli", "wait_secs": 5, "match": tag})
    body, ts, _ = event(inst, team, "U0ANN", f"<@U0BOT> restart checkout {tag}")
    send(client, inst, body)
    post = approval_post(ready, ts)
    assert "kubectl-prod" in post["form"]["blocks"]
    approve = element(json.loads(post["form"]["blocks"]), "o2_approve")
    click(client, inst, team, "U0ANN", channel=CHANNEL, message_ts=post["response"]["ts"], thread_ts=ts,
          action=approve)
    note = wait_until(lambda: [e for e in ephemerals(ready, "U0ANN") if "AI toolsets access" in e.get("text", "")],
                      "the toolsets refusal to an editor")
    assert slack_org in note[-1]["text"]
    assert o2ai_requests(o2ai, "/confirm") == []
    wait_until(lambda: answers_in(ready, ts), "the turn to end once the approval timed out", timeout=30)
    ended = wait_until(lambda: card_edits(ready, post["response"]["ts"], "before it was approved"),
                       "the card closed with its turn")
    assert "o2_approve" not in ended[-1]["blocks"]


def test_reask_in_answers_again_in_the_thread_in_the_picked_org(
    client: OpenObserveClient, slack_org: str, ready: SlackMock, o2ai: O2aiMock,  # noqa: F811
) -> None:
    other = make_slack_org(client)
    team, inst, o2 = setup_team(client, slack_org, ready, "U0ANN")
    connected = connect_with_proof(client, other, inst["id"], team_id=team)
    assert connected.status_code == 200, connected.text
    add_to_org(client, other, o2["U0ANN"].email, "editor")
    tag = uniq()
    body, ts, _ = event(inst, team, "U0ANN", f"<@U0BOT> how many queries per minute? {tag}")
    send(client, inst, body)
    answer = wait_until(lambda: answers_in(ready, ts), "the first answer", timeout=30)[-1]
    assert other not in answer["blocks"], "a channel answer never lists the asker's orgs"
    menu = element(json.loads(answer["blocks"]), "o2_reask_menu")
    click(client, inst, team, "U0ANN", channel=CHANNEL, message_ts=answer["ts"], thread_ts=ts, action=menu)
    listed = wait_until(lambda: [e for e in ephemerals(ready, "U0ANN") if "o2_reask_in" in e.get("blocks", "")],
                        "the private list of the clicker's orgs")[-1]
    select = element(json.loads(listed["blocks"]), "o2_reask_in")
    option = next(o for o in select["options"] if o["text"]["text"] == other)
    assert len(option["value"]) <= 150, "Slack caps option values at 150 characters"
    action = {"type": "static_select", "action_id": "o2_reask_in", "block_id": "o2_answer",
              "selected_option": option, "placeholder": {"type": "plain_text", "text": "Re-ask in"}}
    click(client, inst, team, "U0ANN", channel=CHANNEL, message_ts=answer["ts"], thread_ts=ts, action=action)

    turns = wait_until(lambda: turns_for(o2ai, tag)[1:], "the re-asked turn", timeout=30)
    first, again = turns_for(o2ai, tag)[0], turns[0]
    assert again["body"]["context"]["org_id"] == other
    assert again["headers"]["x-o2-assistant-session-id"] != first["headers"]["x-o2-assistant-session-id"]
    progress = wait_until(lambda: [c["form"] for c in ready.calls("chat.postMessage")
                                   if c["form"].get("channel") == CHANNEL and c["form"].get("thread_ts") == ts][1:],
                          "the new answer in the same thread")
    assert progress
    final = wait_until(lambda: [a for a in answers_in(ready, ts) if f"org {other}" in a["blocks"]],
                       "the answer in the new org")
    assert final


def test_slash_o2_ask_in_a_channel_answers_by_dm(
    client: OpenObserveClient, slack_org: str, ready: SlackMock, o2ai: O2aiMock,  # noqa: F811
) -> None:
    team, inst, _ = setup_team(client, slack_org, ready, "U0ANN")
    tag = uniq()
    form = {
        "token": "ignored", "team_id": team, "team_domain": "acme", "enterprise_id": "", "enterprise_name": "",
        "channel_id": CHANNEL, "channel_name": "ops", "user_id": "U0ANN", "user_name": "ann", "command": "/o2",
        "text": f"ask how many queries per minute? {tag}", "api_app_id": inst["app_id"],
        "is_enterprise_install": "false", "response_url": "https://hooks.slack.com/commands/T0/1/x",
        "trigger_id": f"{int(time.time())}.2.{uuid.uuid4().hex[:12]}",
    }
    resp = signed_post(client, "commands", urlencode(form).encode(), f"signing-{inst['app_id']}",
                       content_type="application/x-www-form-urlencoded")
    assert resp.status_code == 200, resp.text
    turns = wait_until(lambda: turns_for(o2ai, tag), "the private turn", timeout=30)
    assert turns[0]["body"]["query"] == f"how many queries per minute? {tag}"
    ack = wait_until(lambda: [e for e in ephemerals(ready, "U0ANN") if "You asked privately" in e.get("text", "")],
                     "the private note in the channel")
    assert ack[-1]["channel"] == CHANNEL
    dm = wait_until(lambda: [c for c in ready.calls("chat.postMessage") if c["form"].get("channel") == "U0ANN"
                             and c["form"].get("text") == "Working on it…"], "the DM progress message")
    dm_channel, dm_ts = dm[-1]["response"]["channel"], dm[-1]["response"]["ts"]
    final = wait_until(lambda: [c["form"] for c in ready.calls("chat.update") if c["form"].get("ts") == dm_ts
                                and "Answered with your access" in c["form"].get("blocks", "")], "the DM answer")
    assert final[-1]["channel"] == dm_channel
    assert f"<#{CHANNEL}>" in final[-1]["blocks"]
    public = [c for c in ready.calls("chat.postMessage") if c["form"].get("channel") == CHANNEL]
    assert public == [], "nothing posted publicly in the channel"
