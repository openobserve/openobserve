"""AC-14.2, 14.3, 14.5-14.11, 14.13, 14.15, 14.17 and 14.20: the self-hosted instance workspace (spec section 7.7).

A `_meta` install is the instance workspace; row 24 decides which orgs it serves. Every test uses its own Slack
team and uninstalls what it installed, so a served `all` workspace never leaks into the tests after it.
"""
from __future__ import annotations

import json
import time
import uuid
from typing import Any

import pytest
import requests

from helpers.slack_mock import mock_code
from support.client import OpenObserveClient

from .instance_helpers import (
    META,
    META_HELP,
    config_token,
    defaults_by_channel,
    installations,
    manual_app,
    meta_install,
    meta_role_user,
    org_access,
    org_access_path,
    org_admin,
    org_name,
    put_org_access,
    rbac_enabled,
    served_ids,
    set_default,
    view_in,
)
from .slack_helpers import (
    SlackMock,
    add_to_org,
    audit_rows,
    call,
    connect_with_proof,
    form_destination_payload,
    http_install,
    make_slack_org,
    make_user,
    my_links,
    new_team,
    query_param,
    self_hosted_install,
    send_mention,
    slack_user,
    wait_until,
)
from .test_delegated import STREAM, mint, search, signing_key

pytestmark = [pytest.mark.enterprise]

INSTANCE_TEAM = "This workspace is your instance workspace. Ask your instance admin to add your org."


def take_over_message(team_name: str) -> str:
    return (f"OpenObserve is already installed in {team_name} by another organization. "
            "Make that installation the instance workspace instead.")


def message(resp: requests.Response) -> str:
    """The error message, or the raw body when it is not JSON (a 404 from an unrouted path is empty)."""
    try:
        return resp.json().get("message", "")
    except ValueError:
        return resp.text


def uniq() -> str:
    return uuid.uuid4().hex[:8]


@pytest.fixture
def ready(slack_on: None, self_hosted: None, mock: SlackMock) -> SlackMock:
    return mock


@pytest.fixture
def cleanup(client: OpenObserveClient):
    """``(org, installation_id)`` pairs uninstalled (or started over) after the test."""
    made: list[tuple[str, str]] = []
    yield made
    for org, installation_id in reversed(made):
        client.delete(f"slack/installations/{installation_id}", org=org)


def instance(client: OpenObserveClient, mock: SlackMock, cleanup: list[tuple[str, str]], team_id: str) -> dict[str, Any]:
    view = meta_install(client, mock, team_id)
    cleanup.append((META, view["id"]))
    return view


def set_meta_help(client: OpenObserveClient, installation_id: str) -> None:
    resp = client.put(f"slack/installations/{installation_id}/help-contact", json={"help_contact": META_HELP}, org=META)
    assert resp.status_code == 200, resp.text


def enable_linking(client: OpenObserveClient, org: str, installation_id: str) -> None:
    resp = client.put(
        f"slack/installations/{installation_id}/linking", json={"enabled": True, "domains": ["acme.test"]}, org=org
    )
    assert resp.status_code == 200, resp.text


def mention_link(client: OpenObserveClient, inst: dict[str, Any], team: str, slack_id: str,
                 user: OpenObserveClient, org: str) -> dict[str, Any]:
    """A mention by an unlinked member whose email domain links automatically; returns the new link."""
    send_mention(client, inst, team, slack_id)
    return wait_until(lambda: my_links(user, org), f"{slack_id}'s automatic link")[0]


def link_by_id(user: OpenObserveClient, org: str, link_id: str) -> dict[str, Any] | None:
    return next((link for link in my_links(user, org) if link["id"] == link_id), None)


def take_over_list(resp: requests.Response) -> list[dict[str, Any]]:
    return json.loads(resp.json()["error_detail"])["take_over"]


