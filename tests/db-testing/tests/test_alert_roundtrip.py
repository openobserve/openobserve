"""Alerts with every optional field set must save, read back, update and clear on Postgres (empty fields are NULL and skip sqlx's type check)."""
import pytest

from conftest import unique_name

LONG_TEXT = "Überwachung ✓ 監視 " * 120


def _alert_payload(name: str, stream: str, dest: str) -> dict:
    return {
        "name": name,
        "stream_type": "logs",
        "stream_name": stream,
        "is_real_time": False,
        "query_condition": {
            "type": "custom",
            "conditions": {"version": 2, "conditions": {"filterType": "group", "logicalOperator": "AND", "conditions": []}},
            "sql": None, "promql": None, "promql_condition": None, "aggregation": None,
            "vrl_function": None, "search_event_type": None, "multi_time_range": [],
        },
        "trigger_condition": {
            "period": 10, "operator": ">=", "threshold": 5, "frequency": 10, "cron": "",
            "frequency_type": "minutes", "silence": 10, "timezone": "UTC", "align_time": True,
            "warning_threshold": 2, "notify_on_warning": True,
        },
        "destinations": [dest],
        "context_attributes": {"team": "qa", "service": "db-testing"},
        "row_template": "{level}: {message}",
        "enabled": True,
        "description": "db-testing roundtrip",
        "priority": 2,
        "tags": ["roundtrip", "service:db-testing"],
        "runbook_url": "https://example.com/runbooks/roundtrip",
        "deduplication": {"enabled": True, "fingerprint_fields": ["level"], "time_window_minutes": 30},
        "notify_on_recovery": True,
        # Regression for #15434: a non-empty list forces the decode that broke on Postgres.
        "recovery_destinations": [dest],
        "pending_period_sec": 60,
        "keep_firing_for": 60,
    }


def _realtime(payload: dict) -> dict:
    # Realtime alerts reject pending, warning, recovery and keep-firing settings (alert.rs validate).
    payload.update(is_real_time=True, pending_period_sec=0, notify_on_recovery=False, recovery_destinations=[], keep_firing_for=0)
    payload["trigger_condition"].pop("warning_threshold")
    payload["trigger_condition"].pop("notify_on_warning")
    return payload


def _grouped(payload: dict) -> dict:
    payload["query_condition"]["aggregation"] = {
        "group_by": ["level"], "function": "count",
        "having": {"column": "level", "operator": ">=", "value": 1},
    }
    payload["query_condition"]["multi_time_range"] = [{"offSet": "1h"}]
    payload["trigger_condition"]["threshold"] = 1
    payload["trigger_condition"].pop("warning_threshold")
    payload["trigger_condition"].pop("notify_on_warning")
    return payload


@pytest.fixture
def created_alerts(api):
    ids = []
    yield ids
    for alert_id in ids:
        api("DELETE", f"alerts/{alert_id}", v2=True)


def _create(api, created_alerts, payload: dict) -> str:
    resp = api("POST", "alerts?folder=default", v2=True, json=payload)
    assert resp.status_code == 200, f"create {payload['name']}: {resp.status_code} {resp.text}"
    alert_id = resp.json().get("id")
    assert alert_id, f"create must return the new id: {resp.text}"
    created_alerts.append(alert_id)
    return alert_id


def _read(api, alert_id: str) -> dict:
    resp = api("GET", f"alerts/{alert_id}", v2=True)
    assert resp.status_code == 200, f"read back {alert_id}: {resp.status_code} {resp.text}"
    return resp.json()


def _update(api, alert_id: str, alert: dict) -> dict:
    resp = api("PUT", f"alerts/{alert_id}?folder=default", v2=True, json=alert)
    assert resp.status_code == 200, f"update {alert_id}: {resp.status_code} {resp.text}"
    return _read(api, alert_id)


def _assert_filled(stored: dict, dest: str, *, recovery: bool = True) -> None:
    assert stored["recovery_destinations"] == ([dest] if recovery else [])
    assert stored["destinations"] == [dest]
    assert stored["context_attributes"] == {"team": "qa", "service": "db-testing"}
    assert stored["tags"] == ["roundtrip", "service:db-testing"]
    assert stored["deduplication"]["fingerprint_fields"] == ["level"]
    assert stored["runbook_url"] == "https://example.com/runbooks/roundtrip"


