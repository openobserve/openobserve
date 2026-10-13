"""On-Call — binding an alert to a team, and what save-time says about it.

Covers plan §4 (on-call paging as a destination in its own right) and §6
(save-time paging warnings) of
docs/test_generator/features/oncall-test-plan.md.

§4 is a small change with a large consequence. Paging is documented as additive
to destinations, but the "where does this go" check only ever knew about
destinations and workflows — so an alert whose entire purpose was to wake the
owning team could not be saved without also nominating a webhook nobody wanted.
Naming an on-call team IS naming somewhere for the alert to go, and §4.1 pins
that; §4.2 pins the other side, so the check cannot be loosened into accepting
an alert that goes nowhere at all.

§6 is advisory by design and the distinction is easy to lose: these are
**warnings on a 200**, not refusals. Routing is not being changed at save time,
and an operator who means it must still be able to save — so §6.3 asserts that
a warned alert is nonetheless stored and readable back. An empty warnings list
is never sent: the field is absent when there is nothing to say, because `[]`
reads as a claim that everything was checked and found clean.

The scope limits come from the implementation note and are asserted as limits,
not as gaps to be closed later: the warning covers **aggregating** alerts only,
and an alert bound to an explicit `oncall_team` is silent because ownership
rules never get a say on one.

Every §6 test takes `owned_namespace`, and that is a precondition rather than a
convenience. `paging_warnings` returns early on an org with NO ownership rules
at all — routing by the catch-all is then deliberate and unwarned — so without a
rule in place the warned tests see nothing to assert and, worse, the *unwarned*
tests pass having checked nothing. The fixture is what makes both verdicts real.

These are pure request/response assertions — nothing fires, nothing is waited
for — which is why they are the cheapest file in this directory.
"""
from __future__ import annotations

import logging

import pytest