def linked_instance(client: OpenObserveClient, mock: SlackMock, cleanup: list[tuple[str, str]]) -> dict[str, Any]:
    """Instance workspace listing X and Y; C0OPS defaults to X; Ann (X only) and Bob (X and Y) linked into X."""
    ann_email, bob_email = f"ann_{uniq()}@acme.test", f"bob_{uniq()}@acme.test"
    team = new_team(mock, slack_user("U0ANN", "", ann_email), slack_user("U0BOB", "", bob_email))
    inst = instance(client, mock, cleanup, team)
    x, y = make_slack_org(client), make_slack_org(client)
    _, ann = make_user(client, x, "admin", email=ann_email)
    _, bob = make_user(client, x, "admin", email=bob_email)
    add_to_org(client, y, bob_email, "admin")
    listed = put_org_access(client, inst["id"], {"orgs": [META, x, y]})
    assert listed.status_code == 200, listed.text
    assert set_default(client, x, inst["id"], "C0OPS", x).status_code == 200
    enable_linking(client, META, inst["id"])
    ann_link = mention_link(client, inst, team, "U0ANN", ann, x)
    bob_link = mention_link(client, inst, team, "U0BOB", bob, x)
    assert (ann_link["default_org_id"], bob_link["default_org_id"]) == (x, x), "the channel default picks X"
    return {"inst": inst, "team": team, "x": x, "y": y, "ann": ann, "bob": bob,
            "ann_link": ann_link["id"], "bob_link": bob_link["id"]}


def slack_destination(mock: SlackMock, team: str, team_name: str, name: str) -> dict[str, Any]:
    fields = {"webhookUrl": f"{mock.base_url}/services/{team}/B0{uniq().upper()}", "teamId": team,
              "teamName": team_name, "channelId": "C0ALERTS"}
    return form_destination_payload(name, fields)


def test_meta_install_is_an_instance_workspace_serving_only_meta(
    client: OpenObserveClient, ready: SlackMock, cleanup: list[tuple[str, str]]
) -> None:
    inst = instance(client, ready, cleanup, new_team(ready))
    assert (inst["scope"], inst["managed"], inst.get("org_access")) == ("instance", False, "listed"), inst
    view = org_access(client, inst["id"])
    assert view["all"] is False
    assert [(row["org_id"], row["source"]) for row in view["orgs"]] == [(META, "org")], "R-78: _meta only"
    assert view["other_apps_in_team"] == []
    other = make_slack_org(client)
    assert view_in(client, other, inst["id"]) is None, "an org that is not listed is not served"


def test_an_org_install_is_an_org_workspace(
    client: OpenObserveClient, ready: SlackMock, cleanup: list[tuple[str, str]]
) -> None:
    inst = instance(client, ready, cleanup, new_team(ready))
    assert inst["scope"] == "instance", "an instance workspace of another team exists meanwhile"
    org = make_slack_org(client)
    own = self_hosted_install(client, org, team_id=new_team(ready))["installation"]["id"]
    cleanup.append((org, own))
    view = view_in(client, org, own)
    assert view is not None
    assert (view["scope"], view["managed"]) == ("org", False), view
    assert ("org_access" in view, "instance_help_contact" in view) == (False, False), view
    assert own in {a["installation_id"] for a in installations(client, META)["available"]}, "R-82 take-over candidate"
    assert inst["id"] not in {a["installation_id"] for a in installations(client, org)["available"]}


def test_org_access_put_all_and_list(client: OpenObserveClient, ready: SlackMock, cleanup: list[tuple[str, str]]) -> None:
    inst = instance(client, ready, cleanup, new_team(ready))
    x = make_slack_org(client)
    listed = put_org_access(client, inst["id"], {"orgs": [META, x]})
    assert listed.status_code == 200, listed.text
    view = listed.json()
    assert (view["all"], served_ids(view)) == (False, {META, x})
    assert "removed" not in view, "removed is left out when empty"
    row = next(r for r in view["orgs"] if r["org_id"] == x)
    assert (row["org_name"], row["source"], row["added_by"]) == (org_name(client, x), "instance", client.email)
    assert (row["channel_defaults"], row["links"]) == (0, 0)
    assert row["added_at"] > 0
    options = view["organizations"]
    assert options == sorted(options, key=lambda o: (o["org_name"], o["org_id"])), "sorted by name then id"
    assert org_access(client, inst["id"]) == view, "the PUT answers the view a GET returns"

    members = next(o["members"] for o in options if o["org_id"] == x)
    make_user(client, x, "admin")
    after = org_access(client, inst["id"])
    assert next(o["members"] for o in after["organizations"] if o["org_id"] == x) == members + 1
    assert next(r["members"] for r in after["orgs"] if r["org_id"] == x) == members + 1

    everything = put_org_access(client, inst["id"], {"all": True})
    assert everything.status_code == 200, everything.text
    assert everything.json()["all"] is True
    late = make_slack_org(client)
    view = org_access(client, inst["id"])
    assert {META, x, late} <= served_ids(view), "all serves every org, including one created later"
    assert {META, x, late} <= {o["org_id"] for o in view["organizations"]}
    late_view = view_in(client, late, inst["id"])
    assert (late_view or {}).get("managed") is True, "served at once, with no write"


