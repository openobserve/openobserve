"""Phase 2 B6: Investigate, alert threads and the automatic investigation (AC-P2.8, spec 8.4, 8.5).

Needs the flag-on enterprise server of ``slack_helpers`` with the Slack mock, the o2-ai mock
(``helpers/o2ai_mock.py``) at ``O2_AGENT_URL`` with ``O2_AI_ENABLED=true``,
``O2_INCIDENTS_RCA_ENABLED=true`` and ``O2_ONCALL_ENABLED=true``, ``ZO_ALERT_SCHEDULE_INTERVAL`` low
and a short ``ZO_USAGE_PUBLISH_INTERVAL`` so the decision rows reach ``_meta`` quickly.

Two critical firings on destinations that investigate automatically:

- ``investigated`` has no on-call routing, so the scheduler opens a teamless on-call record and starts
  the paging RCA in the tick that posts the message; the gate answers ``rca_running`` and the thread
  gets that run's verdict (B6c) instead of a second run;
- ``investigated_alone`` routes to a team whose L0 policy is off for its priority, so no paging RCA
  runs and auto-investigate starts its own run as the SRE service account.
"""
from __future__ import annotations

import json
import time
from typing import Any

import pytest
import requests

from support.client import OpenObserveClient
from support.wait import wait_until

from tests.alerts.multialert_helpers import AlertsClient, uniq
from tests.oncall.oncall_helpers import OnCallClient, ladder, user_target
from .slack_helpers import SlackMock, signed_post
from .test_alert_buttons import Firing, alerts  # noqa: F401
from .test_alert_messages import CHANNEL, replies
from .test_bridge import O2aiMock
from .test_bridge_slack import event

pytestmark = [pytest.mark.enterprise]

CAUSE = "checkout v2.14.0 is running out of memory"
REPORT = "# RCA\n\nThe checkout deploy exhausted memory.\n"
FOOTER = "Automatic investigation by the OpenObserve AI service account"
WINDOW_BEFORE_US = 30 * 60 * 1_000_000
# The mock replays the core crate's graded-run fixture: two decisive evidence sources, graded high.
GRADED_META = "Confidence high · 2 pieces of evidence"


@pytest.fixture(scope="module")
def o2ai(client: OpenObserveClient, slack_on: None) -> O2aiMock:
    m = O2aiMock()
    if not m.reachable():
        pytest.skip(f"o2-ai mock not reachable at {m.base_url}; run helpers/o2ai_mock.py")
    probe = client.post("ai/chat_stream", json={"messages": []}, org="default")
    if probe.status_code == 400 and "not enabled" in probe.text:
        pytest.skip("start the server with O2_AI_ENABLED=true and O2_AGENT_URL at the o2-ai mock")
    m.reset()
    return m


@pytest.fixture(scope="module")
def mock(slack_on: None) -> SlackMock:
    """One workspace mock for both firings: a reset would revoke the first firing's tokens."""
    m = SlackMock()
    if not m.reachable():
        pytest.skip(f"Slack mock not reachable at {m.base_url}")
    m.reset()
    return m


@pytest.fixture(scope="module")
def investigated(request: pytest.FixtureRequest, client: OpenObserveClient, slack_org: str, slack_on: None,
                 self_hosted: None, alerts: AlertsClient, o2ai: O2aiMock, mock: SlackMock) -> Firing:  # noqa: F811
    """A critical firing nobody routes: the on-call paging RCA starts in the same tick (reason rca_running)."""
    name = uniq("b6_paged")
    # Scripted before the alert exists: the paging RCA asks o2-ai as soon as the firing posts.
    o2ai.script({"report": REPORT, "probable_cause": CAUSE, "match": name})
    f = Firing(client, slack_org, mock, alerts, auto_investigate="critical", name=name)
    request.node.stash[FIRINGS].append(f)
    return f


@pytest.fixture(scope="module")
def investigated_alone(request: pytest.FixtureRequest, client: OpenObserveClient, slack_org: str,
                       slack_on: None, self_hosted: None, alerts: AlertsClient, o2ai: O2aiMock,  # noqa: F811
                       mock: SlackMock, investigated: Firing) -> Firing:
    """A critical firing routed to a team with L0 off: no paging RCA, so auto-investigate runs its own."""
    oncall = OnCallClient(client, slack_org)
    team = oncall.team_id(name=uniq("b6_quiet"))
    root = investigated.users["U0ANN"][0]
    assert oncall.add_member(team, root).status_code == 200
    off = {"mode": {"P1": "parallel", "P2": "off", "P3": "off", "P4": "off"}, "triage_budget_seconds": 90,
           "allow_promotion": True, "max_promotion_steps": 2, "allow_downgrade": True, "allow_suppress": False}
    resp = oncall.set_policy(team, [ladder([user_target(root)])], l0=off)
    assert resp.status_code == 200, resp.text
    name = uniq("b6_alone")
    o2ai.script({"report": REPORT, "probable_cause": CAUSE, "match": name})
    f = Firing(client, slack_org, mock, alerts, auto_investigate="critical", name=name, oncall_team=team)
    request.node.stash[FIRINGS].append(f)
    return f


