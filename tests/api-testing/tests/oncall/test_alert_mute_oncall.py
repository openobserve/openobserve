"""Until it clears and on-call, and who may mute (Slack app Phase 2, §6.3, §6.5, Δ2)  [P1]

The blocking case: an Until-it-clears mute on a single-row alert that notifies on recovery
must end at the moment the condition clears, as the system actor, so the recovery reaches
its destinations and the on-call page closes. Mute shares the ack rule, so the refusal
tests need OpenFGA on, like the ack ones.
"""
from __future__ import annotations

import pytest

from support.client import OpenObserveClient
from support.wait import wait_until

from .oncall_helpers import OnCallClient, make_user, paging_alert, uniq

pytestmark = pytest.mark.enterprise

SYSTEM_ACTOR = "system@openobserve.ai"
REC_TMPL = "oncall_pt_mute_tmpl"
REC_DEST = "oncall_pt_mute_dest"
REC_SINK = "oncall_pt_mute_sink"
DAY = 24 * 3600 * 1_000_000


def _mute(oncall: OnCallClient, alert_id: str, body: dict, client: OpenObserveClient | None = None):
    c = client or oncall._c
    return c.request("POST", f"alerts/{alert_id}/mute?folder=default", org=oncall.org, prefix="api/v2/", json=body)


def _downtime(oncall: OnCallClient, downtime_id: str) -> dict:
    r = oncall.v2("GET", f"downtimes/{downtime_id}")
    assert r.status_code == 200, r.text
    return r.json()


def _sends(oncall: OnCallClient, text: str) -> int:
    r = oncall._c.search.sql(
        f"SELECT COUNT(*) AS count FROM \"{REC_SINK}\" WHERE str_match(text, '{text}')",
        minutes=30, org=oncall.org, raise_for_status=False,
    )
    hits = r.json().get("hits", []) if r.status_code == 200 else []
    return int(hits[0].get("count", 0)) if hits else 0


def _history(oncall: OnCallClient, alert_id: str) -> list[dict]:
    r = oncall.v2("GET", f"alerts/history?alert_id={alert_id}&size=100&sort_by=timestamp&sort_order=desc")
    return (r.json().get("hits") or []) if r.status_code == 200 else []


def _seed_recovery_destination(oncall: OnCallClient) -> None:
    oncall.v1("POST", "alerts/templates", json={
        "name": REC_TMPL, "body": '{"text":"{alert_name} {alert_status}"}', "type": "http", "title": "",
    })
    destination = {
        "name": REC_DEST, "url": f"{oncall.base_url()}/api/{oncall.org}/{REC_SINK}/_json",
        "method": "post", "template": REC_TMPL, "type": "http", "headers": oncall.auth_header(),
    }
    oncall.v1("POST", "alerts/destinations", json=destination)
    oncall.v1("PUT", f"alerts/destinations/{REC_DEST}", json=destination)


def _paged_alert(oncall: OnCallClient, team_id: str, *, keep_firing_for: int = 0) -> tuple[str, str, str, dict]:
    _seed_recovery_destination(oncall)
    stream = uniq("mute_clear_stream")
    oncall.seed_rows(stream, [{"latency": 900}])
    name = uniq("mute_clear")
    alert = paging_alert(name, stream, oncall_team=team_id, destinations=[REC_DEST])
    alert["trigger_condition"]["period"] = 1
    alert["notify_on_recovery"] = True
    alert["keep_firing_for"] = keep_firing_for
    resp = oncall.create_alert(alert)
    assert resp.status_code == 200, resp.text
    alert_id = resp.json()["id"]

    def _paged():
        oncall.seed_rows(stream, [{"latency": 900}])
        pages = [p for p in oncall.pages_for(alert_id) if p.get("state") in ("triggered", "triaged")]
        return pages[0] if pages and _sends(oncall, f"{name} firing") >= 1 else None

    page = wait_until(_paged, timeout=240, interval=5, msg="the alert fires, delivers and pages")
    return name, stream, alert_id, page


@pytest.fixture(scope="module")
def admin(client: OpenObserveClient, oncall_org: str, oncall: OnCallClient) -> tuple[str, OpenObserveClient]:
    email, as_user = make_user(client, oncall_org, "admin")
    oncall.users.append(email)
    return email, as_user