def test_org_access_refuses_without_meta_unknown_org_or_outside_meta(
    client: OpenObserveClient, ready: SlackMock, cleanup: list[tuple[str, str]]
) -> None:
    inst = instance(client, ready, cleanup, new_team(ready))
    x = make_slack_org(client)
    no_meta = put_org_access(client, inst["id"], {"orgs": [x]})
    assert (no_meta.status_code, message(no_meta)) == (400, "_meta is always included"), no_meta.text
    ghost = f"nosuchorg_{uniq()}"
    unknown = put_org_access(client, inst["id"], {"orgs": [META, ghost]})
    assert (unknown.status_code, message(unknown)) == (400, f"Org {ghost} does not exist"), unknown.text
    for method, body in (("GET", None), ("PUT", {"orgs": [META, x]})):
        outside = call(client, method, org_access_path(inst["id"]), body, org=x)
        assert outside.status_code == 404, f"{method} from {x}: {outside.status_code} {outside.text}"
    assert served_ids(org_access(client, inst["id"])) == {META}


def test_org_access_needs_a_meta_admin(client: OpenObserveClient, ready: SlackMock, cleanup: list[tuple[str, str]]) -> None:
    inst = instance(client, ready, cleanup, new_team(ready))
    x = make_slack_org(client)
    path, body = org_access_path(inst["id"]), {"orgs": [META, x]}
    if rbac_enabled(client):
        refused = meta_role_user(client, [])
        allowed = meta_role_user(client, ["AllowList", "AllowPut"])
    else:
        email, refused = make_user(client, x, "admin")
        add_to_org(client, META, email, "editor")
        allowed = make_user(client, META, "admin")[1]
    for method in ("GET", "PUT"):
        resp = call(refused, method, path, body, org=META)
        assert resp.status_code == 403, f"{method} without the _meta grant: {resp.status_code} {resp.text}"
    assert served_ids(org_access(client, inst["id"])) == {META}
    for method in ("GET", "PUT"):
        resp = call(allowed, method, path, body, org=META)
        assert resp.status_code == 200, f"{method} as a _meta Admin or grant: {resp.status_code} {resp.text}"
    assert served_ids(org_access(client, inst["id"])) == {META, x}


def test_a_served_orgs_admin_sees_a_managed_view(
    client: OpenObserveClient, ready: SlackMock, cleanup: list[tuple[str, str]]
) -> None:
    inst = instance(client, ready, cleanup, new_team(ready))
    set_meta_help(client, inst["id"])
    x = make_slack_org(client)
    admin = org_admin(client, x)
    assert put_org_access(client, inst["id"], {"orgs": [META, x]}).status_code == 200
    body = installations(admin, x)
    view = next((i for i in body["installations"] if i["id"] == inst["id"]), None)
    assert view is not None, body
    assert (view["scope"], view["managed"], view.get("instance_help_contact")) == ("instance", True, META_HELP), view
    assert "org_access" not in view
    assert view["other_connected_orgs"] == 1, "the other served org is _meta"
    assert inst["id"] not in {a["installation_id"] for a in body["available"]}
    assert (body.get("instance") or {}).get("installation_id") != inst["id"], "a served org gets no notice for it"
    meta_view = view_in(client, META, inst["id"])
    assert meta_view is not None
    assert (meta_view["managed"], meta_view.get("org_access")) == (False, "listed"), meta_view
    assert "instance_help_contact" not in meta_view


