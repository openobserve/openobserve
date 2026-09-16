"""On-Call — who may act on a page, and who may configure a team.

Covers plan §1 (page actions are scoped to the owning team) and §10 (RBAC
across roles) of docs/test_generator/features/oncall-test-plan.md.

§1 is a P0 regression guard. The original defect was the absence of any team
check on a page action: every account in the org could acknowledge, resolve,
note, snooze or hand off any team's page, silently stopping a ladder that was
still due to fire. The tests below assert the scope check by acting as the
users themselves — a root session with a `user_email` in the body would assert
nothing, because root is one of the exempt roles.

Two traps this file exists to avoid, both hit during the manual pass:

  * `notes` with no `body` answers **422** and `handoff` with no target answers
    **400**, and both fire BEFORE the scope check. Sending an invalid payload
    and reading the error as "the scope check passed" is how the defect was
    briefly declared fixed. Every scope assertion here sends a VALID payload,
    and §1.7 pins the two validation codes separately so their ordering cannot
    silently change.
  * an **empty roster** is a carve-out, not an oversight: a page nobody is on
    the hook for must still be closable by any org member, or it is immortal.

These live here rather than in the Playwright suite because they assert status
codes and record state, nothing drawn. Plan §10.5 — that a role which the API
refuses is not offered the control on screen — is the UI half, and is the gap
that let openobserve/o2-enterprise#2601 through; it is deliberately NOT claimed
by this file.
"""
from __future__ import annotations

import logging

import pytest
import requests

from support.client import OpenObserveClient

from .oncall_helpers import OnCallClient, make_user, uniq

logger = logging.getLogger(__name__)

# The whole feature needs an enterprise build with `O2_ONCALL_ENABLED`; the
# marker lets CI hold this directory separately, and the session-scoped gate
# in conftest skips it rather than failing when the flag is off.
pytestmark = pytest.mark.enterprise

# The six verbs plan §1.1 names. Escalate is included: forcing the next rung is
# as much an act on somebody else's page as stopping the ladder is.
PAGE_ACTIONS = ["acknowledge", "resolve", "notes", "snooze", "handoff", "escalate"]

# The write routes that configure who gets woken. Plan §10.1/§10.2 are about
# exactly this set — reads are open to the whole org by design.
CONFIG_ROUTES = ["create_team", "rename_team", "set_schedule", "set_policy", "create_ownership"]


# =============================================================================
# Fixtures
# =============================================================================

@pytest.fixture(scope="module", autouse=True)
def _require_role_grants(client: OpenObserveClient, oncall_org: str) -> None:
    """Skip this file when the deployment is not writing role grants at all.

    Every assertion here is about on-call's OWN permission model, and that can
    only be read on a server where roles work in general. On a deployment whose
    authorizer never receives its tuples, a freshly created **admin** is refused
    everything — `/streams` included, which on-call has nothing to do with —
    and all eight scope assertions turn red for a reason that is not on-call's.

    The probe is deliberately narrow, because a gate that skips too eagerly
    costs the whole file silently: it creates a real admin, asks for a route
    OUTSIDE on-call, and skips ONLY on an explicit 403. A 200 (the healthy
    case), a transport error or any other status all fall through and let the
    tests run and fail normally, so a genuine on-call RBAC regression is still
    caught here rather than skipped away.
    """
    email, as_admin = make_user(client, oncall_org, "admin")
    try:
        probe = as_admin.request("GET", "streams")
    except requests.RequestException:
        return
    if probe.status_code == 403:
        pytest.skip(
            "this deployment is not writing role grants: the freshly created admin "
            f"{email} is refused GET /streams (403), a route outside on-call, so a "
            "403 on an on-call route proves nothing about on-call's own rules")


@pytest.fixture(scope="module")
def staffed(oncall: OnCallClient, responder: tuple[str, OpenObserveClient]) -> str:
    """A team with one member — the roster the scope check reads."""
    email, _ = responder
    return oncall.staffed_team([email])


@pytest.fixture(scope="module")
def pages(oncall: OnCallClient, staffed: str) -> list[dict]:
    """Three open pages on the staffed team, opened in one scheduler cycle.

    Three because acknowledging or resolving a page consumes it: a test that
    settles a record cannot hand it on to the next one.
    """
    return oncall.open_pages(staffed, 3)


@pytest.fixture(scope="module")
def as_role(client: OpenObserveClient, oncall: OnCallClient, oncall_org: str):
    """One on-call client per role, created on first use and then reused.

    Cached because the role matrix is parametrised over five config routes: a
    user per parametrisation would create the same account ten times and leave
    ten to sweep, for no extra coverage.
    """
    cache: dict[str, OnCallClient] = {}

    def _for(role: str) -> OnCallClient:
        if role not in cache:
            email, as_user = make_user(client, oncall_org, role)
            oncall.users.append(email)
            cache[role] = OnCallClient(as_user, oncall_org)
        return cache[role]

    return _for


