"""On-Call — schedules, covers, and whether a page would actually land.

Covers plan §7 (reachability reads the delivery ledger) and the API half of §8
(schedules, rotations and covers) of
docs/test_generator/features/oncall-test-plan.md. §8.1 — that an all-day
restriction renders `00:00 / 24:00` rather than `00:00 / 00:00` — is a
rendering assertion and belongs to the Playwright suite; what is asserted here
is the server side of the same boundary, which is that `0 → 1440` is accepted
and `0 → 0` is not.

The `end_minute` rules are worth stating exactly, because two of the three
plausible readings are wrong. `start_minute` is inclusive and `end_minute` is
exclusive, `end_minute` may be **1440** (an all-day window), and it may be LESS
than `start_minute`, which means the window wraps midnight — a 22:00–06:00
night shift is `start_minute: 1320, end_minute: 360` and is perfectly legal. So
"ending at minute 0" is only invalid when it is also STARTING at minute 0: that
window applies at no instant at all, which is what §8.2 refuses.

§7's two-failure threshold is deliberate, and §7.2 exists to guard it against
being tightened: one blip must not bench somebody who is holding the pager.
Producing a *recorded* delivery failure needs a transport that is configured
and fails, which is what the helper's dead destination (a closed port on
loopback) is for. Where the deployment cannot deliver to a member at all — no
SMTP, no webhook — a degradation caused by failures cannot be told apart from
one caused by there being no transport, and those tests skip with that reason
rather than asserting something they cannot see. That is a real gap in coverage
on an SMTP-less instance and is called out rather than papered over.
"""
from __future__ import annotations

import logging

import json

import pytest

from support.client import OpenObserveClient
from support.wait import WaitTimeout

from .oncall_helpers import (
    DEAD_DEST,
    MINUTES_PER_DAY,
    OnCallClient,
    ladder,
    make_user,
    micros_from_now,
    rotation,
    rotation_target,
    shift_rule,
    uniq,
    user_target,
)
from .oncall_helpers import failed_recipients as failures_in

logger = logging.getLogger(__name__)

# The whole feature needs an enterprise build with `O2_ONCALL_ENABLED`; the
# marker lets CI hold this directory separately, and the session-scoped gate
# in conftest skips it rather than failing when the flag is off.
pytestmark = pytest.mark.enterprise

ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]

# The threshold plan §7 is about: reachability degrades on the SECOND
# consecutive failure, never the first.
DEGRADE_AFTER = 2


# =============================================================================
# Fixtures
# =============================================================================

@pytest.fixture(scope="module")
def rota_member(client: OpenObserveClient, oncall: OnCallClient, oncall_org: str) -> str:
    email, _unused = make_user(client, oncall_org, "user")
    oncall.users.append(email)
    return email


@pytest.fixture(scope="module")
def rota_team(oncall: OnCallClient, rota_member: str) -> str:
    """A staffed team. The roster is what auto-creates `Primary` and
    `Secondary`, so a team with no members has no rotations to edit."""
    return oncall.staffed_team([rota_member])


def member_verdict(oncall: OnCallClient, team_id: str, email: str) -> dict | None:
    resp = oncall.reachability(team_id)
    assert resp.status_code == 200, resp.text
    for member in resp.json().get("members", []):
        if (member.get("user_email") or "").lower() == email.lower():
            return member
    return None


def one_rotation(rotation_id: str, members: list[str], **kw) -> list[dict]:
    """A schedule body with a single named rotation."""
    return [rotation(rotation_id, "Primary",
                     [shift_rule("Base rotation", members, **kw)])]


def team_with_one_rotation(oncall: OnCallClient, member: str) -> tuple[str, str]:
    """A staffed team, and the id of the rotation it already has.

    Adding the first member auto-provisions a rotation AND repoints the
    escalation policy's rungs at it, so a `PUT /schedule` that invents a fresh
    rotation id drops the one the ladder names and is refused — a refusal about
    the ladder, which has nothing to do with what §8 is testing. Editing the
    rotation the team already has is both what the UI does and the only way a
    restriction assertion is about the restriction.
    """
    team = oncall.team_id(uniq("oncall_pt_sched"))
    assert oncall.add_member(team, member).status_code == 200
    rotation_id = oncall.primary_rotation_id(team)
    assert rotation_id, "adding a member must auto-provision a rotation to edit"
    return team, rotation_id


# =============================================================================
# §8 — schedules, rotations and covers
# =============================================================================

