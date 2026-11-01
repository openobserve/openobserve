"""Core alert bulk, tags and export endpoints  [#14427]."""
from __future__ import annotations

from support.wait import wait_until

from .multialert_helpers import STREAM, simple_alert, uniq

UNKNOWN_ID = "2zzzzzzzzzzzzzzzzzzzzzzzzzz"


def _create_named(alerts, tags: list[str] | None = None) -> tuple[str, str]:
    name = uniq("e2e_14427_alert")
    payload = simple_alert(name)
    payload["enabled"] = False
    if tags:
        payload["tags"] = tags
    resp = alerts.create_alert(payload)
    assert resp.status_code == 200, resp.text
    alert_id = resp.json()["id"]
    alerts.created.append(alert_id)
    return alert_id, name


def _create(alerts, tags: list[str] | None = None) -> str:
    return _create_named(alerts, tags)[0]


def _all_enabled_is(alerts, ids: list[str], value: bool) -> bool:
    found = [alerts.get_alert(i) for i in ids]
    return all(a is not None and a["enabled"] is value for a in found)


def test_enable_bulk_toggles_every_listed_alert(alerts):
    ids = [_create(alerts), _create(alerts)]

    on = alerts._v2("POST", "alerts/bulk/enable?value=true&folder=default", json={"ids": ids})
    assert on.status_code == 200, on.text
    assert sorted(on.json()["successful"]) == sorted(ids), on.text
    assert on.json()["unsuccessful"] == []
    wait_until(lambda: _all_enabled_is(alerts, ids, True), timeout=5, msg="alerts enabled")

    off = alerts._v2("POST", "alerts/bulk/enable?value=false&folder=default", json={"ids": ids})
    assert off.status_code == 200, off.text
    assert sorted(off.json()["successful"]) == sorted(ids), off.text
    assert off.json()["unsuccessful"] == []
    wait_until(lambda: _all_enabled_is(alerts, ids, False), timeout=5, msg="alerts disabled")


def test_enable_bulk_reports_unknown_id_as_unsuccessful(alerts):
    known = _create(alerts)
    resp = alerts._v2("POST", "alerts/bulk/enable?value=true&folder=default", json={"ids": [known, UNKNOWN_ID]})

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["successful"] == [known], resp.text
    assert body["unsuccessful"] == [UNKNOWN_ID], resp.text
    assert body.get("err"), resp.text


def test_enable_bulk_rejects_malformed_id_as_422(alerts):
    resp = alerts._v2("POST", "alerts/bulk/enable?value=true", json={"ids": ["nope"]})

    assert resp.status_code == 422, resp.text


def test_enable_bulk_requires_value_query(alerts):
    resp = alerts._v2("POST", "alerts/bulk/enable", json={"ids": [UNKNOWN_ID]})

    assert resp.status_code == 400, resp.text


def test_delete_bulk_removes_alerts_and_reports_them(alerts):
    ids = [_create(alerts), _create(alerts)]
    resp = alerts._v2("DELETE", "alerts/bulk?folder=default", json={"ids": ids})

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert sorted(body["successful"]) == sorted(ids)
    assert body["unsuccessful"] == []
    wait_until(lambda: all(alerts.get_alert(i) is None for i in ids), timeout=5, msg="alerts gone")


def test_delete_bulk_rejects_malformed_id(alerts):
    resp = alerts._v2("DELETE", "alerts/bulk?folder=default", json={"ids": ["nope"]})

    assert resp.status_code == 400, resp.text
    assert "invalid alert id" in resp.json()["message"]


def test_tags_endpoint_counts_tags_and_filters_by_prefix(alerts):
    tag = uniq("e2e_14427_tag").lower()
    _create(alerts, tags=[tag])
    _create(alerts, tags=[tag])

    def _count() -> int | None:
        resp = alerts._v2("GET", f"alerts/tags?prefix={tag}")
        assert resp.status_code == 200, resp.text
        return {r["tag"]: r["count"] for r in resp.json()}.get(tag)

    wait_until(lambda: _count() == 2, timeout=5, msg="tag count reaches 2")

    miss = alerts._v2("GET", f"alerts/tags?prefix={uniq('zzznomatch').lower()}")
    assert miss.status_code == 200
    assert miss.json() == []


def test_export_alert_returns_the_configuration(alerts):
    alert_id, name = _create_named(alerts)
    resp = alerts._v2("POST", f"alerts/{alert_id}/export")

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["stream_name"] == STREAM
    assert body["name"] == name


def test_export_unknown_or_malformed_alert_is_404(alerts):
    assert alerts._v2("POST", f"alerts/{UNKNOWN_ID}/export").status_code == 404
    assert alerts._v2("POST", "alerts/notksuid/export").status_code == 404
