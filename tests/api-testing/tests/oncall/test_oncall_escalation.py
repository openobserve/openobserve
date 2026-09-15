"""On-Call — who a rung reached, and whether the ladder has anywhere left to go.

Covers plan §2 (who a rung reached) and §3 (an exhausted ladder says so) of
docs/test_generator/features/oncall-test-plan.md. Both are P1 regression
guards over shipped defects.

§2's defect is worth stating precisely, because the test only makes sense
against it: `progress` computed `reached` from `Delivery` rows, but loaded the
record through `list_events`, which is DEFINED by excluding exactly those rows.
So the set it computed over was always empty, and every rung of every page
reported `reached_nobody: true` no matter what the ledger said. The guard is
therefore an equality between two endpoints — `/escalation`'s `fired[].reached`
and `/deliveries`' `delivered: true` rows — rather than a hardcoded expectation
about who gets paged, which would go stale the moment a rota moved. That
equality is also channel-agnostic, which matters: a recipient on the email
channel is a person and a recipient on the webhook channel is a room, and the
invariant has to hold for both.

Delivery is made hermetic by the two Alert Destinations the helper seeds. The
sink posts back to this instance's own ingest endpoint, so a page down it
genuinely lands with no SMTP and no third party; the dead one points at a
closed port on loopback, so a page down it is a RECORDED failure — `delivered:
false`, which the model treats as a fact rather than as an absence — and that
is the only way to reach §2.3 deliberately.

§3's ladders are shaped by the team's escalation policy: one rung at +0s
exhausts as soon as it has fired, and a pair of rungs 30 minutes apart cannot
exhaust inside a test run, so "finished" and "still climbing" are two
configurations rather than two moments. Plan §3.2 — that the pages LIST reads
"Ladder finished — nobody left" rather than "Escalating" — is the UI half and
is not claimed here.
"""
from __future__ import annotations

import logging

import pytest

from support.client import OpenObserveClient

from .oncall_helpers import (
    DEAD_DEST,
    RUNG_LATER,
    RUNG_NOW,
    SINK_DEST,
    OnCallClient,
    delivered_recipients,
    ladder,
    make_user,
    user_target,
)

logger = logging.getLogger(__name__)

# The whole feature needs an enterprise build with `O2_ONCALL_ENABLED`; the
# marker lets CI hold this directory separately, and the session-scoped gate
# in conftest skips it rather than failing when the flag is off.
pytestmark = pytest.mark.enterprise


# =============================================================================
# Fixtures
# =============================================================================

@pytest.fixture(scope="module")
def responders(client: OpenObserveClient, oncall: OnCallClient,
               oncall_org: str) -> list[str]:
    """Two org accounts to page. Two, because plan §2.1 is about a rung that
    addresses more than one person — a single-recipient rung would satisfy the
    equality trivially."""
    emails = []
    for _ in range(2):
        email, _unused = make_user(client, oncall_org, "user")
        oncall.users.append(email)
        emails.append(email)
    return emails


@pytest.fixture(scope="module")
def ladders(oncall: OnCallClient, responders: list[str]) -> dict[str, dict]:
    """Three teams with deliberately different ladders, each with one open page.

    Built as one batch so the whole module pays a single scheduler cycle:

      delivers  — both responders on one rung, down a destination that works.
      dead      — one responder, down a destination that cannot be reached.
      climbing  — a second rung 30 minutes out, so the ladder is mid-climb for
                  the whole of this run.
    """
    delivers = oncall.staffed_team(responders)
    dead = oncall.staffed_team(responders[:1])
    climbing = oncall.staffed_team(responders[:1])

    both = [user_target(e) for e in responders]
    one = [user_target(responders[0])]
    # Email is listed first so a deployment WITH SMTP exercises the
    # person-addressed chain too; the webhook rung is what makes it land
    # without one. The invariant under test does not depend on which took it.
    assert oncall.set_policy(
        delivers, [ladder(both, channels=["email", "webhook"])],
        destinations=[SINK_DEST]).status_code == 200
    assert oncall.set_policy(
        dead, [ladder(one, channels=["webhook"])],
        destinations=[DEAD_DEST]).status_code == 200
    assert oncall.set_policy(
        climbing, [ladder(one, channels=["webhook"], delays=[RUNG_NOW, RUNG_LATER])],
        destinations=[SINK_DEST]).status_code == 200

    pages = oncall.open_pages_for([delivers, dead, climbing])
    return {
        "delivers": {"team": delivers, "page": pages[0]},
        "dead": {"team": dead, "page": pages[1]},
        "climbing": {"team": climbing, "page": pages[2]},
    }


def progress_of(oncall: OnCallClient, page_id: str) -> dict:
    resp = oncall.escalation(page_id)
    assert resp.status_code == 200, resp.text
    return resp.json()


def ledger_of(oncall: OnCallClient, page_id: str) -> dict:
    resp = oncall.deliveries(page_id)
    assert resp.status_code == 200, resp.text
    return resp.json()


# =============================================================================
# §2 — who a rung reached
# =============================================================================