def test_an_all_day_restriction_is_accepted(oncall: OnCallClient, rota_member: str):
    """§8.1, server side — `0 → 1440` is the all-day window, and it saves.

    The counterpart to §8.2 below: the two differ only in the end minute, so
    asserting the refusal without asserting the acceptance would be consistent
    with the server rejecting both.
    """
    team, rotation_id = team_with_one_rotation(oncall, rota_member)
    rotations = one_rotation(
        rotation_id, [rota_member],
        restrictions=[{"days": ALL_DAYS, "start_minute": 0,
                       "end_minute": MINUTES_PER_DAY}])
    resp = oncall.set_schedule(team, rotations)
    assert resp.status_code == 200, resp.text


def test_a_restriction_that_applies_at_no_instant_is_refused(
        oncall: OnCallClient, rota_member: str):
    """§8.2 — a window that starts and ends at the same minute covers nothing.

    Written as `0 → 0`, the mistake the UI makes when it renders an all-day
    window: it looks like midnight-to-midnight and is in fact zero length. A
    window ending at minute 0 that STARTED later is a different thing entirely
    — it wraps midnight — and is not asserted here, because it is legal.
    """
    team, rotation_id = team_with_one_rotation(oncall, rota_member)
    rotations = one_rotation(
        rotation_id, [rota_member],
        restrictions=[{"days": ALL_DAYS, "start_minute": 0, "end_minute": 0}])
    resp = oncall.set_schedule(team, rotations)
    assert resp.status_code == 400, f"{resp.status_code} {resp.text}"
    # A bare 400 would also be earned by an unrelated refusal — an orphaned
    # ladder, a bad member — so the window has to be named for this to assert it.
    assert "no instant" in resp.text, resp.text


def test_a_shift_rule_with_no_members_is_refused(
        oncall: OnCallClient, rota_member: str):
    """§8.6 — a rule with an empty roster puts nobody on call, ever.

    It is the one state that looks configured on a calendar and pages no one,
    which is precisely why it has to be refused at write rather than discovered
    at 3am.
    """
    team = oncall.team_id(uniq("oncall_pt_norota"))
    assert oncall.add_member(team, rota_member).status_code == 200
    resp = oncall.set_schedule(team, one_rotation(uniq("rot"), []))
    assert resp.status_code == 400, f"{resp.status_code} {resp.text}"
    # Named for the same reason as §8.2: this write is also refusable for having
    # dropped the rotation the ladder points at, and a bare 400 cannot tell the
    # two apart. Roster validation wins today; the assertion is what keeps it
    # this test's subject if that order ever changes.
    assert "at least one member" in resp.text, resp.text


def test_a_cover_for_a_member_is_stored_against_a_rotation(
        oncall: OnCallClient, rota_team: str, rota_member: str):
    """§8.3 — a cover names a rotation for the same reason an escalation level
    does: a cover is "stand in for this position", and a position is a rotation.

    `rotation_id` is asserted because a cover stored without one stands over
    nothing, which is the shape of the `oncall_overrides.rotation_id` outage
    §8.4 smoke-tests.
    """
    # Deliberately a future window: a second cover later in this module has to
    # be live NOW, and two covers over one rotation must not overlap.
    resp = oncall.create_override(rota_team, rota_member,
                                  start_at=micros_from_now(hours=6),
                                  end_at=micros_from_now(hours=8))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body.get("rotation_id"), f"a cover must stand over a rotation: {body}"
    assert (body.get("user_email") or "").lower() == rota_member.lower()


@pytest.mark.parametrize("route", ["load", "overrides", "resolved_schedule"])
def test_the_migrated_schedule_reads_answer(
        oncall: OnCallClient, rota_team: str, route: str):
    """§8.4 — a smoke test over the three reads that broke together.

    Confirmed environment-only at the time (an already-applied migration had
    been edited), and kept anyway because the symptom is worth catching early:
    a raw SeaORM error string, SQL fragments and all, shown to the user as a
    toast.
    """
    if route == "load":
        resp = oncall.load(rota_team)
    elif route == "overrides":
        resp = oncall.list_overrides(rota_team)
    else:
        resp = oncall.resolved_schedule(rota_team)
    assert resp.status_code == 200, f"{route}: {resp.status_code} {resp.text}"


