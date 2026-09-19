"""On-Call — routing and fan-out: which team a signal wakes, and how many.

Covers plan §5 of docs/test_generator/features/oncall-test-plan.md.

This section exists because of a **withdrawn** bug report, and that is the point
of it. "A grouped alert pages only one team" was filed during the manual pass
and then withdrawn: the alert was on `Simple alert` aggregation, whose own help
text reads *"Groups are collapsed into a single result."* One page was correct.
So the tests below pin BOTH halves of the distinction — `multi_alert: true` fans
out one page per owning group, `aggregation: null` produces exactly one — and
neither half is the "right" answer on its own. Pinning only the fan-out would
let the collapse regress into fan-out unnoticed, which is how the false report
happened in the first place.

§5.3 is a second regression guard, over `fix(oncall): a deterministic order
decides which team is woken`. The manual pass observed the collapsed row — and
therefore the team that got woken — being taken from whatever the database
returned first, with no `ORDER BY`. A single run cannot see that; two runs over
identical data can.

Two tools are used deliberately differently. `POST /oncall/routing/preview` is a
dry run: it decides with the real engine, reports the rules that matched and
lost, changes nothing and needs no scheduler, so precedence (§5.5) is asserted
there. Fan-out (§5.1–§5.4) is a fact about pages that were really opened, so
those wait on real firings.

Ownership rules name the hyphenated dimension ALIAS (`k8s-namespace`), while the
rows and the alert's `group_by` name the underlying COLUMN
(`k8s_namespace_name`). The two are joined by the org's semantic field groups,
not by string equality, and the column must be one only ONE group claims: the
bare `namespace` is claimed by `service-namespace` as well, and that group wins,
so a rule on `k8s-namespace` would never match a row keyed on it. See
`COL_NAMESPACE` in the helpers.
"""
from __future__ import annotations

import logging

import pytest

from support.wait import WaitTimeout

from .oncall_helpers import (
    COL_NAMESPACE,
    COL_SERVICE,
    DIM_NAMESPACE,
    DIM_SERVICE,
    SINK_DEST,
    OnCallClient,
    group_aggregation,
    paging_alert,
    uniq,
)

logger = logging.getLogger(__name__)

# The whole feature needs an enterprise build with `O2_ONCALL_ENABLED`; the
# marker lets CI hold this directory separately, and the session-scoped gate
# in conftest skips it rather than failing when the flag is off.
pytestmark = pytest.mark.enterprise

# Two owning namespaces and one nobody claims, all three uniquified. The owned
# pair needs it as much as the unowned one: an ownership path is unique per org,
# so a fixed value left behind by a run that died before its sweep makes the
# `owners` fixture answer 409 for every run after it, forever.
NS_A = uniq("payments")
NS_B = uniq("search")


# =============================================================================
# Fixtures
# =============================================================================

@pytest.fixture(scope="module")
def owners(oncall: OnCallClient) -> dict[str, str]:
    """Two teams, each owning one namespace."""
    team_a = oncall.team_id(uniq("oncall_pt_own_a"))
    team_b = oncall.team_id(uniq("oncall_pt_own_b"))
    assert oncall.create_ownership(team_a, {DIM_NAMESPACE: NS_A}).status_code == 200
    assert oncall.create_ownership(team_b, {DIM_NAMESPACE: NS_B}).status_code == 200
    return {"a": team_a, "b": team_b}


