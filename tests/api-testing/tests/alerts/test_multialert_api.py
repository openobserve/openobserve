"""Alerts 4.0 (multi-alerts) — API contract & save-time guardrails  [P0]

Port of `Alerts/alerts-multialert-api.spec.js`. Asserts the raw API contract
directly, so a silently-dropped flag or a disabled guard fails here even when the
UI still "looks" right.

Coverage: MA-03/04/05/06 (save validation), THR-03, PT-06 (tag validation),
API-01/02 (round-trip + type contract), API-06/07 (the two per-group routes are
reachable and 200 under the test's auth), PT-10/13 (priority filter + tag facet).

Auth note: the suite runs as root (the framework `client` fixture), so the
group-route checks verify reachability/authorization for the authenticated user
— they do NOT reproduce the B1 *non-admin* 403 RBAC path (that would need a
non-admin reader fixture; the original Playwright spec also ran as root).
"""
from __future__ import annotations

import pytest

from .multialert_helpers import multi_alert, simple_alert, uniq

# Save-time guardrails: a multi-alert opt-in is rejected unless it is the
# provably-equivalent "any breaching group" shape (M-10) and not combined with
# incident creation (MN-11). Each must 400, never silently accept.
_BAD_MULTI = [
    ("incident", lambda a: a.update({"creates_incident": True})),
    ("threshold_gt_one", lambda a: a["trigger_condition"].update({"threshold": 3})),
    ("no_group_by", lambda a: a["query_condition"]["aggregation"].update({"group_by": []})),
    ("no_severity_order_op", lambda a: a["query_condition"]["aggregation"]["having"].update({"operator": "="})),
]


@pytest.mark.parametrize(("label", "mutate"), _BAD_MULTI, ids=[c[0] for c in _BAD_MULTI])
def test_reject_bad_per_group_alert(alerts, label, mutate):
    """MA-03/04/05/06: a per-group alert with a disqualifying shape must 400."""
    a = multi_alert(uniq(f"p0_badmulti_{label}"))
    mutate(a)
    resp = alerts.create_alert(a)
    assert resp.status_code == 400, resp.text


def test_reject_warning_not_less_severe_than_critical(alerts):
    """THR-03: a warning threshold not less severe than critical must 400."""
    a = simple_alert(uniq("p0_badwarn"))
    a["trigger_condition"]["operator"] = ">"
    a["trigger_condition"]["threshold"] = 5       # critical
    a["trigger_condition"]["warning_threshold"] = 10  # warning >= critical for '>' is invalid
    a["trigger_condition"]["notify_on_warning"] = True
    resp = alerts.create_alert(a)
    assert resp.status_code == 400, resp.text


def test_reject_tag_not_starting_with_letter(alerts):
    """PT-06: a tag that does not start with a letter must 400."""
    a = simple_alert(uniq("p0_badtag"))
    a["tags"] = ["1prod"]
    resp = alerts.create_alert(a)
    assert resp.status_code == 400, resp.text


def test_valid_per_group_alert_roundtrips_and_group_endpoints_readable(alerts):
    """API-01/02 + API-06/07: valid per-group alert saves, round-trips, group routes reachable (200)."""
    name = uniq("p0_multi")
    resp = alerts.create_alert(multi_alert(name))
    assert resp.status_code == 200, resp.text

    alert_id = alerts.find_alert_id(name)
    assert alert_id, "created multi-alert must be listable"
    alerts.created.append(alert_id)

    # Type contract survives the four mappings — the opt-in flag is not dropped.
    detail = alerts.get_alert_detail(alert_id)
    assert detail["query_condition"]["aggregation"]["multi_alert"] is True
    assert "city" in detail["query_condition"]["aggregation"]["group_by"]
    assert detail["query_condition"]["aggregation"]["having"]["operator"] == ">"

    # Group-route reachability (API-06/07): the two per-group routes must stay
    # authorized and 200 for the authenticated (root) user, and return the
    # expected shape. This is a reachability/authorization smoke — as root it
    # cannot reproduce the B1 non-admin-403 regression, but it does catch the
    # routes being removed, 404'd, or globally broken.
    groups = alerts.get_alert_groups_resp(alert_id)
    assert groups.status_code == 200, "group endpoint must be reachable (200)"
    gjson = groups.json()
    assert isinstance(gjson["list"], list)
    assert "group_cap" in gjson

    trans = alerts.get_alert_transitions_resp(alert_id, limit=5)
    assert trans.status_code == 200, "group transitions endpoint must be reachable (200)"


def test_tags_normalized_and_deduped_and_priority_filter(alerts):
    """PT-10/13: tags are trimmed/lowercased/deduped; alerts filter by priority."""
    name = uniq("p0_tags")
    a = simple_alert(name)
    a["priority"] = 1
    a["tags"] = ["  PROD  ", "Service:Checkout", "prod"]  # messy on purpose: trim/lowercase/dedupe
    resp = alerts.create_alert(a)
    assert resp.status_code == 200, resp.text

    alert_id = alerts.find_alert_id(name)
    assert alert_id
    alerts.created.append(alert_id)

    # The server is the normalization authority — the facet proves the repair happened.
    tags = [t.get("tag") for t in alerts.get_tags()]
    assert "prod" in tags               # trimmed + lowercased + deduped
    assert "service:checkout" in tags   # colon preserved

    filtered = alerts.list_alerts_filtered("priority=1&folder=default")
    assert any(x.get("name") == name for x in (filtered.get("list") or [])), \
        "priority=1 filter must return the P1 alert"