def test_replacing_a_schedule_cannot_orphan_a_rotation_the_policy_names(
        oncall: OnCallClient, rota_member: str):
    """§8.5 — a schedule PUT is a FULL replace, so dropping a rotation an
    escalation level points at would silently leave that level paging nobody.

    The refusal is the feature: the operator is told to keep the rotation or
    edit the policy first, rather than discovering the hole when a rung fires.
    Only the status and the fact that the message is about a rotation are
    asserted — the exact sentence was not verified against a running build.
    """
    team = oncall.staffed_team([rota_member], name=uniq("oncall_pt_orphan"))
    named = oncall.primary_rotation_id(team)
    assert named, "a staffed team auto-creates a Primary rotation to point at"

    policy = oncall.set_policy(
        team, [ladder([rotation_target(named)])])
    assert policy.status_code == 200, policy.text

    # A different rotation id, so the named one is absent from the replacement.
    resp = oncall.set_schedule(team, one_rotation(uniq("other_rot"), [rota_member]))
    assert resp.status_code == 400, f"{resp.status_code} {resp.text}"
    assert "rotation" in resp.text.lower(), resp.text


# =============================================================================
# §7 — reachability reads the delivery ledger
# =============================================================================

def test_the_escalation_preview_agrees_with_reachability(
        oncall: OnCallClient, rota_team: str, rota_member: str):
    """§7.3, the half that holds on any deployment.

    `would_a_page_land` is answered in two places — per member on
    `/reachability`, and per rung recipient on `/escalation-preview` — and the
    two disagreeing is how a team reads "covered" on one screen and "nobody
    would be reached" on another. One boolean, two readers.
    """
    assert oncall.set_policy(
        rota_team, [ladder([user_target(rota_member)], channels=["email"])]
    ).status_code == 200

    verdict = member_verdict(oncall, rota_team, rota_member)
    assert verdict is not None, "the roster member must appear in reachability"

    preview = oncall.escalation_preview(rota_team, priority=1)
    assert preview.status_code == 200, preview.text
    recipients = [r for rung in preview.json().get("rungs", [])
                  for r in rung.get("recipients", [])
                  if (r.get("user_email") or "").lower() == rota_member.lower()]
    assert recipients, f"the rung targets {rota_member} and must list them"
    for recipient in recipients:
        assert recipient.get("would_a_page_land") == verdict.get("would_a_page_land"), (
            f"preview says {recipient}, reachability says {verdict}")


def test_a_preview_for_a_transport_that_can_deliver_nothing_says_so(
        oncall: OnCallClient, rota_team: str, rota_member: str):
    """§7.3 — the loudest finding a preview can report.

    Reachable only on a deployment with no SMTP, which is the ordinary state of
    a test instance: with the ladder set to the email channel alone, nothing
    the preview describes can reach a human, and it has to say so rather than
    drawing a ladder that looks configured.
    """
    reach = oncall.reachability(rota_team)
    assert reach.status_code == 200, reach.text
    if reach.json().get("smtp_configured"):
        pytest.skip("SMTP is configured here, so the email channel can deliver")

    assert oncall.set_policy(
        rota_team, [ladder([user_target(rota_member)], channels=["email"])]
    ).status_code == 200

    preview = oncall.escalation_preview(rota_team, priority=1)
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body.get("reaches_nobody") is True, body
    for rung in body.get("rungs", []):
        for recipient in rung.get("recipients", []):
            assert recipient.get("would_a_page_land") is False, recipient


@pytest.fixture(scope="module")
def failing_team(oncall: OnCallClient, rota_member: str) -> dict:
    """A team whose only transport is a destination that cannot be reached.

    Two rungs to the same person: the first fires with the record and the
    second is reachable on demand via `escalate`, which is how a SECOND
    consecutive failure is produced inside a test run without waiting for a
    second firing.
    """
    team = oncall.staffed_team([rota_member], name=uniq("oncall_pt_failing"))
    baseline = member_verdict(oncall, team, rota_member)
    assert oncall.set_policy(
        team,
        [ladder([user_target(rota_member)], channels=["webhook"],
                delays=[0, 30 * 60 * 1_000_000])],
        destinations=[DEAD_DEST]).status_code == 200
    page = oncall.open_pages_for([team])[0]
    return {"team": team, "page": page, "baseline": baseline}