class TestAlertRoundtrip:
    @pytest.mark.parametrize("realtime", [False, True], ids=["scheduled", "realtime"])
    def test_alert_with_every_optional_field_saves_reads_and_updates(self, api, destination, test_stream, created_alerts, realtime):
        payload = _alert_payload(unique_name("rt_alert"), test_stream, destination)
        alert_id = _create(api, created_alerts, _realtime(payload) if realtime else payload)
        stored = _read(api, alert_id)
        _assert_filled(stored, destination, recovery=not realtime)
        if realtime:
            assert "warning_threshold" not in stored["trigger_condition"]
        else:
            assert stored["trigger_condition"]["warning_threshold"] == 2

        stored["description"] = "db-testing roundtrip updated"
        updated = _update(api, alert_id, stored)
        assert updated["description"] == "db-testing roundtrip updated"
        _assert_filled(updated, destination, recovery=not realtime)

        resp = api("GET", "alerts", v2=True)
        assert resp.status_code == 200, f"list: {resp.status_code} {resp.text}"
        assert alert_id in [a.get("alert_id") for a in resp.json()["list"]]

    def test_grouped_alert_with_comparison_window_roundtrips(self, api, destination, test_stream, created_alerts):
        alert_id = _create(api, created_alerts, _grouped(_alert_payload(unique_name("rt_grouped"), test_stream, destination)))
        stored = _read(api, alert_id)
        assert stored["query_condition"]["aggregation"]["group_by"] == ["level"]
        assert stored["query_condition"]["multi_time_range"] == [{"offSet": "1h"}]
        _assert_filled(stored, destination)

        _update(api, alert_id, stored)

    def test_optional_fields_clear_to_empty_and_fill_again(self, api, destination, test_stream, created_alerts):
        alert_id = _create(api, created_alerts, _alert_payload(unique_name("rt_clear"), test_stream, destination))
        stored = _read(api, alert_id)

        stored.update(recovery_destinations=[], tags=[], context_attributes={}, deduplication={"enabled": False})
        stored.pop("runbook_url")
        cleared = _update(api, alert_id, stored)
        assert cleared["recovery_destinations"] == []
        assert cleared["context_attributes"] == {}
        # The API omits empty tags, an unset runbook and disabled dedup instead of sending empties.
        for absent in ("tags", "runbook_url", "deduplication"):
            assert absent not in cleared, f"{absent} must be cleared, got {cleared[absent]!r}"

        filled = _alert_payload(cleared["name"], test_stream, destination)
        refill = {k: filled[k] for k in ("recovery_destinations", "tags", "context_attributes", "runbook_url", "deduplication")}
        _assert_filled(_update(api, alert_id, {**cleared, **refill}), destination)

    def test_unicode_and_long_values_roundtrip(self, api, destination, test_stream, created_alerts):
        payload = _alert_payload(unique_name("rt_unicode"), test_stream, destination)
        payload["description"] = LONG_TEXT
        payload["context_attributes"] = {"owner": "équipe-监控", "note": LONG_TEXT}
        alert_id = _create(api, created_alerts, payload)

        stored = _read(api, alert_id)
        assert stored["description"] == LONG_TEXT
        assert stored["context_attributes"] == {"owner": "équipe-监控", "note": LONG_TEXT}


class TestCompositeAlertRoundtrip:
    def test_composite_with_every_optional_field_roundtrips(self, api, destination, test_stream, created_alerts):
        children = [_create(api, created_alerts, _alert_payload(unique_name("rt_child"), test_stream, destination)) for _ in range(2)]
        composite = {
            "alert_type": "composite",
            "name": unique_name("rt_composite"),
            "description": "db-testing composite",
            "enabled": False,
            "destinations": [destination],
            "context_attributes": {"service": "db-testing"},
            "trigger_condition": {"silence": 15},
            "creates_incident": False,
            "workflows": [],
            "priority": 2,
            "tags": ["env:test", "kind:composite"],
            "composite_condition": {
                "expression": " && ".join(f"{{{c}}}" for c in children),
                "warning_counts_as_firing": True,
                "stale_child_policy": "use_last_state",
            },
        }
        resp = api("POST", "alerts?folder=default", v2=True, json=composite)
        assert resp.status_code == 200, f"composite create: {resp.status_code} {resp.text}"
        listed = api("GET", "alerts", v2=True)
        assert listed.status_code == 200, f"list: {listed.status_code} {listed.text}"
        row = next((a for a in listed.json()["list"] if a.get("name") == composite["name"]), None)
        assert row, f"{composite['name']} missing from the alert list"
        # A composite must be deleted before the children it references.
        created_alerts.insert(0, row["alert_id"])

        stored = _read(api, row["alert_id"])
        assert stored["destinations"] == [destination]
        assert stored["context_attributes"] == {"service": "db-testing"}
        assert stored["tags"] == ["env:test", "kind:composite"]

        # Composite saves reject read-only fields (e.g. `id`) that a read returns.
        update = {**composite, "description": "db-testing composite updated"}
        assert _update(api, row["alert_id"], update)["description"] == "db-testing composite updated"