def test_an_unserved_org_gets_the_instance_notice(
    client: OpenObserveClient, ready: SlackMock, cleanup: list[tuple[str, str]]
) -> None:
    inst = instance(client, ready, cleanup, new_team(ready))
    set_meta_help(client, inst["id"])
    z = make_slack_org(client)
    body = installations(org_admin(client, z), z)
    assert inst["id"] not in {i["id"] for i in body["installations"]}
    assert inst["id"] not in {a["installation_id"] for a in body["available"]}
    assert body.get("instance") == {"installation_id": inst["id"], "team_name": inst["team_name"],
                                    "help_contact": META_HELP}, body


def test_a_served_orgs_admin_is_refused_installation_wide_rows(
    client: OpenObserveClient, ready: SlackMock, cleanup: list[tuple[str, str]]
) -> None:
    inst = instance(client, ready, cleanup, new_team(ready))
    x = make_slack_org(client)
    admin = org_admin(client, x)
    assert put_org_access(client, inst["id"], {"orgs": [META, x]}).status_code == 200
    base = f"slack/installations/{inst['id']}"
    for method, path, body in [
        ("POST", f"{base}/install-url", None),
        ("PUT", f"{base}/credentials", {"client_secret": "x"}),
        ("PUT", f"{base}/linking", {"enabled": False}),
        ("POST", f"{base}/link-all", None),
        ("DELETE", f"{base}/connection", None),
        ("DELETE", base, None),
    ]:
        resp = call(admin, method, path, body, org=x)
        assert resp.status_code == 403, f"{method} {path}: {resp.status_code} {resp.text}"
    for method, body in (("GET", None), ("PUT", {"all": True})):
        resp = call(admin, method, f"{base}/org-access", body, org=x)
        assert resp.status_code == 404, f"{method} org-access outside _meta: {resp.status_code} {resp.text}"
    for method, path, body, status in [
        ("POST", f"{base}/test", {}, 200),
        ("GET", f"{base}/channels", None, 200),
        ("GET", f"{base}/channel-defaults", None, 200),
        ("PUT", f"{base}/channel-defaults/C0ALERTS", {"org_id": x, "answer_mode": "thread"}, 200),
        ("DELETE", f"{base}/channel-defaults/C0ALERTS", None, 204),
        ("GET", f"{base}/help-contact", None, 200),
        ("PUT", f"{base}/help-contact", {"help_contact": "#x-help"}, 200),
    ]:
        resp = call(admin, method, path, body, org=x)
        assert resp.status_code == status, f"{method} {path}: {resp.status_code} {resp.text}"
    assert served_ids(org_access(client, inst["id"])) == {META, x}
    assert view_in(client, META, inst["id"])["status"] in ("healthy", "degraded"), "still installed"


def test_channel_defaults_on_an_instance_workspace(
    client: OpenObserveClient, ready: SlackMock, cleanup: list[tuple[str, str]]
) -> None:
    inst = instance(client, ready, cleanup, new_team(ready))
    x, y = make_slack_org(client), make_slack_org(client)
    x_admin, y_admin = org_admin(client, x), org_admin(client, y)
    both_email, both = make_user(client, x, "admin")
    add_to_org(client, y, both_email, "admin")
    meta_admin = make_user(client, META, "admin")[1]
    assert put_org_access(client, inst["id"], {"orgs": [META, x, y]}).status_code == 200
    i = inst["id"]

    assert set_default(x_admin, x, i, "C0ALERTS", x).status_code == 200, "an unclaimed channel"
    own = set_default(x_admin, x, i, "C0ALERTS", x, "private")
    assert own.status_code == 200, own.text
    assert own.json()["answer_mode"] == "private", "a channel X owns"
    other_org = set_default(x_admin, x, i, "C0OPS", y)
    assert other_org.status_code == 403, f"org_id other than their own: {other_org.text}"

    assert set_default(y_admin, y, i, "C0GENERAL", y).status_code == 200
    moved = set_default(both, x, i, "C0GENERAL", x)
    assert moved.status_code == 403, f"another org's channel, even for an Admin of both: {moved.text}"
    removed = both.delete(f"slack/installations/{i}/channel-defaults/C0GENERAL", org=x)
    assert removed.status_code == 403, removed.text
    assert defaults_by_channel(client, y, i)["C0GENERAL"]["set_by_this_org"] is True

    reassigned = set_default(meta_admin, META, i, "C0GENERAL", x)
    assert reassigned.status_code == 200, reassigned.text
    assert defaults_by_channel(client, x, i)["C0GENERAL"]["set_by_this_org"] is True