from .oncall_helpers import (
    COL_NAMESPACE,
    DIM_NAMESPACE,
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

# A column no semantic field group maps to a dimension, so no ownership rule
# can ever match a group keyed on it — plan §6.1's "grouped on columns no
# ownership rule can match".
UNROUTABLE_COLUMN = "widget_colour"


# =============================================================================
# Fixtures
# =============================================================================

@pytest.fixture(scope="module")
def binding_team(oncall: OnCallClient) -> str:
    return oncall.team_id(uniq("oncall_pt_bind"))


@pytest.fixture(scope="module")
def binding_stream(oncall: OnCallClient) -> str:
    """A stream for the alerts to point at.

    Seeded once: none of these tests asserts anything about its contents — they
    only need the alerts to be savable — and a stream per test would put
    avoidable load on the indexer.
    """
    stream = uniq("oncall_pt_bind")
    oncall.seed_rows(stream, [{"latency": 900, COL_NAMESPACE: "payments",
                               UNROUTABLE_COLUMN: "teal"}])
    return stream


@pytest.fixture(scope="module")
def owned_namespace(oncall: OnCallClient) -> str:
    """A namespace an ownership rule claims, so §6.2 has something to match."""
    team = oncall.team_id(uniq("oncall_pt_warn_owner"))
    namespace = uniq("ns")
    assert oncall.create_ownership(team, {DIM_NAMESPACE: namespace}).status_code == 200
    return namespace


def warnings_of(resp) -> list[str]:
    """The advisories on a successful save. Absent means none — the field is
    omitted rather than sent empty, so `.get` with a default is correct here."""
    return (resp.json() or {}).get("warnings") or []


# =============================================================================
# §4 — on-call paging as a destination in its own right
# =============================================================================

def test_an_alert_may_page_a_team_with_no_destination_at_all(
        oncall: OnCallClient, binding_team: str, binding_stream: str):
    """§4.1 — `oncall_team` set, `destinations` empty, `workflows` empty.

    The read-back matters as much as the 200: `oncall_team` was for a while a
    column the API could never set, so a save that answered 200 and stored
    nothing would look identical from the create call alone.
    """
    payload = paging_alert(uniq("oncall_pt_bound"), binding_stream,
                           oncall_team=binding_team, destinations=[])
    payload["workflows"] = []
    resp = oncall.create_alert(payload)
    assert resp.status_code == 200, resp.text

    alert_id = resp.json().get("id")
    assert alert_id, "a successful create must return the new id"

    stored = oncall.get_alert(alert_id)
    assert stored.status_code == 200, stored.text
    assert stored.json().get("oncall_team") == binding_team, stored.text


def test_an_alert_that_goes_nowhere_is_refused(
        oncall: OnCallClient, binding_stream: str):
    """§4.2 — none of the three, and the save is refused by name."""
    payload = paging_alert(uniq("oncall_pt_nowhere"), binding_stream, destinations=[])
    payload["workflows"] = []
    resp = oncall.create_alert(payload)
    assert resp.status_code == 400, resp.text
    assert "destination or workflows is required" in resp.text.lower(), resp.text


def test_an_alert_naming_a_team_that_does_not_exist_is_refused(
        oncall: OnCallClient, binding_stream: str):
    """§4 — a mistyped or cross-tenant team id is caught at save.

    Not a loud failure later: routing takes `oncall_team` as its highest tier,
    finds no such team, and the page reaches nobody. Save is the one moment
    somebody is looking, so the id is checked there rather than at 3am.
    """
    payload = paging_alert(uniq("oncall_pt_ghost"), binding_stream,
                           oncall_team=uniq("no_such_team"), destinations=[])
    payload["workflows"] = []
    resp = oncall.create_alert(payload)
    assert resp.status_code == 400, resp.text
    assert "oncall_team" in resp.text, resp.text


# =============================================================================
# §6 — save-time paging warnings
# =============================================================================

def test_an_aggregating_alert_nobody_can_own_is_warned_about(
        oncall: OnCallClient, binding_stream: str, owned_namespace: str):
    """§6.1 — grouped on a column no ownership rule can ever match.

    The assertion is that the save is warned, not what the sentence says: the
    messages are server-written finished sentences meant to be rendered
    verbatim, and pinning their wording here would make a copy edit a test
    failure.

    `owned_namespace` is taken for its rule, not its value: an org with no
    ownership rules is not warned about anything, so without it this asserts
    against a code path that returns before it ever looks at the alert.
    """
    payload = paging_alert(uniq("oncall_pt_warned"), binding_stream,
                           destinations=[SINK_DEST],
                           aggregation=group_aggregation([UNROUTABLE_COLUMN],
                                                         multi_alert=True))
    resp = oncall.create_alert(payload)
    assert resp.status_code == 200, resp.text
    assert warnings_of(resp), (
        "an aggregating alert grouped where no rule can match must say so at save")


def test_an_aggregating_alert_grouped_on_an_owned_identity_is_not_warned(
        oncall: OnCallClient, binding_stream: str, owned_namespace: str):
    """§6.2 — the same shape, grouped on a column an ownership rule claims.

    Seeded with the owned namespace so the group key is a value a rule really
    matches, rather than a column that merely maps to the right dimension.
    """
    oncall.seed_rows(binding_stream, [{"latency": 900, COL_NAMESPACE: owned_namespace}])
    payload = paging_alert(uniq("oncall_pt_unwarned"), binding_stream,
                           destinations=[SINK_DEST],
                           aggregation=group_aggregation([COL_NAMESPACE],
                                                         multi_alert=True))
    resp = oncall.create_alert(payload)
    assert resp.status_code == 200, resp.text
    assert warnings_of(resp) == [], f"unexpected paging warning: {resp.text}"


def test_a_warned_alert_is_still_saved(oncall: OnCallClient, binding_stream: str,
                                       owned_namespace: str):
    """§6.3 — the whole posture of this section in one assertion.

    A warning that blocked the save would be a refusal wearing a different
    name, and an operator who has read the advisory and means it anyway has to
    be able to proceed.
    """
    name = uniq("oncall_pt_warned_saved")
    payload = paging_alert(name, binding_stream, destinations=[SINK_DEST],
                           aggregation=group_aggregation([UNROUTABLE_COLUMN],
                                                         multi_alert=True))
    resp = oncall.create_alert(payload)
    assert resp.status_code == 200, resp.text
    assert warnings_of(resp), "this test is only meaningful on a warned save"

    stored = oncall.get_alert(resp.json()["id"])
    assert stored.status_code == 200, stored.text
    assert stored.json().get("name") == name


def test_an_alert_bound_to_a_team_is_never_warned_about_ownership(
        oncall: OnCallClient, binding_team: str, binding_stream: str,
        owned_namespace: str):
    """§6 scope limit — ownership rules get no say on an explicitly bound alert,
    so there is nothing for the advisory to be about.

    Grouped on the unroutable column on purpose: without the binding this is
    exactly the alert §6.1 warns about, so the binding is the only difference
    between the two outcomes — and `owned_namespace` is what keeps that true:
    on a rule-less org BOTH alerts come back unwarned and the silence asserted
    here would prove nothing about the binding.
    """
    payload = paging_alert(uniq("oncall_pt_bound_agg"), binding_stream,
                           oncall_team=binding_team, destinations=[],
                           aggregation=group_aggregation([UNROUTABLE_COLUMN],
                                                         multi_alert=True))
    payload["workflows"] = []
    resp = oncall.create_alert(payload)
    assert resp.status_code == 200, resp.text
    assert warnings_of(resp) == [], f"unexpected paging warning: {resp.text}"


def test_a_non_aggregating_alert_is_outside_the_warning_scope(
        oncall: OnCallClient, binding_stream: str, owned_namespace: str):
    """§6 scope limit — the warning covers aggregating alerts only.

    `owned_namespace` for the same reason as the test above: the silence is
    only evidence of the scope limit if a warning was reachable at all.

    A Simple SQL alert whose `GROUP BY` lives only in the query text is NOT
    covered by the feature, and this asserts that documented limit rather than
    treating it as a bug: a test that demanded coverage the feature does not
    claim would fail for the whole life of the feature.
    """
    payload = paging_alert(uniq("oncall_pt_plain"), binding_stream,
                           destinations=[SINK_DEST], aggregation=None)
    resp = oncall.create_alert(payload)
    assert resp.status_code == 200, resp.text
    assert warnings_of(resp) == [], f"unexpected paging warning: {resp.text}"