def test_a_single_delivery_failure_does_not_bench_a_responder(
        oncall: OnCallClient, failing_team: dict, rota_member: str):
    """§7.2 — the guard on the threshold. One blip is not a pattern.

    Skipped rather than asserted when the member was already unreachable before
    any page was sent: a degradation caused by two failures cannot be told
    apart from one caused by there being no transport at all, and asserting
    into that ambiguity would produce a test that passes for the wrong reason.
    """
    if not (failing_team["baseline"] or {}).get("would_a_page_land"):
        pytest.skip("this member is unreachable before any failure; "
                    "a failure-driven degradation cannot be isolated here")

    ledger = oncall.wait_for_deliveries(failing_team["page"]["id"])
    mine = [r for r in failures_in(ledger) if r and rota_member.lower() in r.lower()]
    # NOT a skip. `failing_team` routes through DEAD_DEST, a destination that
    # cannot be reached, so exactly one recorded failure is deterministic by
    # construction — nothing about a deployment changes it. Skipping here turns a
    # broken delivery ledger into a green run, which is the failure this whole
    # section exists to catch.
    assert len(mine) == 1, (
        f"expected exactly one recorded failure against {rota_member}, got {len(mine)}. "
        "The destination is unreachable by construction, so this is the delivery "
        f"ledger not recording failures, not an environment difference: {ledger}")

    verdict = member_verdict(oncall, failing_team["team"], rota_member)
    assert verdict.get("would_a_page_land") is True, (
        f"one failure must not bench a responder: {verdict}")


def test_two_consecutive_failures_drop_a_responder_out_of_reachable(
        oncall: OnCallClient, failing_team: dict, rota_member: str):
    """§7.1 — the second failure, forced by reaching the next rung by hand.

    `escalate` is used rather than a second firing because it dispatches the
    next rung immediately and to the same person: two firings would be two
    records, and "consecutive" is a property of one responder's ledger, not of
    one page.
    """
    if not (failing_team["baseline"] or {}).get("would_a_page_land"):
        pytest.skip("this member is unreachable before any failure; "
                    "a failure-driven degradation cannot be isolated here")

    resp = oncall.escalate(failing_team["page"]["id"])
    assert resp.status_code == 200, resp.text

    # A timeout here is not a failure of the product: it means this deployment
    # cannot record a second attempt against the member, which the skip below
    # reports honestly rather than asserting into.
    try:
        ledger = oncall.wait_for_deliveries(failing_team["page"]["id"],
                                            count=DEGRADE_AFTER)
    except WaitTimeout:
        ledger = oncall.deliveries(failing_team["page"]["id"]).json()
    mine = [r for r in failures_in(ledger) if r and rota_member.lower() in r.lower()]
    # NOT a skip, for the same reason as above: DEAD_DEST guarantees the failures.
    assert len(mine) >= DEGRADE_AFTER, (
        f"expected at least {DEGRADE_AFTER} recorded failures against {rota_member}, "
        f"got {len(mine)}. The destination is unreachable by construction, so a short "
        f"count means the ledger stopped recording failures: {ledger}")

    verdict = member_verdict(oncall, failing_team["team"], rota_member)
    assert verdict.get("would_a_page_land") is False, (
        f"two consecutive failures must bench a responder: {verdict}")

    risks = oncall.config_risks(failing_team["team"])
    assert risks.status_code == 200, risks.text
    # `{"risks": []}` is truthy, so asserting the payload alone passes when NO risk
    # was raised — the opposite of what the name claims. Name the member: a risk
    # about somebody else is not this one.
    body = risks.json()
    raised = body.get("risks") if isinstance(body, dict) else body
    assert raised, f"a benched responder must raise a config risk, got none: {body}"
    assert any(rota_member in json.dumps(r) for r in raised), (
        f"a risk was raised but none of them names the benched responder "
        f"{rota_member}: {raised}")


def test_a_cover_moves_who_is_on_call(oncall: OnCallClient, rota_team: str,
                                      rota_member: str):
    """§8 — a cover outranks every layer, which is why §1.6 refuses one naming
    a stranger. Asserted here so the refusal has a working case beside it."""
    resp = oncall.create_override(
        rota_team, rota_member,
        start_at=micros_from_now(minutes=-1), end_at=micros_from_now(hours=2))
    assert resp.status_code == 200, resp.text

    positions = oncall.on_call(rota_team)
    assert positions.status_code == 200, positions.text
    covered = [p for p in positions.json() if p.get("override_id")]
    assert covered, f"the cover is live now and must show as one: {positions.text}"
    assert (covered[0].get("user_email") or "").lower() == rota_member.lower()
