"""Objects stored in JSON columns (dashboards, annotations, reports, SLOs, saved views) must save, read back and update on Postgres."""
import time

import pytest

from conftest import unique_name

PANEL_ID = "panel_1"


def _ok(resp, what: str):
    assert resp.status_code == 200, f"{what}: {resp.status_code} {resp.text}"
    return resp.json()


def _dashboard_payload(title: str) -> dict:
    return {
        "version": 8,
        "title": title,
        "description": "db-testing dashboard ✓",
        "tabs": [{
            "tabId": "default",
            "name": "Default",
            "panels": [{
                "id": PANEL_ID,
                "type": "bar",
                "title": "Roundtrip panel",
                "description": "",
                "config": {"show_legends": True, "legends_position": None, "axis_border_show": False},
                "queryType": "sql",
                "queries": [],
                "layout": {"x": 0, "y": 0, "w": 12, "h": 6, "i": 1},
            }],
        }],
        "variables": {"list": [{"type": "constant", "name": "env", "label": "env", "value": "prod"}], "showDynamicFilters": True},
    }


def _inner(body: dict) -> dict:
    return body.get(f"v{body.get('version')}") or body


@pytest.fixture
def dashboard(api):
    created = _ok(api("POST", "dashboards?folder=default", json=_dashboard_payload(unique_name("rt_dash"))), "dashboard create")
    dashboard_id = _inner(created)["dashboardId"]
    yield dashboard_id
    api("DELETE", f"dashboards/{dashboard_id}?folder=default")


class TestDashboardRoundtrip:
    def test_dashboard_with_panels_and_variables_saves_reads_and_updates(self, api, dashboard):
        body = _ok(api("GET", f"dashboards/{dashboard}?folder=default"), "dashboard read")
        stored = _inner(body)
        assert stored["tabs"][0]["panels"][0]["id"] == PANEL_ID
        assert stored["variables"]["list"][0]["value"] == "prod"

        stored["description"] = "db-testing dashboard updated"
        _ok(api("PUT", f"dashboards/{dashboard}?folder=default&hash={body['hash']}", json=stored), "dashboard update")
        assert _inner(_ok(api("GET", f"dashboards/{dashboard}?folder=default"), "dashboard re-read"))["description"] == "db-testing dashboard updated"

    def test_timed_annotation_with_tags_roundtrips(self, api, dashboard):
        end = int(time.time() * 1_000_000)
        start = end - 3_600_000_000
        annotation = {"title": "Deploy ✓", "text": "db-testing release", "panels": [PANEL_ID], "start_time": start, "end_time": end, "tags": ["deploy", "db-testing"]}
        _ok(api("POST", f"dashboards/{dashboard}/annotations", json={"timed_annotations": [annotation]}), "annotation create")

        listed = _ok(api("GET", f"dashboards/{dashboard}/annotations", params={"panels": PANEL_ID, "start_time": start - 3_600_000_000, "end_time": end + 3_600_000_000}), "annotation read")
        rows = listed if isinstance(listed, list) else listed.get("timed_annotations", listed.get("list", []))
        match = [r for r in rows if r.get("title") == "Deploy ✓"]
        assert match, f"annotation missing from read back: {listed}"
        assert match[0]["tags"] == ["deploy", "db-testing"]


class TestReportRoundtrip:
    def test_report_with_every_dashboard_option_roundtrips(self, api, dashboard):
        name = unique_name("rt_report")
        report = {
            "name": name,
            "title": "db-testing report",
            "orgId": "default",
            "description": "db-testing report ✓",
            "message": "weekly numbers",
            "enabled": False,
            "frequency": {"type": "days", "interval": 1, "cron": "", "align_time": False},
            "start": int(time.time() * 1_000_000) + 3_600_000_000,
            "timezone": "Asia/Kolkata",
            "timezoneOffset": 330,
            "dashboards": [{
                "dashboard": dashboard,
                "folder": "default",
                "tabs": ["default"],
                "variables": [{"key": "env", "value": "prod"}],
                "timerange": {"type": "relative", "period": "30m", "from": 0, "to": 0},
                "report_type": "png",
                "email_attachment_type": "inline",
                "attachment_dimensions": {"width": 1280, "height": 720},
            }],
            "destinations": [{"email": "qa@example.com"}],
        }
        try:
            _ok(api("POST", "reports?folder=default", json=report), "report create")
            stored = _ok(api("GET", f"reports/{name}?folder=default"), "report read")
            entry = stored["dashboards"][0]
            assert entry["variables"] == [{"key": "env", "value": "prod"}]
            assert entry["timerange"]["period"] == "30m"
            assert entry["attachment_dimensions"] == {"width": 1280, "height": 720}
            assert stored["destinations"] == [{"email": "qa@example.com"}]

            stored["description"] = "db-testing report updated"
            _ok(api("PUT", f"reports/{name}?folder=default", json=stored), "report update")
            assert _ok(api("GET", f"reports/{name}?folder=default"), "report re-read")["description"] == "db-testing report updated"
        finally:
            api("DELETE", f"reports/{name}?folder=default")


class TestSloRoundtrip:
    def test_grouped_slo_with_tags_roundtrips(self, api, ingest_test_data, test_stream):
        ingest_test_data([{"level": "info", "status_code": 200, "service": "checkout"}])
        slo = {
            "name": unique_name("rt_slo"),
            "description": "db-testing slo ✓",
            "sli_type": "count",
            "config": {"source": {"mode": "single_query", "query": {"stream": test_stream, "stream_type": "logs", "good_expr": "status_code < 500"}}},
            "group_by": ["service"],
            "groups_estimate": 3,
            "window_secs": 604800,
            "slice_interval_secs": 300,
            "target": 99,
            "tags": ["db-testing", "tier:1"],
            "enabled": False,
        }
        slo_id = _ok(api("POST", "slos", json=slo), "slo create")["id"]
        try:
            stored = _ok(api("GET", f"slos/{slo_id}"), "slo read")
            assert stored["group_by"] == ["service"]
            assert stored["tags"] == ["db-testing", "tier:1"]
            assert stored["config"]["source"]["query"]["good_expr"] == "status_code < 500"

            stored["description"] = "db-testing slo updated"
            _ok(api("PUT", f"slos/{slo_id}", json=stored), "slo update")
            assert _ok(api("GET", f"slos/{slo_id}"), "slo re-read")["description"] == "db-testing slo updated"
        finally:
            api("DELETE", f"slos/{slo_id}")


class TestSavedViewRoundtrip:
    def test_saved_view_with_nested_data_roundtrips(self, api):
        data = {"query": 'SELECT * FROM "default"', "filters": [{"field": "level", "values": ["error", "警告"]}], "nested": {"depth": {"ok": True}}}
        view_id = _ok(api("POST", "savedviews", json={"view_name": unique_name("rt_view"), "data": data}), "saved view create")["view_id"]
        try:
            assert _ok(api("GET", f"savedviews/{view_id}"), "saved view read")["data"] == data
        finally:
            api("DELETE", f"savedviews/{view_id}")