def test_connect_and_connect_ticket_refused_on_an_instance_workspace(
    client: OpenObserveClient, ready: SlackMock, cleanup: list[tuple[str, str]]
) -> None:
    inst = instance(client, ready, cleanup, new_team(ready))
    x, z = make_slack_org(client), make_slack_org(client)
    assert put_org_access(client, inst["id"], {"orgs": [META, x]}).status_code == 200
    base = f"slack/installations/{inst['id']}"
    for org in (z, x):
        admin = org_admin(client, org)
        started = admin.post(f"{base}/connection/start", json={"purpose": "connect"}, org=org)
        assert started.status_code == 403, f"row 14 connect from {org}: {started.status_code} {started.text}"
        # No real ticket exists for an instance workspace: row 2 refuses its team (R-81) before issuing one.
        ticket = admin.post(f"{base}/connection", json={"connect_ticket": "t"}, org=org)
        assert ticket.status_code == 403, f"row 16 from {org}: {ticket.status_code} {ticket.text}"
    assert served_ids(org_access(client, inst["id"])) == {META, x}


def test_meta_install_of_a_team_with_an_org_workspace_answers_take_over_then_converts(
    client: OpenObserveClient, ready: SlackMock, cleanup: list[tuple[str, str]]
) -> None:
    team = new_team(ready)
    a, b = make_slack_org(client), make_slack_org(client)
    own = self_hosted_install(client, a, team_id=team)["installation"]["id"]
    cleanup.append((a, own))
    assert connect_with_proof(client, b, own, team_id=team).status_code == 200
    team_name = view_in(client, a, own)["team_name"]

    creates = len(ready.calls("apps.manifest.create"))
    early = client.post("slack/installations", json={"mode": "socket", "config_refresh_token": config_token(ready, team)},
                        org=META)
    if early.status_code == 201:
        cleanup.append((META, early.json()["installation"]["id"]))
    assert (early.status_code, message(early)) == (409, take_over_message(team_name)), early.text
    assert [(c["installation_id"], set(c["org_ids"])) for c in take_over_list(early)] == [(own, {a, b})]
    assert len(ready.calls("apps.manifest.create")) == creates, "refused before any Slack app is created"

    app = manual_app(ready)
    created = client.post("slack/installations", json={"mode": "http", "client_id": app["client_id"],
                                                       "client_secret": app["client_secret"],
                                                       "signing_secret": app["signing_secret"]}, org=META)
    assert created.status_code == 201, created.text
    cleanup.append((META, created.json()["installation"]["id"]))
    state = query_param(created.json()["authorize_url"], "state")
    late = client.post("slack/install/exchange", json={"code": mock_code(team_id=team), "state": state}, org=META)
    assert (late.status_code, message(late)) == (409, take_over_message(team_name)), late.text
    assert own in {c["installation_id"] for c in take_over_list(late)}
    bot = ready.calls("oauth.v2.access")[-1]["response"]["access_token"]
    assert bot in {c["bearer"] for c in ready.calls("apps.uninstall")}, "the app Slack just installed is uninstalled"

    converted = put_org_access(client, own, {"orgs": [META, a, b]})
    assert converted.status_code == 200, converted.text
    view = org_access(client, own)
    assert (view["all"], served_ids(view)) == (False, {META, a, b})
    sources = {row["org_id"]: row["source"] for row in view["orgs"]}
    assert (sources[a], sources[b]) == ("org", "org"), "connected orgs keep their rows"
    for org in (a, b):
        seen = view_in(client, org, own)
        assert ((seen or {}).get("scope"), (seen or {}).get("managed")) == ("instance", True), seen
    assert view_in(client, META, own)["managed"] is False


