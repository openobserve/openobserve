"""Live-run fixes of the turn, end to end: Stop, the agent's context, deleted questions, ended approvals.

B-LIVE-6: Stop in the agent view cancels the turn in O2 when chats persist (the cancel used to be refused
415, as O2 takes no state change without a JSON body). B-LIVE-15: every turn tells o2-ai where the org
opens in OpenObserve (``context.webUrl``), through O2's own chat path unchanged. B-LIVE-10 and 11:
deleting a question deletes every answer to it, re-asks included, its chart file too, and a stale list cannot
answer it again.
B-LIVE-12: a turn that ends while its approval waits closes the card, and a later click is refused.

Event shapes are the ones the live run recorded (LIVE-RESULTS.md, 2026-10-15). Needs the flag-on
self-hosted server with ``O2_AI_ENABLED=true`` and ``O2_AGENT_URL`` at ``helpers/o2ai_mock.py``; the Stop
test needs ``O2_AI_CHAT_PERSISTENCE_ENABLED=true`` (``PERSIST=true`` in the run scripts).
"""
from __future__ import annotations

import json
import time
import uuid
from typing import Any

import pytest

from support.client import OpenObserveClient

from .slack_helpers import SlackMock, add_to_org, connect_with_proof, make_slack_org, wait_until
from .test_bridge import O2aiMock, o2ai  # noqa: F401
from .test_bridge_slack import CHANNEL, answers_in, event, send, setup_team, turns_for, uniq
from .test_interactions import approval_post, card_edits, click, element, ephemerals, o2ai_requests

pytestmark = [pytest.mark.enterprise]


@pytest.fixture
def ready(slack_on: None, self_hosted: None, mock: SlackMock) -> SlackMock:
    return mock


def callback(inst: dict[str, Any], team: str, ev: dict[str, Any]) -> bytes:
    return json.dumps({
        "token": "ignored", "team_id": team, "api_app_id": inst["app_id"], "event": ev,
        "type": "event_callback", "event_id": "Ev" + uuid.uuid4().hex[:10], "event_time": int(time.time()),
        "authorizations": [{"enterprise_id": None, "team_id": team, "user_id": "U0BOT",
                            "is_bot": True, "is_enterprise_install": False}],
        "is_ext_shared_channel": False,
    }).encode()


def dm(inst: dict[str, Any], team: str, user: str, channel: str, text: str) -> tuple[bytes, str]:
    ts = f"{time.time():.6f}"
    ev = {"type": "message", "user": user, "text": text, "ts": ts, "team": team, "channel": channel,
          "event_ts": ts, "channel_type": "im"}
    return callback(inst, team, ev), ts


def session_stopped(inst: dict[str, Any], team: str, user: str, channel: str, thread_ts: str,
                    streaming_ts: str) -> bytes:
    """``agent_session_stopped`` with exactly the keys Slack sent live."""
    ev = {"type": "agent_session_stopped", "channel": channel, "thread_ts": thread_ts, "user": user,
          "streaming_message_ts": streaming_ts, "event_ts": f"{time.time():.6f}"}
    return callback(inst, team, ev)


def question_deleted(inst: dict[str, Any], team: str, user: str, question_ts: str, text: str) -> list[bytes]:
    """A thread root deleted: the ``message_changed`` tombstone, then ``message_deleted``, as Slack sent them."""
    now = f"{time.time():.6f}"
    tombstone = {"type": "message", "subtype": "message_changed", "hidden": True, "channel": CHANNEL,
                 "ts": now, "event_ts": now, "channel_type": "channel",
                 "message": {"subtype": "tombstone", "text": "This message was deleted.", "user": "USLACKBOT",
                             "hidden": True, "type": "message", "thread_ts": question_ts, "ts": question_ts,
                             "reply_count": 2, "reply_users": ["U0BOT"]},
                 "previous_message": {"user": user, "type": "message", "ts": question_ts, "text": text,
                                      "team": team, "thread_ts": question_ts, "reply_count": 2}}
    deleted = {"type": "message", "subtype": "message_deleted", "hidden": True, "deleted_ts": question_ts,
               "channel": CHANNEL, "event_ts": now, "ts": now, "channel_type": "channel",
               "previous_message": {"user": user, "type": "app_mention", "ts": question_ts, "text": text,
                                    "team": team}}
    return [callback(inst, team, tombstone), callback(inst, team, deleted)]