def test_reached_equals_the_delivered_rows_in_the_ledger(
        oncall: OnCallClient, ladders: dict[str, dict]):
    """§2.1 — the regression guard, stated as an equality between two reads.

    Asserted per rung where the ledger keys a row to one (`rung_micros` lines
    the two shapes up) and again over the whole page, because the defect
    produced an empty `reached` at every level at once and either form would
    have caught it.
    """
    page_id = ladders["delivers"]["page"]["id"]
    oncall.wait_for_deliveries(page_id)
    ledger = ledger_of(oncall, page_id)
    progress = progress_of(oncall, page_id)

    fired = progress.get("fired") or []
    assert fired, "a page that has been dispatched has at least one fired rung"

    # A ledger row only carries `rung_micros` where the engine wrote one, so a
    # rung is compared individually only when the ledger actually keys rows to
    # it. The union below is the assertion that always holds.
    keyed = {row.get("rung_micros") for row in ledger.get("deliveries", [])}
    reached_overall: set[str] = set()
    for rung in fired:
        reached = set(rung.get("reached") or [])
        reached_overall |= reached
        if rung.get("after_micros") not in keyed:
            continue
        expected = delivered_recipients(ledger, rung_micros=rung.get("after_micros"))
        assert reached == expected, (
            f"rung {rung.get('after_micros')}: progress says {sorted(reached)}, "
            f"the ledger says {sorted(expected)}")

    assert reached_overall == delivered_recipients(ledger), (
        "the union of every rung's `reached` must be the whole set of landed "
        "deliveries — the defect made this empty while the ledger was full")


def test_a_rung_that_landed_is_not_reported_as_reaching_nobody(
        oncall: OnCallClient, ladders: dict[str, dict]):
    """§2.2 — `reached_nobody` is the badge a responder reads; the defect
    pinned it to true on every rung of every page.

    The assertion is conditional on the ledger, not on the environment: if this
    deployment could not deliver at all, that is §2.3's case and is asserted
    there rather than smuggled in as a pass here.
    """
    page_id = ladders["delivers"]["page"]["id"]
    oncall.wait_for_deliveries(page_id)
    ledger = ledger_of(oncall, page_id)
    landed = delivered_recipients(ledger)
    if not landed:
        pytest.skip("no delivery landed on this deployment; §2.3 covers that case")

    fired = progress_of(oncall, page_id).get("fired") or []
    landed_rungs = [r for r in fired if r.get("reached")]
    assert landed_rungs, "a page with landed deliveries has a rung that reached somebody"
    for rung in landed_rungs:
        assert rung.get("reached_nobody") is False, rung


def test_a_page_that_reached_nobody_says_so(oncall: OnCallClient, ladders: dict[str, dict]):
    """§2.3 — the other half. A rung with real recipients that the transport
    lost outright reports an empty `reached` AND `reached_nobody: true`.

    The two are not redundant: a rung that resolved to nobody at all is spent
    and gets no marker, while this one has not really been sent and the ladder
    keeps its place.
    """
    page_id = ladders["dead"]["page"]["id"]
    oncall.wait_for_deliveries(page_id)
    ledger = ledger_of(oncall, page_id)
    assert delivered_recipients(ledger) == set(), (
        "the dead destination must not have delivered anything")

    fired = progress_of(oncall, page_id).get("fired") or []
    assert fired, "the rung still fired — losing it to the transport is not not-firing"
    for rung in fired:
        assert (rung.get("reached") or []) == [], rung
        assert rung.get("reached_nobody") is True, rung


# =============================================================================
# §3 — an exhausted ladder says so
# =============================================================================

def test_a_ladder_with_nowhere_left_to_go_reports_exhausted(
        oncall: OnCallClient, ladders: dict[str, dict]):
    """§3.1 — one rung, nobody acknowledges, and the ladder runs out.

    `stopped_because` is asserted only for its presence. The plan says it names
    exhaustion; the exact sentence was not verified against a running build,
    and a substring assertion on a guessed phrase would fail a message that is
    perfectly correct.
    """
    page_id = ladders["dead"]["page"]["id"]
    progress = oncall.wait_for_exhausted(page_id)

    assert progress.get("exhausted") is True
    assert progress.get("next_targets") == [], "nobody is left to wake"
    assert progress.get("next_at") in (None, 0), progress
    assert progress.get("stopped_because"), "a finished ladder must say why it stopped"


def test_a_ladder_still_climbing_does_not_claim_to_be_finished(
        oncall: OnCallClient, ladders: dict[str, dict]):
    """§3.3 — the honest wording is per-state, and this is the state that must
    NOT read as finished: a rung has fired, another is due, nobody has answered.

    Its second rung is half an hour out, so this cannot race the exhaustion the
    previous test waits for.
    """
    page_id = ladders["climbing"]["page"]["id"]
    oncall.wait_for_deliveries(page_id)
    progress = progress_of(oncall, page_id)

    assert progress.get("exhausted") is False, progress
    assert progress.get("next_targets"), "a climbing ladder names who is next"
    assert progress.get("next_at"), "a climbing ladder says when"


def test_forcing_the_next_rung_advances_the_same_page(
        oncall: OnCallClient, ladders: dict[str, dict]):
    """§3 — `escalate` reaches the rung that was still 30 minutes away.

    Pinned because the verb reports what it DID in an envelope (`escalated_to`,
    plus the record under `response`) rather than answering with the bare
    record, and `ladder_exhausted` arrives as a 200: "there is nobody above
    you" is an answer, not a failure.
    """
    page_id = ladders["climbing"]["page"]["id"]
    before = len(progress_of(oncall, page_id).get("fired") or [])

    resp = oncall.escalate(page_id)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body.get("escalated_to"), "escalate reports what it did, not the bare record"
    assert body.get("response", {}).get("id") == page_id

    after = progress_of(oncall, page_id)
    if body["escalated_to"] == "ladder_exhausted":
        assert after.get("exhausted") is True
    else:
        assert len(after.get("fired") or []) > before, after
