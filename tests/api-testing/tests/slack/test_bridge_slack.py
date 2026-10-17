"""Commit 11 bridge, end to end: a signed Slack event becomes a delegated turn and an answer in Slack.

AC-10.3 (I) and the answer flow of design 1.4: a signed ``app_mention`` reaches
the turn runner, which calls O2's own ``chat_stream`` over loopback with the asker's delegated token; the
o2-ai mock records what reaches the agent and the Slack mock records the answer the bot posts.

Needs the flag-on self-hosted server with ``O2_AI_ENABLED=true`` and ``O2_AGENT_URL`` at
``helpers/o2ai_mock.py`` (``run/p11/start.sh``).
"""
from __future__ import annotations

import json
import time
import uuid
from typing import Any

import pytest

from support.client import OpenObserveClient

from .slack_helpers import (
    SlackMock,
    http_install,
    make_user,
    my_links,
    new_team,
    signed_post,
    slack_user,
    wait_until,
)
from .test_bridge import O2aiMock, o2ai  # noqa: F401

pytestmark = [pytest.mark.enterprise]

CHANNEL = "C0OPS"
ANSWER = "Queries held steady at ~400/min."


@pytest.fixture
def ready(slack_on: None, self_hosted: None, mock: SlackMock) -> SlackMock:
    return mock


def uniq() -> str:
    return uuid.uuid4().hex[:8]


def event(inst: dict[str, Any], team: str, user: str, text: str, *, ts: str | None = None,
          thread_ts: str | None = None, kind: str = "app_mention") -> tuple[bytes, str, str]:
    """An ``app_mention`` (or channel ``message``) event_callback as Slack sends it; returns (body, ts, event_id)."""
    ts = ts or f"{time.time():.6f}"
    ev: dict[str, Any] = {"type": kind, "user": user, "text": text, "ts": ts, "team": team,
                          "user_team": team, "channel": CHANNEL, "event_ts": ts}
    if kind == "message":
        ev["channel_type"] = "channel"
    if thread_ts:
        ev["thread_ts"] = thread_ts
    event_id = "Ev" + uuid.uuid4().hex[:10]
    body = json.dumps({
        "token": "ignored", "team_id": team, "api_app_id": inst["app_id"], "event": ev,
        "type": "event_callback", "event_id": event_id, "event_time": int(time.time()),
        "authorizations": [{"enterprise_id": None, "team_id": team, "user_id": "U0BOT",
                            "is_bot": True, "is_enterprise_install": False}],
        "is_ext_shared_channel": False,
    }).encode()
    return body, ts, event_id


def send(client: OpenObserveClient, inst: dict[str, Any], body: bytes) -> None:
    resp = signed_post(client, "events", body, f"signing-{inst['app_id']}")
    assert resp.status_code == 200, resp.text


def answers(mock: SlackMock) -> list[dict[str, str]]:
    """Every ``chat.update`` that turned a progress message into an answer."""
    return [c["form"] for c in mock.calls("chat.update") if "Answered with" in c["form"].get("blocks", "")]


def progress_posts(mock: SlackMock, thread_ts: str) -> list[dict[str, str]]:
    return [c["form"] for c in mock.calls("chat.postMessage")
            if c["form"].get("channel") == CHANNEL and c["form"].get("thread_ts") == thread_ts]


def turns_for(o2ai: O2aiMock, tag: str) -> list[dict[str, Any]]:  # noqa: F811
    """This test's turns only: other tests' mentions may still be answered in the background."""
    return [t for t in o2ai.turns() if tag in (t["body"] or {}).get("query", "")]


def setup_team(client: OpenObserveClient, org: str, mock: SlackMock, *users: str) -> tuple[str, dict[str, Any], dict[str, OpenObserveClient]]:
    """A workspace whose members link automatically (listed domain) and an O2 editor for each."""
    members, o2 = [], {}
    for u in users:
        email = f"{u[2:].lower()}_{uniq()}@acme.test"
        _, o2[u] = make_user(client, org, "editor", email=email)
        members.append(slack_user(u, "", email))
    team = new_team(mock, *members)
    inst = http_install(client, org, team)
    put = client.put(f"slack/installations/{inst['id']}/linking", json={"enabled": True, "domains": ["acme.test"]}, org=org)
    assert put.status_code == 200, put.text
    return team, inst, o2


def answers_in(mock: SlackMock, thread_ts: str) -> list[dict[str, str]]:
    """The answers in one thread: edits of the progress messages posted there."""
    progress = {c["response"]["ts"] for c in mock.calls("chat.postMessage")
                if c["form"].get("thread_ts") == thread_ts and "response" in c}
    return [c["form"] for c in mock.calls("chat.update")
            if c["form"].get("ts") in progress and "Answered with" in c["form"].get("blocks", "")]