@pytest.fixture(scope="module")
def unstaffed_page(oncall: OnCallClient) -> dict:
    """A page on a team with NO members — plan §1.5's carve-out."""
    team_id = oncall.team_id(uniq("oncall_pt_empty"))
    return oncall.open_pages(team_id, 1)[0]


def act(oc: OnCallClient, action: str, response_id: str, *,
        handoff_to: str | None = None) -> requests.Response:
    """One page action, always with a payload that would otherwise be valid.

    The point of the indirection: a scope test must fail the SCOPE check, so it
    must not be refused for a missing field first.
    """
    if action == "acknowledge":
        return oc.acknowledge(response_id)
    if action == "resolve":
        return oc.resolve(response_id)
    if action == "notes":
        return oc.note(response_id, "scope check")
    if action == "snooze":
        return oc.snooze(response_id, 5)
    if action == "handoff":
        return oc.handoff(response_id, to=handoff_to or "somebody@test.invalid")
    if action == "escalate":
        return oc.escalate(response_id)
    raise ValueError(f"unknown page action {action}")


# =============================================================================
# §1 — page actions are scoped to the owning team
# =============================================================================

@pytest.mark.parametrize("action", PAGE_ACTIONS)
def test_non_member_is_refused_every_page_action(
        oncall: OnCallClient, oncall_org: str, pages: list[dict],
        outsider: tuple[str, OpenObserveClient], action: str):
    """§1.1 — an org account on no team gets 403 on all six verbs.

    Parametrised rather than looped so a regression names the verb that came
    back: the original defect was per-handler, and five passing verbs with one
    open door is the shape this is guarding against.
    """
    _, as_outsider = outsider
    outsider_oc = OnCallClient(as_outsider, oncall_org)
    resp = act(outsider_oc, action, pages[0]["id"])
    assert resp.status_code == 403, f"{action}: {resp.status_code} {resp.text}"


def test_member_of_the_paged_team_may_acknowledge(
        oncall: OnCallClient, oncall_org: str, pages: list[dict],
        responder: tuple[str, OpenObserveClient]):
    """§1.2 — the member acknowledges, the ladder stops, and the record says
    who answered."""
    email, as_member = responder
    member_oc = OnCallClient(as_member, oncall_org)
    page_id = pages[1]["id"]

    resp = member_oc.acknowledge(page_id)
    assert resp.status_code == 200, resp.text

    record = oncall.get_response(page_id)
    assert record.status_code == 200, record.text
    # The roster lowercases on write, so the attribution is compared lowercased.
    assert (record.json()["response"].get("acked_by") or "").lower() == email.lower()

    progress = oncall.escalation(page_id)
    assert progress.status_code == 200, progress.text
    body = progress.json()
    assert body.get("next_targets") == [], "an acknowledged ladder has nobody left to wake"
    assert body.get("stopped_because"), "a stopped ladder must say why it stopped"


def test_root_may_act_on_a_team_it_is_not_on(oncall: OnCallClient, pages: list[dict]):
    """§1.3 — root is a settled carve-out, not an accident of the check."""
    resp = oncall.note(pages[0]["id"], "root note")
    assert resp.status_code == 200, resp.text


@pytest.mark.parametrize("role", ["admin", "editor"])
def test_admin_and_editor_on_no_team_may_act(as_role, pages: list[dict], role: str):
    """§1.4 — `may_work_any_page` covers admin and editor as well as root.

    Wider than "root only", and deliberately so: an incident commander who is
    not on the rota still has to be able to close a record.
    """
    resp = as_role(role).note(pages[0]["id"], f"{role} note")
    assert resp.status_code == 200, f"{role}: {resp.status_code} {resp.text}"


def test_a_page_with_an_empty_roster_stays_closable(
        oncall_org: str, unstaffed_page: dict, outsider: tuple[str, OpenObserveClient]):
    """§1.5 — nobody is on the team, so the scope check has nobody to admit.

    The carve-out matters more than it looks: without it the record can never
    be closed by anyone, and an org accumulates pages it cannot answer.
    """
    _, as_outsider = outsider
    outsider_oc = OnCallClient(as_outsider, oncall_org)
    resp = outsider_oc.resolve(unstaffed_page["id"])
    assert resp.status_code == 200, resp.text


def test_a_cover_naming_a_non_member_is_refused(
        oncall: OnCallClient, staffed: str, outsider: tuple[str, OpenObserveClient]):
    """§1.6 — a cover outranks every layer, so it must not staff a stranger.

    The plan says the message names the person AND the team. Only the person is
    asserted here: the exact rendering of the team (id or display name) was not
    verified against a running build, and a substring assertion on a guess would
    fail for a message that is perfectly correct.
    """
    email, _ = outsider
    resp = oncall.create_override(staffed, email)
    assert resp.status_code == 400, f"{resp.status_code} {resp.text}"
    assert email.lower() in resp.text.lower(), resp.text