def _non_admin(client: OpenObserveClient, org: str, oncall: OnCallClient, role: str):
    try:
        email, as_user = make_user(client, org, role)
    except AssertionError as e:
        if "require open-fga" in str(e):
            pytest.skip("non-admin roles need OpenFGA on")
        raise
    oncall.users.append(email)
    return email, as_user


def _until_clear_ends_on_the_clear(oncall: OnCallClient, team_id: str, keep_firing_for: int) -> tuple[dict, list]:
    name, _, alert_id, page = _paged_alert(oncall, team_id, keep_firing_for=keep_firing_for)
    muted = _mute(oncall, alert_id, {"until_clear": True})
    assert muted.status_code == 201, muted.text
    body = muted.json()
    assert body["end_on_clear"] == {"alert_id": alert_id, "group_key": None}
    dt = body["downtime_id"]
    assert _downtime(oncall, dt)["schedule"]["ends_at"] - _downtime(oncall, dt)["schedule"]["starts_at"] == DAY
    resolved_before = _sends(oncall, f"{name} resolved")

    # No more rows: the one-minute window empties and the condition clears.
    row = wait_until(lambda: (d := _downtime(oncall, dt)).get("cancelled_at") and d, timeout=420, interval=5,
                     msg="the clear ends the Until-it-clears mute")
    assert row["cancelled_by"] == SYSTEM_ACTOR, row
    wait_until(lambda: _sends(oncall, f"{name} resolved") > resolved_before, timeout=180, interval=5,
               msg="the recovery reaches the destination")
    wait_until(lambda: oncall.get_response(page["id"]).json()["response"]["state"] == "resolved",
               timeout=180, interval=5, msg="the on-call page closes")
    return row, _history(oncall, alert_id)


def test_until_it_clears_on_a_single_row_alert_lets_the_recovery_through_and_closes_the_page(
        oncall: OnCallClient, admin):
    admin_email, _ = admin
    team_id = oncall.staffed_team([admin_email])
    row, history = _until_clear_ends_on_the_clear(oncall, team_id, keep_firing_for=0)
    runs = [r for r in history if r.get("timestamp") == row["cancelled_at"]]
    assert runs, f"cancelled_at {row['cancelled_at']} is the clear run's evaluation time: {history[:5]}"
    assert all(r.get("status") != "suppressed" for r in runs)


def test_until_it_clears_with_keep_firing_for_ends_on_the_run_that_ends_the_hold(oncall: OnCallClient, admin):
    admin_email, _ = admin
    team_id = oncall.staffed_team([admin_email])
    row, history = _until_clear_ends_on_the_clear(oncall, team_id, keep_firing_for=90)
    assert history, "the alert ran"
    assert row["updated_at"] - row["cancelled_at"] >= 50 * 1_000_000, "stamped with the first clear, not the hold's end"


def test_the_mute_rule_refuses_a_viewer_with_names_and_lets_an_editor_and_a_responder_mute(
        client: OpenObserveClient, oncall_org: str, oncall: OnCallClient, admin):
    responder_email, as_responder = _non_admin(client, oncall_org, oncall, "user")
    _, as_viewer = _non_admin(client, oncall_org, oncall, "viewer")
    _, as_editor = _non_admin(client, oncall_org, oncall, "editor")
    admin_email, _ = admin
    team_id = oncall.staffed_team([responder_email])
    _, _, alert_id, _ = _paged_alert(oncall, team_id)

    refused = _mute(oncall, alert_id, {"minutes": 30}, client=as_viewer)
    assert refused.status_code == 403, refused.text
    body = refused.json()
    assert body["code"] == "mute_refused" and body["rule"] in ("role", "fga"), body
    assert responder_email in [p["email"] for p in body["on_call"]], body
    assert admin_email in [p["email"] for p in body["can_act"]], body

    by_responder = _mute(oncall, alert_id, {"minutes": 30}, client=as_responder)
    assert by_responder.status_code == 201, by_responder.text
    dt = by_responder.json()["downtime_id"]
    by_editor = _mute(oncall, alert_id, {"minutes": 30}, client=as_editor)
    assert by_editor.status_code == 409 and by_editor.json()["downtime_id"] == dt, "an editor passes the rule too"
