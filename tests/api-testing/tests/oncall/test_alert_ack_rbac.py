"""Who may acknowledge an alert, and the on-call side of an ack (Slack app Phase 2, §5.4, §5.6)  [P1]

The rule is alert edit (OpenFGA on) or the org role (Admin, Editor, service account), or
a seat on the team of an open on-call response for the alert. A refusal names who is on
call and who could act instead. An ack acknowledges the alert's open page, and an ack
made on the page writes the alert's ack, so its repeats stop either way. A build with
OpenFGA off refuses non-admin users outright, so the refusal tests need OpenFGA on.
"""
from __future__ import annotations

import pytest

from support.client import OpenObserveClient
from support.wait import wait_until

from .oncall_helpers import OnCallClient, make_user, paging_alert, uniq

pytestmark = pytest.mark.enterprise


def _ack(oncall: OnCallClient, alert_id: str, body: dict, client: OpenObserveClient | None = None):
    c = client or oncall._c
    return c.request("POST", f"alerts/{alert_id}/ack?folder=default", org=oncall.org, prefix="api/v2/", json=body)


def _acks(oncall: OnCallClient, alert_id: str) -> list[dict]:
    r = oncall.v2("GET", f"alerts/{alert_id}/acks?folder=default")
    assert r.status_code == 200, r.text
    return r.json()["acks"]


def _firing_alert(oncall: OnCallClient, team_id: str) -> tuple[str, dict]:
    stream = uniq("ack_rbac_stream")
    oncall.seed_rows(stream, [{"latency": 900}])
    resp = oncall.create_alert(paging_alert(uniq("ack_rbac"), stream, oncall_team=team_id))
    assert resp.status_code == 200, resp.text
    alert_id = resp.json()["id"]

    def _paged():
        oncall.seed_rows(stream, [{"latency": 900}])
        pages = [p for p in oncall.pages_for(alert_id) if p.get("state") in ("triggered", "triaged")]
        return pages[0] if pages else None

    page = wait_until(_paged, timeout=240, interval=5, msg="the alert pages its team")
    return alert_id, page


def _non_admin(client: OpenObserveClient, org: str, oncall: OnCallClient, role: str):
    try:
        email, as_user = make_user(client, org, role)
    except AssertionError as e:
        if "require open-fga" in str(e):
            pytest.skip("non-admin roles need OpenFGA on")
        raise
    oncall.users.append(email)
    return email, as_user


@pytest.fixture(scope="module")
def admin(client: OpenObserveClient, oncall_org: str, oncall: OnCallClient) -> tuple[str, OpenObserveClient]:
    email, as_user = make_user(client, oncall_org, "admin")
    oncall.users.append(email)
    return email, as_user


@pytest.fixture(scope="module")
def editor(client: OpenObserveClient, oncall_org: str, oncall: OnCallClient) -> tuple[str, OpenObserveClient]:
    return _non_admin(client, oncall_org, oncall, "editor")


@pytest.fixture(scope="module")
def member(client: OpenObserveClient, oncall_org: str, oncall: OnCallClient) -> tuple[str, OpenObserveClient]:
    return _non_admin(client, oncall_org, oncall, "viewer")


@pytest.fixture(scope="module")
def viewer(client: OpenObserveClient, oncall_org: str, oncall: OnCallClient) -> tuple[str, OpenObserveClient]:
    return _non_admin(client, oncall_org, oncall, "viewer")


def test_the_rule_refuses_a_viewer_with_names_and_lets_an_editor_and_a_responder_ack(
        oncall: OnCallClient, member, viewer, admin, editor):
    responder_email, as_responder = member
    _, as_outsider = viewer
    admin_email, _ = admin
    _, as_editor = editor
    team_id = oncall.staffed_team([responder_email])
    alert_id, page = _firing_alert(oncall, team_id)

    refused = _ack(oncall, alert_id, {}, client=as_outsider)
    assert refused.status_code == 403, refused.text
    body = refused.json()
    assert body["code"] == "ack_refused" and body["rule"] in ("role", "fga"), body
    assert responder_email in [p["email"] for p in body["on_call"]], body
    assert all(p["team"] for p in body["on_call"])
    assert admin_email in [p["email"] for p in body["can_act"]], body
    assert len(body["can_act"]) <= 2

    by_responder = _ack(oncall, alert_id, {}, client=as_responder)
    assert by_responder.status_code == 200, by_responder.text
    answer = by_responder.json()
    assert answer["changed"] is True
    assert answer["oncall"]["acknowledged"] == [page["id"]], answer
    state = oncall.get_response(page["id"]).json()["response"]
    assert state["state"] == "acknowledged" and state["acked_by"] == responder_email
    assert _ack(oncall, alert_id, {}, client=as_editor).json()["changed"] is False, "an editor may ack too"


def test_an_empty_team_admits_nobody(oncall: OnCallClient, viewer):
    _, as_outsider = viewer
    team_id = oncall.team_id()
    alert_id, _ = _firing_alert(oncall, team_id)
    assert _ack(oncall, alert_id, {}, client=as_outsider).status_code == 403