def test_removing_an_org_cleans_defaults_threads_and_links_at_once(
    client: OpenObserveClient, ready: SlackMock, cleanup: list[tuple[str, str]]
) -> None:
    s = linked_instance(client, ready, cleanup)
    i, x, y = s["inst"]["id"], s["x"], s["y"]
    # Thread rows have no API; ENT access::tests::removal_* pins their delete.
    removed = put_org_access(client, i, {"orgs": [META, y]})
    assert removed.status_code == 200, removed.text
    summary = [(r["org_id"], r["channels"], r["links_moving"], r["links_unlinked"]) for r in removed.json()["removed"]]
    assert summary == [(x, ["ops-private"], 1, 1)]
    assert served_ids(removed.json()) == {META, y}
    assert "C0OPS" not in defaults_by_channel(client, META, i)
    assert link_by_id(s["ann"], x, s["ann_link"]) is None, "Ann belongs to no other served org: unlinked"
    assert link_by_id(s["bob"], y, s["bob_link"])["default_org_id"] == y, "Bob moves to Y"

    assert set_default(client, y, i, "C0GENERAL", y).status_code == 200
    everything = put_org_access(client, i, {"all": True})
    assert everything.status_code == 200, everything.text
    assert "removed" not in everything.json(), "listed to all removes nothing"
    assert "C0GENERAL" in defaults_by_channel(client, META, i)
    assert link_by_id(s["bob"], y, s["bob_link"])["default_org_id"] == y

    narrowed = put_org_access(client, i, {"orgs": [META]})
    assert narrowed.status_code == 200, narrowed.text
    gone = {r["org_id"]: r for r in narrowed.json()["removed"]}
    assert (gone[y]["channels"], gone[y]["links_moving"], gone[y]["links_unlinked"]) == (["general"], 0, 1)
    assert "C0GENERAL" not in defaults_by_channel(client, META, i)
    assert link_by_id(s["bob"], y, s["bob_link"]) is None


def test_disconnect_on_an_org_workspace_cleans_at_once(
    client: OpenObserveClient, ready: SlackMock, cleanup: list[tuple[str, str]]
) -> None:
    carol_email, dave_email = f"carol_{uniq()}@acme.test", f"dave_{uniq()}@acme.test"
    team = new_team(ready, slack_user("U0CAROL", "", carol_email), slack_user("U0DAVE", "", dave_email))
    a, b = make_slack_org(client), make_slack_org(client)
    inst = http_install(client, a, team)
    cleanup.append((a, inst["id"]))
    assert connect_with_proof(client, b, inst["id"], team_id=team).status_code == 200
    _, carol = make_user(client, b, "admin", email=carol_email)
    _, dave = make_user(client, b, "admin", email=dave_email)
    add_to_org(client, a, dave_email, "admin")
    assert set_default(client, b, inst["id"], "C0OPS", b).status_code == 200
    enable_linking(client, a, inst["id"])
    carol_link = mention_link(client, inst, team, "U0CAROL", carol, b)
    dave_link = mention_link(client, inst, team, "U0DAVE", dave, b)
    assert (carol_link["default_org_id"], dave_link["default_org_id"]) == (b, b)

    gone = client.delete(f"slack/installations/{inst['id']}/connection", org=b)
    assert gone.status_code == 200, gone.text
    assert "C0OPS" not in defaults_by_channel(client, a, inst["id"])
    assert link_by_id(carol, b, carol_link["id"]) is None, "R-86: unlinked at once, not by the hourly sweep"
    assert link_by_id(dave, a, dave_link["id"])["default_org_id"] == a, "repointed at once"


def test_a_new_org_under_all_is_served_and_a_removed_org_token_is_refused(
    client: OpenObserveClient, ready: SlackMock, cleanup: list[tuple[str, str]]
) -> None:
    key = signing_key()
    email = f"nia_{uniq()}@acme.test"
    team = new_team(ready, slack_user("U0NIA", "", email))
    inst = instance(client, ready, cleanup, team)
    assert put_org_access(client, inst["id"], {"all": True}).status_code == 200
    late = make_slack_org(client)
    _, nia = make_user(client, late, "admin", email=email)
    enable_linking(client, META, inst["id"])
    link = mention_link(client, inst, team, "U0NIA", nia, late)
    assert link["default_org_id"] == late
    ingest = client.post(f"{STREAM}/_json", json=[{"level": "error", "message": "iw"}], org=late)
    assert ingest.status_code == 200, ingest.text
    token = mint(key, sub=email, org=late, lid=link["id"])
    wait_until(lambda: search(client, late, token).status_code == 200, "the token of a new org under all admitted")

    assert put_org_access(client, inst["id"], {"orgs": [META]}).status_code == 200
    wait_until(lambda: search(client, late, token).status_code in (401, 403), "the removed org's token refused",
               timeout=40)