def persistence_on(client: OpenObserveClient) -> bool:
    resp = client.get("config", org="default")
    return resp.status_code == 200 and bool(resp.json().get("ai_chat_persistence_enabled"))


def test_stop_cancels_the_running_turn_in_o2_when_chats_persist(
    client: OpenObserveClient, slack_org: str, ready: SlackMock, o2ai: O2aiMock,  # noqa: F811
) -> None:
    if not persistence_on(client):
        pytest.skip("Stop reaches O2's cancel only with O2_AI_CHAT_PERSISTENCE_ENABLED=true")
    team, inst, _ = setup_team(client, slack_org, ready, "U0ANN")
    tag = uniq()
    o2ai.script({"turn": "chart", "hold_secs": 25, "match": tag})
    channel = "D0" + tag.upper()
    body, ts = dm(inst, team, "U0ANN", channel, f"how many queries per minute? {tag}")
    send(client, inst, body)
    session = wait_until(lambda: turns_for(o2ai, tag), "the turn at o2-ai")[0]["headers"]["x-o2-assistant-session-id"]
    stream = wait_until(lambda: [c for c in ready.calls("chat.startStream") if c["form"].get("channel") == channel],
                        "the streamed answer", timeout=30)[0]
    send(client, inst, session_stopped(inst, team, "U0ANN", channel, ts, stream["response"]["ts"]))

    cancels = wait_until(lambda: [r for r in o2ai_requests(o2ai, "/cancel") if session in r["path"]],
                         "O2 accepting the cancel and forwarding it to o2-ai", timeout=20)
    assert cancels[0]["path"].split("?", 1)[0] == f"/o2_agent/session/{session}/cancel"
    stopped = wait_until(lambda: [c["form"] for c in ready.calls("chat.stopStream")
                                  if c["form"].get("ts") == stream["response"]["ts"]], "the stream's end", timeout=30)
    assert "Stopped." in stopped[-1].get("blocks", ""), stopped[-1]


def test_every_turn_tells_o2ai_where_the_org_opens_in_openobserve(
    client: OpenObserveClient, slack_org: str, ready: SlackMock, o2ai: O2aiMock,  # noqa: F811
) -> None:
    team, inst, _ = setup_team(client, slack_org, ready, "U0ANN")
    tag = uniq()
    body, ts, _ = event(inst, team, "U0ANN", f"<@U0BOT> delete the checkout dashboard {tag}")
    send(client, inst, body)
    wait_until(lambda: answers_in(ready, ts), "the answer", timeout=30)
    context = turns_for(o2ai, tag)[0]["body"]["context"]
    assert context["webUrl"].startswith("http"), context
    assert context["webUrl"].endswith(f"/web/?org_identifier={slack_org}"), context
    assert context["currentPage"] == "slack"