def ask(client: OpenObserveClient, inst: dict[str, Any], team: str, mock: SlackMock, user: str, text: str,
        **kw: Any) -> tuple[str, str]:
    """Asks, and waits for the answer in this question's own thread (other tests' turns may still answer)."""
    body, ts, event_id = event(inst, team, user, text, **kw)
    thread = kw.get("thread_ts") or ts
    before = len(answers_in(mock, thread))
    send(client, inst, body)
    wait_until(lambda: len(answers_in(mock, thread)) > before, f"the answer to {event_id}", timeout=30)
    return ts, event_id


def test_a_signed_mention_is_answered_in_its_thread_as_the_linked_user(
    client: OpenObserveClient, slack_org: str, ready: SlackMock, o2ai: O2aiMock,  # noqa: F811
) -> None:
    team, inst, _ = setup_team(client, slack_org, ready, "U0ANN")
    tag = uniq()
    ts, _ = ask(client, inst, team, ready, "U0ANN", f"<@U0BOT> how many queries per minute? {tag}")

    turns = turns_for(o2ai, tag)
    assert len(turns) == 1
    sent = turns[0]
    assert sent["headers"]["authorization"].startswith("Bearer o2dt."), sent["headers"]
    assert sent["body"]["query"] == f"how many queries per minute? {tag}"
    assert sent["body"]["confirm_timeout_secs"] == 600
    assert sent["body"]["context"]["currentPage"] == "slack"
    assert sent["body"]["context"]["org_id"] == slack_org
    assert sent["body"]["context"]["timeRange"]["relativeTimePeriod"] == "1h"
    assert "o2_fork_seed" not in sent["body"]["context"]

    progress = progress_posts(ready, ts)
    assert len(progress) == 1, progress
    assert progress[0]["text"] == "Working on it…"
    final = answers_in(ready, ts)[-1]
    blocks = json.loads(final["blocks"])
    assert blocks[0] == {"type": "markdown", "text": ANSWER}
    text = final["blocks"]
    assert "<!date^" in text, text
    assert "Confidence high" in text, text
    assert f"Answered with <@U0ANN>'s access · org {slack_org} · visible to everyone in <#{CHANNEL}>" in text
    assert "No mention needed for <@U0ANN>" in text
    assert progress[0]["thread_ts"] == ts


def test_a_colleagues_mention_is_seeded_and_only_the_askers_reply_skips_the_mention(
    client: OpenObserveClient, slack_org: str, ready: SlackMock, o2ai: O2aiMock,  # noqa: F811
) -> None:
    team, inst, o2 = setup_team(client, slack_org, ready, "U0ANN", "U0BEN")
    tag = uniq()
    thread, _ = ask(client, inst, team, ready, "U0ANN", f"<@U0BOT> how many queries per minute? {tag}")
    ask(client, inst, team, ready, "U0BEN", f"<@U0BOT> and payments? {tag}", thread_ts=thread)
    wait_until(lambda: my_links(o2["U0BEN"], slack_org), "Ben's automatic link")

    ann, ben = turns_for(o2ai, tag)
    ann_session = ann["headers"]["x-o2-assistant-session-id"]
    assert ben["headers"]["x-o2-assistant-session-id"] != ann_session
    assert ben["body"]["context"]["o2_fork_seed"] is True
    assert ben["body"]["history"] == [{"role": "assistant", "content": ANSWER}]
    assert ben["body"]["query"] == f"and payments? {tag}"

    ask(client, inst, team, ready, "U0ANN", f"is us-east affected too? {tag}", thread_ts=thread, kind="message")
    reply = turns_for(o2ai, tag)[2]
    assert reply["headers"]["x-o2-assistant-session-id"] == ann_session
    assert "o2_fork_seed" not in reply["body"]["context"]

    body, _, _ = event(inst, team, "U0BEN", f"what about eu? {tag}", thread_ts=thread, kind="message")
    send(client, inst, body)
    # The thread runs in order, so Ann's next reply being answered means Ben's was already passed over.
    ask(client, inst, team, ready, "U0ANN", f"and apac? {tag}", thread_ts=thread, kind="message")
    queries = [t["body"]["query"] for t in turns_for(o2ai, tag)]
    assert f"what about eu? {tag}" not in queries, "a colleague's reply without a mention is not answered"
    assert len(queries) == 4, queries
    assert queries[-1] == f"and apac? {tag}", queries
