"""
An alert with every optional field set must save, read back and update on the
Postgres meta store. Empty optional fields are stored as NULL, which skips
sqlx's type check, so only a filled-in alert exercises every column.
"""
import uuid

import pytest
import requests


def _name(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


@pytest.fixture
def api(openobserve_base_url, auth_credentials, test_org):
    session = requests.Session()
    session.auth = auth_credentials

    def _call(method: str, path: str, *, v2: bool = False, **kwargs) -> requests.Response:
        prefix = "api/v2" if v2 else "api"
        return session.request(method, f"{openobserve_base_url}/{prefix}/{test_org}/{path}", **kwargs)

    yield _call
    session.close()


@pytest.fixture
def destination(api, ingest_test_data):
    ingest_test_data([{"level": "error", "message": "alert roundtrip seed"}])
    template = _name("rt_template")
    resp = api("POST", "alerts/templates", json={"name": template, "body": '{"text": "{alert_name}"}', "type": "http", "title": ""})
    assert resp.status_code == 200, f"template create: {resp.status_code} {resp.text}"

    dest = _name("rt_dest")
    resp = api(
        "POST",
        "alerts/destinations",
        json={"name": dest, "url": "http://localhost:0/sink", "method": "post", "template": template, "headers": {}, "skip_tls_verify": False},
    )
    assert resp.status_code == 200, f"destination create: {resp.status_code} {resp.text}"

    yield dest

    api("DELETE", f"alerts/destinations/{dest}")
    api("DELETE", f"alerts/templates/{template}")


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
            "period": 10, "operator": ">=", "threshold": 3, "frequency": 10, "cron": "",
            "frequency_type": "minutes", "silence": 10, "timezone": "UTC", "align_time": True,
        },
        "destinations": [dest],
        "context_attributes": {"team": "qa"},
        "row_template": "",
        "enabled": True,
        "description": "db-testing roundtrip",
        "priority": 2,
        "tags": ["roundtrip"],
        "notify_on_recovery": True,
        "recovery_destinations": [dest],
        "pending_period_sec": 60,
        "keep_firing_for": 60,
    }


class TestAlertRoundtrip:
    def test_alert_with_every_optional_field_saves_reads_and_updates(self, api, destination, test_stream):
        resp = api("POST", "alerts?folder=default", v2=True, json=_alert_payload(_name("rt_alert"), test_stream, destination))
        assert resp.status_code == 200, f"create: {resp.status_code} {resp.text}"
        alert_id = resp.json().get("id")
        assert alert_id, f"create must return the new id: {resp.text}"

        try:
            resp = api("GET", f"alerts/{alert_id}", v2=True)
            assert resp.status_code == 200, f"read back: {resp.status_code} {resp.text}"
            stored = resp.json()
            assert stored["recovery_destinations"] == [destination]
            assert stored["context_attributes"] == {"team": "qa"}
            assert stored["tags"] == ["roundtrip"]

            stored["description"] = "db-testing roundtrip updated"
            resp = api("PUT", f"alerts/{alert_id}", v2=True, json=stored)
            assert resp.status_code == 200, f"update: {resp.status_code} {resp.text}"

            resp = api("GET", f"alerts/{alert_id}", v2=True)
            assert resp.status_code == 200, f"read after update: {resp.status_code} {resp.text}"
            assert resp.json()["description"] == "db-testing roundtrip updated"
            assert resp.json()["recovery_destinations"] == [destination]

            resp = api("GET", "alerts", v2=True)
            assert resp.status_code == 200, f"list: {resp.status_code} {resp.text}"
        finally:
            api("DELETE", f"alerts/{alert_id}", v2=True)