def test_an_alert_ack_acknowledges_its_open_page(oncall: OnCallClient, admin):
    admin_email, as_admin = admin
    team_id = oncall.staffed_team([admin_email])
    alert_id, page = _firing_alert(oncall, team_id)
    answer = _ack(oncall, alert_id, {}, client=as_admin)
    assert answer.status_code == 200, answer.text
    assert answer.json()["oncall"]["acknowledged"] == [page["id"]], answer.text
    state = oncall.get_response(page["id"]).json()["response"]
    assert state["state"] == "acknowledged" and state["acked_by"] == admin_email


def test_an_ack_on_the_page_acks_the_alert(oncall: OnCallClient, admin):
    admin_email, _ = admin
    team_id = oncall.staffed_team([admin_email])
    alert_id, page = _firing_alert(oncall, team_id)
    assert oncall.acknowledge(page["id"]).status_code == 200

    acks = wait_until(lambda: _acks(oncall, alert_id), timeout=30, interval=2, msg="the page ack reached the alert")
    # The source records how the person acked (an API call here), not that it was a page.
    assert acks[0]["ack_source"] == "api"
    assert acks[0]["acked_by"] == oncall._c.email


def _incident_for(oncall: OnCallClient, alert_id: str) -> dict:
    def _ours():
        r = oncall.v2("GET", "alerts/incidents?limit=1000")
        assert r.status_code == 200, r.text
        found = [i for i in r.json()["incidents"]
                 if any(g.get("alert_id") == alert_id for g in i.get("alert_groups") or [])]
        return found[0] if found else None

    return wait_until(_ours, timeout=240, interval=5, msg="the alert opens an incident")


def _incident_status(oncall: OnCallClient, incident_id: str, client: OpenObserveClient | None = None):
    c = client or oncall._c
    return c.request("PATCH", f"alerts/incidents/{incident_id}/update", org=oncall.org, prefix="api/v2/",
                     json={"status": "acknowledged"})


@pytest.fixture(scope="module")
def incident_editor(client: OpenObserveClient, oncall_org: str, oncall: OnCallClient):
    """A user whose custom role edits incidents but only reads alert folder `default` (o2-enterprise#3274)."""
    if oncall.v1("GET", "roles").status_code != 200:
        pytest.skip("custom roles need an enterprise build with OpenFGA on")
    email, as_user = _non_admin(client, oncall_org, oncall, "user")
    role = uniq("ack_rbac_role")
    assert oncall.v1("POST", "roles", json={"role": role}).status_code in (200, 201)
    try:
        grants = [("incidents:_all_" + oncall_org, "AllowAll"),
                  ("afolder:default", "AllowGet"), ("afolder:default", "AllowList")]
        resp = oncall.v1("PUT", f"roles/{role}", json={
            "add": [{"object": o, "permission": p} for o, p in grants],
            "remove": [], "add_users": [email], "remove_users": []})
        assert resp.status_code == 200, resp.text
        # OpenFGA tuple writes are not read-your-writes.
        wait_until(lambda: as_user.request("GET", "alerts/incidents?limit=1", org=oncall.org,
                                           prefix="api/v2/").status_code == 200,
                   timeout=30, interval=1, msg="the incidents grant never reached OpenFGA")
        yield email, as_user
    finally:
        oncall.v1("DELETE", f"roles/{role}")


def test_an_incident_ack_is_refused_to_a_user_who_may_not_ack_its_alert(oncall: OnCallClient, incident_editor):
    _, as_user = incident_editor
    stream = uniq("ack_rbac_inc_stream")
    oncall.seed_rows(stream, [{"latency": 900}])
    payload = paging_alert(uniq("ack_rbac_inc"), stream)
    payload["creates_incident"] = True
    resp = oncall.create_alert(payload)
    assert resp.status_code == 200, resp.text
    alert_id = resp.json()["id"]
    incident = _incident_for(oncall, alert_id)
    try:
        read = as_user.request("GET", f"alerts/incidents/{incident['id']}", org=oncall.org, prefix="api/v2/")
        assert read.status_code == 200, f"the user must reach the incident for the refusal to mean anything: {read.text}"
        assert _ack(oncall, alert_id, {}, client=as_user).status_code == 403, "the direct alert ack is refused"

        refused = _incident_status(oncall, incident["id"], client=as_user)
        assert refused.status_code == 403, refused.text
        assert refused.json().get("code") == "ack_refused", refused.text
        assert _acks(oncall, alert_id) == [], "a refused incident ack must not ack the alert"
        state = oncall.v2("GET", f"alerts/incidents/{incident['id']}").json()
        assert state.get("incident", state)["status"] != "acknowledged", state

        allowed = _incident_status(oncall, incident["id"])
        assert allowed.status_code == 200, allowed.text
        acks = wait_until(lambda: _acks(oncall, alert_id), timeout=30, interval=2, msg="the incident ack reached the alert")
        assert acks[0]["ack_source"] == "incident", acks
    finally:
        oncall.v2("PATCH", f"alerts/incidents/{incident['id']}/update", json={"status": "resolved"})