def test_validation_fires_before_the_scope_check(
        oncall_org: str, pages: list[dict], outsider: tuple[str, OpenObserveClient]):
    """§1.7 — the two codes that were mistaken for the scope check passing.

    `notes` with no `body` is refused by the request extractor, which runs
    before any authorization at all, hence 422. `handoff` with neither `to` nor
    `to_team_id` parses fine and is refused by the handler, hence 400. Neither
    is a 403, and neither says anything about team scope.
    """
    _, as_outsider = outsider
    outsider_oc = OnCallClient(as_outsider, oncall_org)
    page_id = pages[0]["id"]

    no_body = outsider_oc.oc("POST", f"responses/{page_id}/notes", json={})
    assert no_body.status_code == 422, no_body.text

    no_target = outsider_oc.handoff(page_id)
    assert no_target.status_code == 400, no_target.text


# =============================================================================
# §10 — RBAC across roles
# =============================================================================

def configure(oc: OnCallClient, route: str, *, team_id: str | None = None) -> requests.Response:
    """One team-configuration write, as whichever client `oc` wraps."""
    if route == "create_team":
        return oc.oc("POST", "teams", json={"name": uniq("oncall_pt_rbac"),
                                            "timezone": "UTC", "description": "rbac"})
    if route == "rename_team":
        return oc.oc("PUT", f"teams/{team_id}", json={"name": uniq("oncall_pt_renamed")})
    if route == "set_schedule":
        return oc.oc("PUT", f"teams/{team_id}/schedule",
                     json={"timezone": "UTC", "rotations": []})
    if route == "set_policy":
        return oc.oc("PUT", f"teams/{team_id}/policy", json={"rungs": []})
    if route == "create_ownership":
        return oc.oc("POST", "ownership",
                     json={"team_id": team_id, "dimensions": {"service": uniq("svc")}})
    raise ValueError(f"unknown config route {route}")


@pytest.mark.parametrize("role", ["user", "viewer"])
@pytest.mark.parametrize("route", CONFIG_ROUTES)
def test_read_only_roles_cannot_configure_a_team(
        as_role, staffed: str, role: str, route: str):
    """§10.1 — writing this surface decides who gets woken at 3am, so it is an
    administrative act whatever the caller's relationship to the team."""
    resp = configure(as_role(role), route, team_id=staffed)
    assert resp.status_code == 403, f"{role}/{route}: {resp.status_code} {resp.text}"


@pytest.mark.parametrize("role", ["admin", "editor"])
def test_admin_and_editor_may_configure_a_team(
        oncall: OnCallClient, as_role, role: str):
    """§10.2 — the other half of the same rule. Registered for the sweep so an
    admin-created team is not left behind by a root-owned teardown."""
    resp = configure(as_role(role), "create_team")
    assert resp.status_code == 200, f"{role}: {resp.status_code} {resp.text}"
    oncall.teams.append(resp.json()["id"])


def test_root_may_configure_a_team(oncall: OnCallClient):
    """§10.2 — root, for completeness of the role matrix."""
    resp = oncall.create_team()
    assert resp.status_code == 200, resp.text


def test_membership_not_role_decides_a_page_action(
        client: OpenObserveClient, oncall: OnCallClient, oncall_org: str,
        staffed: str, pages: list[dict]):
    """§10.3 — two accounts of the SAME role, one on the team and one not.

    Holding the role constant is the whole point: an assertion that a `user`
    may act and a `viewer` may not would be consistent with role deciding it.
    """
    member_email, as_member = make_user(client, oncall_org, "user")
    stranger_email, as_stranger = make_user(client, oncall_org, "user")
    oncall.users.extend([member_email, stranger_email])
    assert oncall.add_member(staffed, member_email).status_code == 200

    page_id = pages[2]["id"]
    refused = OnCallClient(as_stranger, oncall_org).note(page_id, "stranger")
    assert refused.status_code == 403, refused.text

    allowed = OnCallClient(as_member, oncall_org).note(page_id, "member")
    assert allowed.status_code == 200, allowed.text


def test_a_page_from_another_org_is_not_actionable(
        client: OpenObserveClient, oncall: OnCallClient, pages: list[dict]):
    """§10.4 — the same page id, addressed through a different org.

    403 and 404 are both honest answers here ("not yours" and "no such record
    in this org"), and which one arrives depends on where the org filter sits.
    The assertion that matters is that neither is a 200: a page id leaking
    across a tenant boundary would let one customer stop another's ladder.
    """
    created = client.post("api/organizations", prefix="", json={"name": uniq("oncall_pt_org")})
    if created.status_code != 200:
        pytest.skip(f"this deployment does not allow creating an org: {created.status_code}")
    other_org = created.json()["identifier"]
    try:
        resp = OnCallClient(client, other_org).note(pages[0]["id"], "cross-org")
        assert resp.status_code in (403, 404), f"{resp.status_code} {resp.text}"
    finally:
        client.delete(f"api/organizations/{other_org}", prefix="")