def test_instance_uninstall_cleans_every_served_org(
    client: OpenObserveClient, ready: SlackMock, cleanup: list[tuple[str, str]]
) -> None:
    email = f"nia_{uniq()}@acme.test"
    team = new_team(ready, slack_user("U0NIA", "", email))
    inst = instance(client, ready, cleanup, team)
    assert put_org_access(client, inst["id"], {"all": True}).status_code == 200
    late = make_slack_org(client)
    _, nia = make_user(client, late, "admin", email=email)
    assert set_default(nia, late, inst["id"], "C0ALERTS", late).status_code == 200, "a rowless all org's default"
    enable_linking(client, META, inst["id"])
    link = mention_link(client, inst, team, "U0NIA", nia, late)
    name = f"slack_iw_{uniq()}"
    made = nia.post("alerts/destinations", json=slack_destination(ready, team, inst["team_name"], name), org=late)
    assert made.status_code == 200, made.text

    refused = nia.delete(f"slack/installations/{inst['id']}", org=late)
    assert refused.status_code == 403, refused.text
    gone = client.delete(f"slack/installations/{inst['id']}", org=META)
    assert gone.status_code == 200, gone.text
    affected = gone.json()["affected"]
    assert name in {d["name"] for d in affected["destinations"]}, "every served org's destinations are listed"
    assert (affected["orgs"] >= 2, affected["links_revoked"] >= 1) == (True, True), affected
    assert link_by_id(nia, late, link["id"]) is None
    left = client.get(f"slack/installations/{inst['id']}/channel-defaults", org=META)
    assert left.status_code == 404 or left.json()["defaults"] == [], left.text


def test_org_access_put_writes_one_audit_record(
    client: OpenObserveClient, ready: SlackMock, cleanup: list[tuple[str, str]]
) -> None:
    inst = instance(client, ready, cleanup, new_team(ready))
    x, y = make_slack_org(client), make_slack_org(client)
    assert put_org_access(client, inst["id"], {"orgs": [META, x, y]}).status_code == 200
    time.sleep(1)
    since = int(time.time() * 1_000_000)
    assert put_org_access(client, inst["id"], {"orgs": [META, x], "preview": True}).status_code == 200
    assert put_org_access(client, inst["id"], {"orgs": [META, x]}).status_code == 200
    where = (f"(http_path LIKE '%{inst['id']}%' OR http_body LIKE '%{inst['id']}%') "
             "AND http_body LIKE '%before%' AND http_body LIKE '%after%' AND http_path NOT LIKE '%_search%'")
    wait_until(lambda: audit_rows(client, where, since), "the org-access audit record (O2_AUDIT_PUBLISH_INTERVAL=1)",
               timeout=40)
    time.sleep(3)
    records = audit_rows(client, where, since)
    assert len(records) == 1, f"one record for the save, none for the preview: {records}"
    assert y in records[0]["http_body"], "the record names the removed org"


