"""On-Call regressions, proven on real pages fired by the scheduler: o2-enterprise#3197-3202."""
from __future__ import annotations

import os
import threading
from collections.abc import Callable, Generator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import pytest

from support.client import OpenObserveClient
from support.wait import wait_until

from .oncall_helpers import (
    LADDER_POLL,
    LADDER_TIMEOUT,
    MICROS,
    RUNG_LATER,
    RUNG_NOW,
    OnCallClient,
    make_user,
    micros_from_now,
    rotation_target,
    user_target,
)

pytestmark = pytest.mark.enterprise

WHOLE_TEAM: dict[str, Any] = {"kind": "whole_team"}
AGENT_PORT = int(os.environ.get("ONCALL_FAKE_AGENT_PORT", "5099"))
MIN_TRIAGE_BUDGET_S = 30
# Bigger than the triage budget, so a clock wrongly counted from open still lands after the first page and shows as a short gap.
GATED_RUNG_S = 60
# The ladder fires on a scheduler tick, so a rung may land late but never early; this only absorbs clock rounding.
EARLY_TOLERANCE_S = 2


def steps_ladder(steps: list[tuple[int, list[dict[str, Any]]]], *, priority: int = 1) -> dict[str, Any]:
    """One priority's ladder with different targets per step, paged by email so each person has their own ledger row."""
    return {
        "priority": priority,
        "steps": [{"after_micros": after, "targets": targets} for after, targets in steps],
        "channels": ["email"],
    }


def mark_away(oncall: OnCallClient, email: str) -> None:
    resp = oncall.oc("POST", "unavailability", json={
        "user_email": email,
        "start_at": micros_from_now(minutes=-5),
        "end_at": micros_from_now(hours=24),
    })
    assert resp.status_code == 200, resp.text


def ledger_rows(oncall: OnCallClient, page_id: str) -> list[dict[str, Any]]:
    resp = oncall.deliveries(page_id)
    assert resp.status_code == 200, resp.text
    return (resp.json() or {}).get("deliveries", [])


def wait_for_landed(oncall: OnCallClient, page_id: str, recipients: set[str], *,
                    run: int | None = None, timeout: float = LADDER_TIMEOUT) -> list[dict[str, Any]]:
    """Poll until each recipient has a delivered row on this page, optionally in one ladder run."""
    def _landed() -> list[dict[str, Any]] | None:
        rows = [r for r in ledger_rows(oncall, page_id)
                if r.get("delivered") is True and (run is None or r.get("ladder_run") == run)]
        return rows if recipients <= {r.get("recipient") for r in rows} else None

    return wait_until(_landed, timeout=timeout, interval=LADDER_POLL,
                      msg=f"{sorted(recipients)} paged on {page_id} (run {run})")


def everyone_tried(oncall: OnCallClient, page_id: str) -> set[str]:
    """Every recipient the engine tried, landed or not: a failed attempt at the wrong person is still the bug."""
    return {r["recipient"] for r in ledger_rows(oncall, page_id) if r.get("recipient")}


def timeline(oncall: OnCallClient, page_id: str) -> list[str]:
    resp = oncall.get_response(page_id)
    assert resp.status_code == 200, resp.text
    return [e.get("body", "") for e in resp.json().get("events", [])]


def page_record(oncall: OnCallClient, page_id: str) -> dict[str, Any]:
    resp = oncall.get_response(page_id)
    assert resp.status_code == 200, resp.text
    return resp.json()["response"]


@pytest.fixture
def people(client: OpenObserveClient, oncall_org: str,
           oncall: OnCallClient) -> Callable[[int], list[tuple[str, OpenObserveClient]]]:
    def _make(count: int) -> list[tuple[str, OpenObserveClient]]:
        made = []
        for _ in range(count):
            email, as_user = make_user(client, oncall_org, "user")
            oncall.users.append(email)
            made.append((email, as_user))
        return made

    return _make


def test_ent3197_a_stale_schedule_save_cannot_put_people_off_the_team_back_on_call(
        oncall: OnCallClient, people: Callable):
    (ann, _), (leo, _) = people(2)
    team = oncall.staffed_team([ann, leo])
    opened_before_removal = oncall.get_schedule(team).json()["rotations"]
    assert leo in opened_before_removal[0]["shift_rules"][0]["members"], opened_before_removal

    assert oncall.remove_member(team, leo).status_code == 200
    stranger = "never-in-this-org@test.invalid"
    opened_before_removal[0]["shift_rules"][0]["members"].append(stranger)

    resp = oncall.set_schedule(team, opened_before_removal)
    assert resp.status_code == 400, f"the stale save was accepted: {resp.status_code} {resp.text}"
    assert resp.text.count(leo) == 1, resp.text
    assert resp.text.count(stranger) == 1, resp.text

    stored = oncall.get_schedule(team).text
    assert leo not in stored, stored
    assert stranger not in stored, stored

    primary = oncall.primary_rotation_id(team)
    assert oncall.set_policy(team, [steps_ladder([(RUNG_NOW, [rotation_target(primary), WHOLE_TEAM])])]).status_code == 200
    page = oncall.open_pages_for([team])[0]
    wait_for_landed(oncall, page["id"], {ann})
    assert everyone_tried(oncall, page["id"]) == {ann}