@pytest.fixture(scope="module")
def fanout(oncall: OnCallClient, owners: dict[str, str]) -> dict[str, object]:
    """One stream spanning both owners, and four alerts over it, fired together.

    The four are created before any page is waited for, so the whole section
    costs one scheduler cycle:

      multi     — `multi_alert: true`, the fan-out half of §5.1
      simple    — `aggregation: null`, the collapse half of §5.2
      twin      — identical to `simple`; the pair is what makes §5.3's
                  determinism observable at all
      unrouted  — a namespace no rule claims, for §5.4
    """
    stream = uniq("oncall_pt_route")
    # A stream of its own: the unrouted alert must see ONLY the unowned
    # namespace, or its collapsed row could be one an owner claims and the test
    # would be asserting the opposite of what it means to.
    orphan_stream = uniq("oncall_pt_orphan")
    orphan_ns = uniq("unowned")
    rows = [
        {"latency": 900, COL_SERVICE: "checkout", COL_NAMESPACE: NS_A},
        {"latency": 950, COL_SERVICE: "search-api", COL_NAMESPACE: NS_B},
    ]
    orphan_rows = [{"latency": 990, COL_SERVICE: "nobody", COL_NAMESPACE: orphan_ns}]
    oncall.seed_rows(stream, rows)
    oncall.seed_rows(orphan_stream, orphan_rows)

    def _create(name: str, aggregation: dict | None, on: str = stream) -> str:
        # No `oncall_team`: an alert that names its team explicitly short-circuits
        # routing, and ownership rules then never get a say. A destination is
        # still required — an alert with no destination, no workflow and no team
        # is refused at save (§4.2).
        payload = paging_alert(uniq(name), on, destinations=[SINK_DEST],
                               aggregation=aggregation)
        resp = oncall.create_alert(payload)
        assert resp.status_code == 200, resp.text
        return resp.json()["id"]

    multi = _create("oncall_pt_multi",
                    group_aggregation([COL_NAMESPACE], multi_alert=True))
    simple = _create("oncall_pt_simple", None)
    twin = _create("oncall_pt_twin", None)
    unrouted = _create("oncall_pt_unrouted", None, on=orphan_stream)

    oncall.seed_rows(stream, rows)
    oncall.seed_rows(orphan_stream, orphan_rows)

    # Waited on here so the whole module shares one cycle, but best-effort: a
    # fan-out that never happened is §5.1's FAILURE, and a fixture that raised
    # would report it as a collection error against every test in the file.
    try:
        multi_pages = oncall.wait_for_pages(multi, count=2)
    except WaitTimeout:
        multi_pages = oncall.pages_for(multi)
    return {
        "stream": stream, "orphan_ns": orphan_ns,
        "multi": multi, "multi_pages": multi_pages,
        "simple": simple, "twin": twin, "unrouted": unrouted,
    }


# =============================================================================
# §5 — fan-out and collapse
# =============================================================================

def test_a_multi_alert_pages_each_owning_group(
        oncall: OnCallClient, owners: dict[str, str], fanout: dict):
    """§5.1 — `multi_alert: true` over a result set spanning two owners opens
    one page per owning group, and each lands on the team that owns it."""
    pages = fanout["multi_pages"]
    assert len(pages) >= 2, f"expected a page per owning group, got {len(pages)}"

    paged_teams = {p.get("team_id") for p in pages}
    assert {owners["a"], owners["b"]} <= paged_teams, (
        f"both owners must have been woken; woke {paged_teams}")


def test_a_simple_alert_collapses_its_groups_into_one_page(
        oncall: OnCallClient, fanout: dict):
    """§5.2 — the same data, `aggregation: null`, exactly one page.

    "Exactly one" is only meaningful once a second page would have had time to
    appear. The `multi` alert's second page is that synchronisation point: it
    was created first, evaluates on the same cadence, and has already arrived
    by the time this test runs.
    """
    oncall.wait_for_pages(fanout["simple"])
    pages = oncall.pages_for(fanout["simple"])
    assert len(pages) == 1, f"a collapsed alert opens one page, got {len(pages)}: {pages}"


def test_the_collapsed_team_choice_is_deterministic(
        oncall: OnCallClient, fanout: dict):
    """§5.3 — two identical Simple alerts over one multi-owner result set pick
    the same team.

    This is the guard over `fix(oncall): a deterministic order decides which
    team is woken`. Two alerts rather than two firings of one: the pair runs
    against byte-identical data in the same cycle, so any disagreement is the
    ordering and nothing else.
    """
    first = oncall.wait_for_pages(fanout["simple"])
    second = oncall.wait_for_pages(fanout["twin"])
    assert first[0].get("team_id"), (
        "both runs must have routed somewhere, or the comparison is vacuous")
    assert first[0]["team_id"] == second[0]["team_id"], (
        "two identical collapsed alerts woke different teams — the row the team "
        "is read from is not ordered")