def test_deleting_a_question_deletes_its_re_asked_answer_and_a_stale_list_cannot_answer_it(
    client: OpenObserveClient, slack_org: str, ready: SlackMock, o2ai: O2aiMock,  # noqa: F811
) -> None:
    other = make_slack_org(client)
    team, inst, o2 = setup_team(client, slack_org, ready, "U0ANN")
    assert connect_with_proof(client, other, inst["id"], team_id=team).status_code == 200
    add_to_org(client, other, o2["U0ANN"].email, "editor")
    tag = uniq()
    text = f"<@U0BOT> how many queries per minute? {tag}"
    body, ts, _ = event(inst, team, "U0ANN", text)
    send(client, inst, body)
    answer = wait_until(lambda: answers_in(ready, ts), "the first answer", timeout=30)[-1]
    menu = element(json.loads(answer["blocks"]), "o2_reask_menu")
    click(client, inst, team, "U0ANN", channel=CHANNEL, message_ts=answer["ts"], thread_ts=ts, action=menu)
    listed = wait_until(lambda: [e for e in ephemerals(ready, "U0ANN") if "o2_reask_in" in e.get("blocks", "")],
                        "the private org list")[-1]
    option = next(o for o in element(json.loads(listed["blocks"]), "o2_reask_in")["options"]
                  if o["text"]["text"] == other)
    action = {"type": "static_select", "action_id": "o2_reask_in", "block_id": "o2_answer", "selected_option": option}
    list_ts = f"{time.time():.6f}"
    click(client, inst, team, "U0ANN", channel=CHANNEL, message_ts=list_ts, thread_ts=ts, action=action,
          ephemeral=True)
    wait_until(lambda: [a for a in answers_in(ready, ts) if f"org {other}" in a["blocks"]], "the re-asked answer",
               timeout=30)
    posted = sorted(c["response"]["ts"] for c in ready.calls("chat.postMessage")
                    if c["form"].get("channel") == CHANNEL and c["form"].get("thread_ts") == ts)
    assert len(posted) == 2, posted

    for deletion in question_deleted(inst, team, "U0ANN", ts, text):
        send(client, inst, deletion)
    deleted = wait_until(lambda: sorted({c["form"]["ts"] for c in ready.calls("chat.delete")
                                         if c["form"].get("ts") in posted}) == posted and posted,
                         "both answers deleted, the re-asked one too")
    assert deleted == posted

    turns = len(turns_for(o2ai, tag))
    click(client, inst, team, "U0ANN", channel=CHANNEL, message_ts=list_ts, thread_ts=ts, action=action,
          ephemeral=True)
    wait_until(lambda: [e for e in ephemerals(ready, "U0ANN") if "This question was deleted" in e.get("text", "")],
               "the refusal for the stale list")
    assert len(turns_for(o2ai, tag)) == turns, "no turn for a deleted question"


def test_deleting_a_question_deletes_its_chart_file_by_the_id_slack_shared(
    client: OpenObserveClient, slack_org: str, ready: SlackMock, o2ai: O2aiMock,  # noqa: F811
) -> None:
    team, inst, _ = setup_team(client, slack_org, ready, "U0ANN")
    tag = uniq()
    o2ai.script({"turn": "chart", "match": tag})
    text = f"<@U0BOT> plot the queries per minute {tag}"
    body, ts, _ = event(inst, team, "U0ANN", text)
    send(client, inst, body)
    shared = wait_until(lambda: [c for c in ready.calls("files.completeUploadExternal")
                                 if c["form"].get("thread_ts") == ts and "response" in c], "the chart", timeout=30)
    file_id = shared[0]["response"]["files"][0]["id"]
    assert all(c["form"].get("file") != file_id for c in ready.calls("files.delete"))

    for deletion in question_deleted(inst, team, "U0ANN", ts, text):
        send(client, inst, deletion)
    deleted = wait_until(lambda: [c for c in ready.calls("files.delete") if c["form"].get("file") == file_id],
                         "the chart file deleted with its question")
    assert deleted[0]["bearer"].startswith("xoxb-"), "the bot token, which uploaded it"
    assert "response" in deleted[0], deleted[0]


def test_a_turn_that_ends_while_its_approval_waits_closes_the_card_and_refuses_the_click(
    client: OpenObserveClient, slack_org: str, ready: SlackMock, o2ai: O2aiMock,  # noqa: F811
) -> None:
    team, inst, _ = setup_team(client, slack_org, ready, "U0ANN")
    tag = uniq()
    o2ai.script({"confirm": "permission", "wait_secs": 2, "match": tag})
    body, ts, _ = event(inst, team, "U0ANN", f"<@U0BOT> list the pods {tag}")
    send(client, inst, body)
    post = approval_post(ready, ts)
    message_ts = post["response"]["ts"]
    wait_until(lambda: answers_in(ready, ts), "the turn's end once o2-ai dropped the request", timeout=30)
    ended = wait_until(lambda: card_edits(ready, message_ts, "before it was approved"), "the closed card")
    assert "o2_approve" not in ended[-1]["blocks"]
    approve = element(json.loads(post["form"]["blocks"]), "o2_approve")
    click(client, inst, team, "U0ANN", channel=CHANNEL, message_ts=message_ts, thread_ts=ts, action=approve)
    wait_until(lambda: [e for e in ephemerals(ready, "U0ANN") if "ended before it was approved" in e.get("text", "")],
               "the visible refusal")
    assert o2ai_requests(o2ai, "/confirm") == [], "no /ai/confirm for an ended request"