def test_ent3198_a_whole_team_step_skips_the_person_marked_away(oncall: OnCallClient, people: Callable):
    (away, _), (here, _) = people(2)
    team = oncall.staffed_team([away, here])
    assert oncall.set_policy(team, [steps_ladder([(RUNG_NOW, [WHOLE_TEAM])])]).status_code == 200
    mark_away(oncall, away)

    page = oncall.open_pages_for([team])[0]
    wait_for_landed(oncall, page["id"], {here})
    assert everyone_tried(oncall, page["id"]) == {here}


def test_ent3198_a_step_naming_someone_away_does_not_page_them(oncall: OnCallClient, people: Callable):
    (away, _), (here, _) = people(2)
    team = oncall.staffed_team([away, here])
    targets = [user_target(away), user_target(here)]
    assert oncall.set_policy(team, [steps_ladder([(RUNG_NOW, targets)])]).status_code == 200
    mark_away(oncall, away)

    page = oncall.open_pages_for([team])[0]
    wait_for_landed(oncall, page["id"], {here})
    assert everyone_tried(oncall, page["id"]) == {here}


def _acknowledged_by_a_member(oncall: OnCallClient, people: Callable) -> tuple[str, str, str, str]:
    """A two-person team whose page one of them has acknowledged; the state ENT#3199 starts from."""
    (eve, as_eve), (cy, _) = people(2)
    team = oncall.staffed_team([eve, cy])
    assert oncall.set_policy(team, [steps_ladder([(RUNG_NOW, [WHOLE_TEAM])])]).status_code == 200
    page = oncall.open_pages_for([team])[0]
    wait_for_landed(oncall, page["id"], {eve, cy})

    ack = OnCallClient(as_eve, oncall.org).acknowledge(page["id"])
    assert ack.status_code == 200, ack.text
    held = page_record(oncall, page["id"])
    assert held["state"] == "acknowledged", held
    assert held["acked_by"] == eve, held
    return team, page["id"], eve, cy


def _assert_back_with_the_team(oncall: OnCallClient, page_id: str, eve: str, cy: str, because: str) -> None:
    record = page_record(oncall, page_id)
    assert record["state"] == "triggered", record
    assert not record.get("acked_by"), record
    assert any(because in line and eve in line for line in timeline(oncall, page_id)), timeline(oncall, page_id)

    # Released pages start a new ladder run, so a delivery in that run proves the team is being chased again.
    new_run = record["ladder_run"]
    assert new_run > 1, record
    rows = wait_for_landed(oncall, page_id, {cy}, run=new_run)
    assert eve not in {r.get("recipient") for r in rows}, rows


def test_ent3199_removing_the_acknowledger_from_the_team_hands_the_page_back(
        oncall: OnCallClient, people: Callable):
    team, page_id, eve, cy = _acknowledged_by_a_member(oncall, people)

    assert oncall.remove_member(team, eve).status_code == 200

    _assert_back_with_the_team(oncall, page_id, eve, cy, "was removed from the team")


def test_ent3199_removing_the_acknowledger_from_the_org_hands_the_page_back(
        client: OpenObserveClient, oncall: OnCallClient, people: Callable):
    _team, page_id, eve, cy = _acknowledged_by_a_member(oncall, people)

    resp = client.users.delete(eve, org=oncall.org)
    assert resp.status_code == 200, resp.text

    _assert_back_with_the_team(oncall, page_id, eve, cy, "left the organization")


def test_ent3200_a_removed_member_is_not_paged_by_the_step_that_names_them(
        oncall: OnCallClient, people: Callable):
    (ana, _), (ben, _), (cy, _) = people(3)
    team = oncall.staffed_team([ana, ben, cy])
    ben_step, last_step = 30 * MICROS, 60 * MICROS
    assert oncall.set_policy(team, [steps_ladder([
        (RUNG_NOW, [user_target(ana)]),
        (ben_step, [user_target(ben)]),
        (last_step, [WHOLE_TEAM]),
    ])]).status_code == 200
    assert oncall.remove_member(team, ben).status_code == 200

    page = oncall.open_pages_for([team])[0]
    rows = wait_for_landed(oncall, page["id"], {ana, cy}, timeout=LADDER_TIMEOUT + 60)

    assert ben not in everyone_tried(oncall, page["id"]), rows
    fired = oncall.escalation(page["id"]).json()["fired"]
    assert ben_step not in {r.get("rung_micros") for r in rows}, rows
    assert not [f for f in fired if ben in (f.get("reached") or [])], fired