def test_a_signal_nobody_owns_opens_a_teamless_page_that_can_be_closed(
        oncall: OnCallClient, fanout: dict):
    """§5.4 — nothing matched and there is no nominated catch-all.

    There is deliberately no auto-created fallback team: what does not route
    waits for an operator to nominate one. The record must still exist and must
    still be closable, or an org accumulates pages it has no way to answer.

    Skipped rather than forced when the org HAS a default team: clearing an
    org-wide setting would corrupt every other worker's run.
    """
    if oncall.default_team_id():
        pytest.skip("this org nominates a catch-all team; nothing can be unrouted")

    pages = oncall.wait_for_pages(fanout["unrouted"])
    teamless = [p for p in pages if not p.get("team_id")]
    assert teamless, f"expected a teamless page, got {[p.get('team_id') for p in pages]}"

    resp = oncall.resolve(teamless[0]["id"])
    assert resp.status_code == 200, resp.text


def test_the_more_specific_ownership_rule_wins(oncall: OnCallClient):
    """§5.5 — two rules match and one names strictly more of the identity.

    Asserted through the routing preview rather than a firing: the preview runs
    the real decision, reports the loser and the server's own sentence for why
    it lost, and costs no scheduler cycle. `also_matched` is checked because a
    winner alone cannot distinguish "the specific rule won" from "the general
    rule never matched".
    """
    broad_team = oncall.team_id(uniq("oncall_pt_broad"))
    narrow_team = oncall.team_id(uniq("oncall_pt_narrow"))
    namespace = uniq("ns")
    service = uniq("svc")

    assert oncall.create_ownership(
        broad_team, {DIM_NAMESPACE: namespace}).status_code == 200
    narrow = oncall.create_ownership(
        narrow_team, {DIM_NAMESPACE: namespace, DIM_SERVICE: service})
    assert narrow.status_code == 200, narrow.text

    resp = oncall.preview_routing({DIM_NAMESPACE: namespace, DIM_SERVICE: service})
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body.get("team_id") == narrow_team, (
        f"the two-dimension rule must outrank the one-dimension rule: {body}")
    assert body.get("decision", {}).get("kind") == "ownership", body

    also = body.get("also_matched") or []
    assert any(r.get("team_id") == broad_team for r in also), (
        f"the broader rule matched and lost, and must be reported as such: {also}")


def test_an_alert_that_names_its_team_overrides_every_rule(oncall: OnCallClient):
    """§5 — `oncall_team` is the highest-precedence tier, above ownership.

    Pinned alongside the precedence test because it is the reason §6's save-time
    warnings stay silent on an explicitly bound alert: ownership rules never get
    a say, so there is nothing to warn about.
    """
    owning_team = oncall.team_id(uniq("oncall_pt_owner"))
    named_team = oncall.team_id(uniq("oncall_pt_named"))
    namespace = uniq("ns")
    assert oncall.create_ownership(
        owning_team, {DIM_NAMESPACE: namespace}).status_code == 200

    resp = oncall.preview_routing({DIM_NAMESPACE: namespace}, oncall_team=named_team)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body.get("team_id") == named_team, body
    assert body.get("decision", {}).get("kind") == "explicit", body


def test_nothing_matching_and_no_catch_all_reports_unrouted(oncall: OnCallClient):
    """§5.4 — the decision itself, read without waiting on a firing.

    `landed_on_default` is the field that separates "nobody owns this" from
    "the org's fallback caught it"; collapsing the two is how a catch-all team
    silently starts absorbing everything.
    """
    if oncall.default_team_id():
        pytest.skip("this org nominates a catch-all team; nothing can be unrouted")

    resp = oncall.preview_routing({DIM_NAMESPACE: uniq("nobody-owns")})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body.get("decision", {}).get("kind") == "unrouted", body
    assert body.get("team_id") is None, body
    assert not body.get("landed_on_default"), body