@pytest.fixture(scope="module", autouse=True)
def diagnostics(request: pytest.FixtureRequest):
    """At module teardown: each firing's decision rows and thread replies, for a failure's post-mortem."""
    request.node.stash[FIRINGS] = []
    yield
    for f in request.node.stash[FIRINGS]:
        rows = [(r["_timestamp"], r["reason"], r["run"], r.get("rca_run_id"), r["firing_started_at"]) for r in decisions(f)]
        print(f"\n[B6 diag] {f.name} decisions:", rows)
        for r in replies(f.mock, f.ts):
            print("[B6 diag] reply:", r["response"]["ts"], (r["form"].get("text") or "")[:80], (r["form"].get("blocks") or "")[:400])


FIRINGS = pytest.StashKey()


def in_alert_channel(body: bytes) -> bytes:
    """``test_bridge_slack.event`` writes its own channel; the alert thread lives in the destination's."""
    doc = json.loads(body)
    doc["event"]["channel"] = CHANNEL
    return json.dumps(doc).encode()


def decisions(f: Firing) -> list[dict[str, Any]]:
    resp = f.client.get(f"alerts/auto_investigate/decisions?alert_id={f.alert_id}", org=f.org, prefix="api/v2/")
    assert resp.status_code == 200, resp.text
    return resp.json()["decisions"]


def rca_runs(o2ai: O2aiMock, f: Firing) -> list[dict[str, Any]]:
    """The RCA turns o2-ai was asked for this alert: ``/o2_agent/sre-rca/query/stream``."""
    resp = requests.get(f"{o2ai.base_url}/_mock/requests", timeout=5)
    resp.raise_for_status()
    return [r for r in resp.json()["requests"]
            if "sre-rca" in r["path"] and r["path"].endswith("/query/stream")
            and (r["body"] or {}).get("context", {}).get("subject_id") == f.alert_id]


def verdict_reply(f: Firing) -> dict[str, Any]:
    return wait_until(lambda: next((r for r in replies(f.mock, f.ts) if "Probable cause" in r["form"].get("blocks", "")), None),
                      timeout=150, interval=2, msg=f"the verdict reply in {f.name}'s thread")


def assert_run_as_service_account(run: dict[str, Any], f: Firing, trigger: str) -> None:
    context = run["body"]["context"]
    assert context["subject_type"] == "alert" and context["subject_id"] == f.alert_id, context
    assert context["alert_name"] == f.name, context
    assert "incident_id" not in context, "an alert subject never names an incident"
    assert f"Trigger: {trigger}." in run["body"]["query"], run["body"]["query"]
    assert run["headers"].get("authorization", "").startswith("Basic "), "the SRE service account's basic auth"


def assert_verdict_blocks(blocks: str) -> None:
    assert CAUSE in blocks, blocks
    assert GRADED_META in blocks, blocks
    assert FOOTER in blocks and "runs with its access, not yours" in blocks, blocks


def assert_row_inputs(row: dict[str, Any]) -> None:
    assert (row["mark_lookup"], row["protected"]) == ("not_checked", False), row
    assert row["settings_version"] == 0 and row["base_cooldown_secs"] == 14400, row
    assert (row["entity_type"], row["decision_kind"]) == ("alert", "auto_investigate"), row
    assert row["level"] == "critical" and row["destination"], row
    assert row["onsets_7d"] >= 1, row
    assert "budget_check" not in row


def test_a_paged_critical_fire_reuses_the_paging_rca_and_its_verdict_posts_in_the_thread(
    investigated: Firing, o2ai: O2aiMock,
) -> None:
    """Spec 8.5 + B6c: the paging RCA of the same tick is the one run; its verdict lands in the thread (MK-14)."""
    f = investigated
    blocks = verdict_reply(f)["form"]["blocks"]
    runs = rca_runs(o2ai, f)
    assert_verdict_blocks(blocks)
    assert len(runs) == 1, ("the paging RCA is reused, not run again", runs)
    assert_run_as_service_account(runs[0], f, "on-call page")


def test_the_decision_row_of_a_paged_fire_reuses_the_running_rca(investigated: Firing) -> None:
    """B6b route over the B6 producer: one row, `rca_running` with no run of ours."""
    f = investigated
    rows = wait_until(lambda: decisions(f) or None, timeout=90, interval=3, msg="the decision row in _meta")
    mine = [r for r in rows if r["alert_id"] == f.alert_id]
    assert len(mine) == 1, mine
    row = mine[0]
    assert (row["run"], row["reason"]) == (False, "rca_running"), row
    assert not row.get("rca_run_id"), row
    assert_row_inputs(row)