def test_ent3200_a_save_blocked_by_a_removed_member_names_the_priority_and_step(
        oncall: OnCallClient, people: Callable):
    (ana, _), (ben, _) = people(2)
    team = oncall.staffed_team([ana, ben])
    rungs = [steps_ladder([(RUNG_NOW, [user_target(ana)]), (2 * 60 * MICROS, [user_target(ben)])], priority=2)]
    assert oncall.set_policy(team, rungs).status_code == 200
    assert oncall.remove_member(team, ben).status_code == 200

    p4_change = rungs + [steps_ladder([(RUNG_NOW, [WHOLE_TEAM])], priority=4)]
    resp = oncall.set_policy(team, p4_change)

    assert resp.status_code == 400, resp.text
    assert f"`{ben}` (P2, step at +2m) is not a member of this team" in resp.text, resp.text


def test_ent3202_a_first_step_that_reaches_nobody_moves_on_at_once(oncall: OnCallClient, people: Callable):
    (one, _), (two, _) = people(2)
    team = oncall.staffed_team([one, two])
    primary = oncall.primary_rotation_id(team)
    assert oncall.set_policy(team, [steps_ladder([
        (RUNG_NOW, [rotation_target(primary)]),
        (RUNG_LATER, [WHOLE_TEAM]),
    ])]).status_code == 200
    mark_away(oncall, one)
    mark_away(oncall, two)

    page = oncall.open_pages_for([team])[0]

    # Everyone is away, so the whole-team step is the last resort; its 30-minute delay cannot elapse inside this wait.
    rows = wait_for_landed(oncall, page["id"], {one, two})
    assert {r.get("rung_micros") for r in rows} == {RUNG_LATER}, rows


class _SilentAgentHandler(BaseHTTPRequestHandler):
    """An AI agent that is healthy, accepts the investigation and never answers, so a triage hold runs its whole budget."""

    def log_message(self, *_args: Any) -> None:
        pass

    def do_GET(self) -> None:
        self.send_response(200 if self.path.endswith("/health") else 404)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", "2")
        self.end_headers()
        self.wfile.write(b"{}")

    def do_POST(self) -> None:
        self.rfile.read(int(self.headers.get("Content-Length") or 0))
        self.server.queried.set()
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        self.wfile.flush()
        self.server.release.wait()


@pytest.fixture
def silent_agent() -> Generator[threading.Event, None, None]:
    """Listens where the shard's O2_AGENT_URL points; yields the event set once the server asked it to investigate."""
    server = ThreadingHTTPServer(("127.0.0.1", AGENT_PORT), _SilentAgentHandler)
    server.daemon_threads = True
    server.queried = threading.Event()
    server.release = threading.Event()
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server.queried
    finally:
        server.release.set()
        server.shutdown()
        server.server_close()


def test_ent3201_the_next_step_counts_from_the_first_page_not_from_the_ai_hold(
        oncall: OnCallClient, people: Callable, silent_agent: threading.Event):
    (priya, _), (arjun, _) = people(2)
    team = oncall.staffed_team([priya, arjun])
    defaults = oncall.get_policy(team).json()["l0"]
    budget = {**defaults, "triage_budget_seconds": MIN_TRIAGE_BUDGET_S}
    assert oncall.set_policy(team, [steps_ladder([
        (RUNG_NOW, [user_target(priya)]),
        (GATED_RUNG_S * MICROS, [user_target(arjun)]),
    ], priority=2)], l0=budget).status_code == 200

    page = oncall.open_pages_for([team], priority=2)[0]
    assert silent_agent.wait(timeout=30), (
        "the server never asked the agent to investigate, so nothing held this page: start it with "
        f"O2_INCIDENTS_RCA_ENABLED=true and O2_AGENT_URL=http://127.0.0.1:{AGENT_PORT}")

    rows = wait_for_landed(oncall, page["id"], {priya, arjun},
                           timeout=MIN_TRIAGE_BUDGET_S + GATED_RUNG_S + LADDER_TIMEOUT)
    at = {r["recipient"]: r["at"] for r in rows}
    held_for = (at[priya] - page_record(oncall, page["id"])["opened_at"]) / MICROS
    gap = (at[arjun] - at[priya]) / MICROS

    # Positive control: without a real hold the two clocks coincide and the gap below would prove nothing.
    assert held_for >= MIN_TRIAGE_BUDGET_S - EARLY_TOLERANCE_S, f"the first page was not held: {held_for}s"
    assert gap >= GATED_RUNG_S - EARLY_TOLERANCE_S, (
        f"the first person got {gap}s instead of the step's {GATED_RUNG_S}s (held {held_for}s)")