def test_an_org_admin_runs_their_own_org_on_a_managed_workspace(
    client: OpenObserveClient, ready: SlackMock, cleanup: list[tuple[str, str]]
) -> None:
    team = new_team(ready)
    inst = instance(client, ready, cleanup, team)
    x, y = make_slack_org(client), make_slack_org(client)
    x_admin, y_admin = org_admin(client, x), org_admin(client, y)
    meta_admin = make_user(client, META, "admin")[1]
    assert put_org_access(client, inst["id"], {"orgs": [META, x, y]}).status_code == 200
    i = inst["id"]

    assert set_default(x_admin, x, i, "C0ALERTS", x).status_code == 200
    mode = set_default(x_admin, x, i, "C0ALERTS", x, "private")
    assert (mode.status_code, mode.json().get("answer_mode")) == (200, "private"), mode.text

    name = f"slack_iw_{uniq()}"
    payload = slack_destination(ready, team, inst["team_name"], name)
    assert x_admin.post("alerts/destinations", json=payload, org=x).status_code == 200
    assert view_in(x_admin, x, i)["this_org"]["destination_count"] == 1
    edited = x_admin.put(f"alerts/destinations/{name}", json={**payload, "skip_tls_verify": True}, org=x)
    assert edited.status_code == 200, edited.text
    assert x_admin.delete(f"alerts/destinations/{name}", org=x).status_code == 200
    assert view_in(x_admin, x, i)["this_org"]["destination_count"] == 0

    assert set_default(y_admin, y, i, "C0GENERAL", y).status_code == 200
    taken = set_default(x_admin, x, i, "C0GENERAL", x)
    assert taken.status_code == 403, f"moving another org's channel: {taken.text}"
    assert set_default(meta_admin, META, i, "C0GENERAL", x).status_code == 200
    assert defaults_by_channel(x_admin, x, i)["C0GENERAL"]["set_by_this_org"] is True


def test_instance_team_install_by_an_org_admin_is_refused_and_uninstalled(
    client: OpenObserveClient, ready: SlackMock, cleanup: list[tuple[str, str]]
) -> None:
    team = new_team(ready)
    inst = instance(client, ready, cleanup, team)
    set_meta_help(client, inst["id"])
    x = make_slack_org(client)
    admin = org_admin(client, x)

    creates = len(ready.calls("apps.manifest.create"))
    early = admin.post("slack/installations", json={"mode": "socket", "config_refresh_token": config_token(ready, team),
                                                    "app_name": "O2 x"}, org=x)
    if early.status_code == 201:
        cleanup.append((x, early.json()["installation"]["id"]))
    assert early.status_code == 409, early.text
    assert (early.json()["message"], early.json().get("error_detail"), early.json().get("hint")) == (
        INSTANCE_TEAM, "instance_team", META_HELP)
    assert len(ready.calls("apps.manifest.create")) == creates, "no Slack app is created"

    created = admin.post("slack/installations", json={"mode": "socket", "config_refresh_token": f"xoxe-1-{uuid.uuid4().hex}",
                                                      "app_name": "O2 x"}, org=x)
    assert created.status_code == 201, created.text
    pending = created.json()["installation"]["id"]
    cleanup.append((x, pending))
    client_id = query_param(created.json()["authorize_url"], "client_id")
    state = query_param(created.json()["authorize_url"], "state")
    finish = admin.post("slack/install/exchange", json={"code": mock_code(team_id=team), "state": state}, org=x)
    assert finish.status_code == 409, finish.text
    assert (finish.json()["message"], finish.json().get("error_detail"), finish.json().get("hint")) == (
        INSTANCE_TEAM, "instance_team", META_HELP)
    bot = ready.calls("oauth.v2.access")[-1]["response"]["access_token"]
    assert [(c["bearer"], c["form"].get("client_id")) for c in ready.calls("apps.uninstall")] == [(bot, client_id)]
    assert [(i["id"], i["status"]) for i in installations(admin, x)["installations"]] == [(pending, "pending")]
    assert admin.post(f"slack/installations/{pending}/install-url", org=x).status_code == 200, "Start over stays"


def test_org_access_preview_changes_nothing(
    client: OpenObserveClient, ready: SlackMock, cleanup: list[tuple[str, str]]
) -> None:
    s = linked_instance(client, ready, cleanup)
    i, x, y = s["inst"]["id"], s["x"], s["y"]
    before = org_access(client, i)
    preview = put_org_access(client, i, {"orgs": [META, y], "preview": True})
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body["removed"] == [{"org_id": x, "org_name": org_name(client, x), "channels": ["ops-private"],
                                "links_moving": 1, "links_unlinked": 1}], body
    assert {k: v for k, v in body.items() if k != "removed"} == before, "the current view, unchanged"
    assert org_access(client, i) == before
    assert defaults_by_channel(client, META, i)["C0OPS"]["channel_name"] == "ops-private"
    assert link_by_id(s["ann"], x, s["ann_link"])["default_org_id"] == x
    assert link_by_id(s["bob"], x, s["bob_link"])["default_org_id"] == x