def test_an_unpaged_critical_fire_is_investigated_as_the_service_account(
    investigated_alone: Firing, o2ai: O2aiMock,
) -> None:
    """Spec 8.5: one RCA run per critical Fire with no paging RCA, as an alert subject (MK-14)."""
    f = investigated_alone
    blocks = verdict_reply(f)["form"]["blocks"]
    runs = rca_runs(o2ai, f)
    assert_verdict_blocks(blocks)
    assert len(runs) == 1, ("one run of ours, no paging RCA", runs)
    assert_run_as_service_account(runs[0], f, "manual")


def test_the_decision_row_lands_in_meta_and_reads_back_through_the_route(investigated_alone: Firing) -> None:
    """B6b route over the B6 producer: one `eligible` row with its run id and the inputs the gate used."""
    f = investigated_alone
    rows = wait_until(lambda: decisions(f) or None, timeout=90, interval=3, msg="the decision row in _meta")
    mine = [r for r in rows if r["alert_id"] == f.alert_id]
    assert len(mine) == 1, mine
    row = mine[0]
    assert (row["run"], row["reason"]) == (True, "eligible"), row
    assert row["rca_run_id"], row
    assert_row_inputs(row)


def test_investigate_runs_the_clickers_turn_with_the_firing_window_and_no_incident(
    investigated: Firing, o2ai: O2aiMock,
) -> None:
    """AC-P2.8.1: an o2-ai turn as the clicker, currentPage slack, 30 min before the firing to now."""
    f = investigated
    before = len(o2ai.turns())
    f.button("U0ANN", "o2_alert_investigate")
    turn = wait_until(lambda: (o2ai.turns()[before:] or [None])[0], timeout=60, interval=1, msg="the Investigate turn")
    assert "sre-rca" not in turn["path"], turn["path"]
    body = turn["body"]
    context = body["context"]
    assert context["currentPage"] == "slack"
    assert "incident_id" not in context
    assert context["timeRange"]["type"] == "absolute"
    firing_started_at = decisions(f)[0]["firing_started_at"]
    assert context["timeRange"]["startTime"] == firing_started_at - WINDOW_BEFORE_US
    assert context["timeRange"]["endTime"] > firing_started_at
    assert context["timeRange"]["endTime"] <= int(time.time() * 1_000_000)
    assert not body.get("history"), "Investigate never reads thread history"
    question = body["query"]
    assert question.startswith(f"Investigate why alert {f.name}"), question
    assert "has been firing since" in question, question
    answer = wait_until(lambda: next((u["form"] for u in f.mock.calls("chat.update")
                                      if "Queries held steady" in u["form"].get("blocks", "")
                                      and u["form"].get("ts") in {r["response"]["ts"] for r in replies(f.mock, f.ts)}), None),
                        timeout=60, interval=1, msg="the clicker's answer edited into the alert thread")
    assert "Re-ask in" not in answer.get("blocks", ""), "an alert thread hides Re-ask in"


def test_a_reply_without_a_mention_in_the_alert_thread_is_ignored(investigated: Firing, o2ai: O2aiMock) -> None:
    """AC-P2.8.2: responders talk to each other in the alert thread; the bot answers mentions only."""
    f = investigated
    before = len(o2ai.turns())
    body = in_alert_channel(event(f.inst, f.team, "U0ANN", "is us-east affected too?", thread_ts=f.ts, kind="message")[0])
    resp = signed_post(f.client, "events", body, f"signing-{f.inst['app_id']}")
    assert resp.status_code == 200, resp.text
    time.sleep(6)
    assert o2ai.turns()[before:] == [], "no turn without a mention"
    body = in_alert_channel(event(f.inst, f.team, "U0BOB", "<@U0BOT> what about us-west?", thread_ts=f.ts)[0])
    resp = signed_post(f.client, "events", body, f"signing-{f.inst['app_id']}")
    assert resp.status_code == 200, resp.text
    turn = wait_until(lambda: next((t for t in o2ai.turns()[before:] if "us-west" in (t["body"] or {}).get("query", "")), None),
                      timeout=60, interval=1, msg="the colleague's turn")
    content = turn["body"]["query"]
    assert content.startswith("what about us-west?") and f"alert {f.name}" in content, content
    assert [t for t in o2ai.turns()[before:] if "us-east" in (t["body"] or {}).get("query", "")] == [], "the reply never became a turn"
    assert turn["body"]["context"]["timeRange"]["type"] == "absolute", "the same alert window again"
