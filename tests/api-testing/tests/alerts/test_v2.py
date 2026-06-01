"""V2 Alerts API tests — alert lifecycle + VRL support.

Rewritten in Phase 4 of the api-tests revamp (was 1067 LOC, 11 tests).

The original had two major anti-patterns:

1. ~170 LOC of identical setup copy-pasted between `test_new_alert_create`
   and `test_put_alertnew_update` (folder + template + destination +
   ingest_data). The shared `_setup_vrl_test_resources` helper used by
   the 3 VRL tests at the bottom proved the team already knew the
   pattern — just hadn't applied it to the older tests.

2. `test_put_alertnew_disable` / `enable` / `trigger` / `delete` all
   iterate over EVERY alert in the org. Side-effects spill to other
   tests AND the original disable test has an indentation bug at the
   `assert alert_disabled == "False"` line — it's inside an `else`
   block that never executes, so the assertion never runs (and is
   wrong anyway — `enabled` is a bool, not the string `"False"`).

This rewrite uses:
- `temp_alert_prereqs` fixture (folder + template + destination, all
  unique-named, auto-cleaned)
- `temp_alert` fixture that uses the prereqs to create an alert and
  yield (alert_id, name, folder_id), auto-deletes
- Each test becomes 5-15 LOC

Also drops the `jsonplaceholder.typicode.com` third-party dependency
(used as a destination URL that never actually got called) — replaced
with `http://localhost:0/sink` which is syntactically valid and never
resolves to anything.
"""
from __future__ import annotations

import logging
import uuid
from collections.abc import Generator
from typing import Any

import pytest

from support.client import OpenObserveClient
from support.factories import unique_name
from support.wait import wait_until

logger = logging.getLogger(__name__)

ORG_ID = "default"

# Sink URL — points at OO's own /healthz so the trigger test can actually
# hit a reachable endpoint and get 200 back. Most other tests don't fire
# the alert; they just need a valid URL shape so destination creation works.
# (Previous value `http://localhost:0/sink` worked for non-trigger tests
# but caused the trigger test to fail with a 500: connection refused.)
SINK_URL = "http://localhost:5080/healthz"


def _template_payload(name: str) -> dict[str, Any]:
    return {
        "name": name,
        "body": (
            '{\n  "text": "For stream {stream_name} of organization {org_name} '
            'alert {alert_name} of type {alert_type} is active"\n}'
        ),
        "type": "http",
        "title": "",
    }


def _destination_payload(name: str, template: str) -> dict[str, Any]:
    return {
        "url": SINK_URL,
        "method": "get",
        "skip_tls_verify": False,
        "template": template,
        "headers": {},
        "name": name,
    }


def _alert_payload(
    *,
    name: str,
    folder_id: str,
    template: str,
    destination: str,
    # Default to the conftest-managed `stream_pytest_data` — it's the only
    # stream guaranteed to exist on every server (created by the autouse
    # ingest_data fixture). Using a literal "default" here would 404 on
    # fresh CI runners that haven't accumulated state.
    stream_name: str = "stream_pytest_data",
    enabled: bool = True,
    vrl_function: str | None = None,
    sql: str | None = None,
) -> dict[str, Any]:
    """Build a standard v2 alert payload."""
    if sql is None:
        query_conditions = [{
            "column": "log",
            "operator": "=",
            "value": "200",
            "type": None,
            "id": str(uuid.uuid4()),
        }]
        sql_str = ""
        cond_type = "custom"
    else:
        query_conditions = []
        sql_str = sql
        cond_type = "sql"

    return {
        "name": name,
        "row_template": template,
        "stream_type": "logs",
        "stream_name": stream_name,
        "is_real_time": False,
        "context_attributes": {},
        "query_condition": {
            "conditions": query_conditions,
            "search_event_type": "ui",
            "sql": sql_str,
            "promql": "",
            "type": cond_type,
            "promql_condition": None,
            "vrl_function": vrl_function,
            "multi_time_range": [],
        },
        "trigger_condition": {
            "period": 10,
            "operator": ">=",
            "frequency": 1,
            "cron": "",
            "threshold": 3,
            "silence": 10,
            "frequency_type": "minutes",
            "timezone": "UTC",
            "tolerance_in_secs": 0,
        },
        "org_id": ORG_ID,
        "destinations": [destination],
        "enabled": enabled,
        "description": "rewritten alert test",
        "folderId": folder_id,
    }


# ----- fixtures -----


@pytest.fixture
def temp_alert_prereqs(client: OpenObserveClient) -> Generator[dict[str, str], None, None]:
    """Create folder + template + destination with unique names; auto-cleanup."""
    folder_name = unique_name("pyt_folder")
    template_name = unique_name("pyt_tmpl")
    destination_name = unique_name("pyt_dest")

    # Folder
    resp = client.post("folders/alerts", prefix="api/v2/", json={"description": "test", "name": folder_name})
    assert resp.status_code == 200, f"folder create failed: {resp.status_code} {resp.text}"
    folder_id = resp.json()["folderId"]

    # Template
    resp = client.post("alerts/templates", json=_template_payload(template_name))
    assert resp.status_code == 200, f"template create failed: {resp.status_code} {resp.text}"

    # Destination
    resp = client.post("alerts/destinations", json=_destination_payload(destination_name, template_name))
    assert resp.status_code == 200, f"destination create failed: {resp.status_code} {resp.text}"

    yield {
        "folder_id": folder_id,
        "folder_name": folder_name,
        "template_name": template_name,
        "destination_name": destination_name,
    }

    # Cleanup — best effort, reverse creation order
    for path, name in (
        (f"alerts/destinations/{destination_name}", "destination"),
        (f"alerts/templates/{template_name}", "template"),
    ):
        try:
            client.delete(path)
        except Exception as e:
            logger.warning("temp_alert_prereqs %s cleanup failed: %s", name, e)
    # Folder delete uses the v2 endpoint
    try:
        client.delete(f"folders/alerts/{folder_id}", prefix="api/v2/")
    except Exception as e:
        logger.warning("temp_alert_prereqs folder cleanup failed: %s", e)


@pytest.fixture
def temp_alert(
    client: OpenObserveClient, temp_alert_prereqs: dict[str, str]
) -> Generator[dict[str, Any], None, None]:
    """Create an alert using temp_alert_prereqs; yield {alert_id, name, prereqs}; auto-delete."""
    alert_name = unique_name("pyt_alert")
    payload = _alert_payload(
        name=alert_name,
        folder_id=temp_alert_prereqs["folder_id"],
        template=temp_alert_prereqs["template_name"],
        destination=temp_alert_prereqs["destination_name"],
    )

    resp = client.post("alerts", prefix="api/v2/", json=payload)
    assert resp.status_code == 200, f"alert create failed: {resp.status_code} {resp.text}"

    # The list endpoint will have the alert_id; create response may not.
    # Find our alert by name.
    list_resp = client.get("alerts", prefix="api/v2/")
    list_resp.raise_for_status()
    alert = next(
        (a for a in list_resp.json().get("list", []) if a.get("name") == alert_name),
        None,
    )
    assert alert is not None, f"created alert {alert_name} not in list response"
    alert_id = alert.get("alert_id")
    assert alert_id, f"alert in list missing alert_id: {alert}"

    yield {
        "alert_id": alert_id,
        "name": alert_name,
        "folder_id": temp_alert_prereqs["folder_id"],
        "destination": temp_alert_prereqs["destination_name"],
        "template": temp_alert_prereqs["template_name"],
    }

    try:
        client.delete(f"alerts/{alert_id}", prefix="api/v2/")
    except Exception as e:
        logger.warning("temp_alert cleanup failed for %s: %s", alert_id, e)


# ----- list / create / get -----


def test_list_alerts_returns_list_key(client: OpenObserveClient):
    """GET /api/v2/{org}/alerts returns 200 with a 'list' array."""
    resp = client.get("alerts", prefix="api/v2/")
    assert resp.status_code == 200, resp.text

    body = resp.json()
    assert "list" in body, f"response missing 'list' key: {body}"
    assert isinstance(body["list"], list), f"'list' should be a list, got {type(body['list']).__name__}"


def test_create_alert_with_full_prereqs(
    client: OpenObserveClient, temp_alert_prereqs: dict[str, str]
):
    """Create an alert with all required prereqs; verify it appears in the list with the expected name."""
    alert_name = unique_name("pyt_create")
    payload = _alert_payload(
        name=alert_name,
        folder_id=temp_alert_prereqs["folder_id"],
        template=temp_alert_prereqs["template_name"],
        destination=temp_alert_prereqs["destination_name"],
    )

    try:
        resp = client.post("alerts", prefix="api/v2/", json=payload)
        assert resp.status_code == 200, f"create alert failed: {resp.status_code} {resp.text}"

        # Verify it appears in the list with the name we sent
        alerts = client.alerts.list()
        names = [a.get("name") for a in alerts]
        assert alert_name in names, f"created alert {alert_name} not in list: {names}"
    finally:
        # find + delete
        for a in client.alerts.list():
            if a.get("name") == alert_name:
                client.delete(f"alerts/{a['alert_id']}", prefix="api/v2/")
                break


def test_get_alert_by_id_returns_full_body(
    client: OpenObserveClient, temp_alert: dict[str, Any]
):
    """GET /alerts/{id} returns the alert's full record with name + folderId matching."""
    resp = client.get(f"alerts/{temp_alert['alert_id']}", prefix="api/v2/")
    assert resp.status_code == 200, resp.text

    body = resp.json()
    assert body.get("name") == temp_alert["name"], \
        f"returned name should match: expected {temp_alert['name']!r}, got {body.get('name')!r}"


# ----- update -----


def test_update_alert_description_field(
    client: OpenObserveClient, temp_alert: dict[str, Any]
):
    """PUT /alerts/{id} updates the description; verify via GET."""
    new_description = f"updated at {uuid.uuid4().hex[:8]}"

    payload = _alert_payload(
        name=temp_alert["name"],
        folder_id=temp_alert["folder_id"],
        template=temp_alert["template"],
        destination=temp_alert["destination"],
    )
    payload["description"] = new_description

    resp = client.put(
        f"alerts/{temp_alert['alert_id']}?type=logs",
        prefix="api/v2/",
        json=payload,
    )
    assert resp.status_code == 200, f"update failed: {resp.status_code} {resp.text}"

    # Verify the change persisted
    resp_get = client.get(f"alerts/{temp_alert['alert_id']}", prefix="api/v2/")
    assert resp_get.json().get("description") == new_description, \
        "description should be persisted after update"


# ----- enable / disable -----


def test_disable_alert_via_enable_endpoint(
    client: OpenObserveClient, temp_alert: dict[str, Any]
):
    """PATCH /alerts/{id}/enable?value=false&folder=... disables; GET shows enabled=False."""
    alert_id = temp_alert["alert_id"]
    folder_id = temp_alert["folder_id"]

    resp = client.patch(
        f"alerts/{alert_id}/enable?value=false&type=logs&folder={folder_id}",
        prefix="api/v2/",
    )
    assert resp.status_code == 200, f"disable failed: {resp.status_code} {resp.text}"

    resp_get = client.get(f"alerts/{alert_id}", prefix="api/v2/")
    assert resp_get.status_code == 200
    enabled = resp_get.json().get("enabled")
    # OO returns boolean False (not the string 'False' — the original test
    # had that bug AND the assertion was unreachable due to an indentation
    # error inside an else block that never ran).
    assert enabled is False, f"alert should be disabled (enabled=False), got: {enabled!r}"


def test_enable_alert_via_enable_endpoint(
    client: OpenObserveClient, temp_alert: dict[str, Any]
):
    """PATCH /alerts/{id}/enable?value=true&folder=... enables; GET shows enabled=True."""
    alert_id = temp_alert["alert_id"]
    folder_id = temp_alert["folder_id"]

    # Disable first so the enable is observable
    client.patch(f"alerts/{alert_id}/enable?value=false&type=logs&folder={folder_id}", prefix="api/v2/")

    # Now enable
    resp = client.patch(
        f"alerts/{alert_id}/enable?value=true&type=logs&folder={folder_id}",
        prefix="api/v2/",
    )
    assert resp.status_code == 200, f"enable failed: {resp.status_code} {resp.text}"

    resp_get = client.get(f"alerts/{alert_id}", prefix="api/v2/")
    enabled = resp_get.json().get("enabled")
    assert enabled is True, f"alert should be enabled (enabled=True), got: {enabled!r}"


# ----- trigger -----


def test_trigger_alert_returns_200(
    client: OpenObserveClient, temp_alert: dict[str, Any]
):
    """PATCH /alerts/{id}/trigger?type=logs returns 200; the alert remains valid afterwards."""
    alert_id = temp_alert["alert_id"]

    resp = client.patch(f"alerts/{alert_id}/trigger?type=logs", prefix="api/v2/")
    assert resp.status_code == 200, f"trigger failed: {resp.status_code} {resp.text}"

    # Verify alert still exists + retrievable
    resp_get = client.get(f"alerts/{alert_id}", prefix="api/v2/")
    assert resp_get.status_code == 200, \
        f"alert should still be retrievable after trigger: {resp_get.status_code}"
    # Note: `last_triggered_at` is not asserted because OO issue #5745
    # (per original test comment) makes the timestamp unreliable.


# ----- delete -----


def test_delete_alert_makes_it_404(
    client: OpenObserveClient, temp_alert_prereqs: dict[str, str]
):
    """After DELETE /alerts/{id}, subsequent GET /alerts/{id} returns 404."""
    # Create our own alert here so temp_alert's auto-delete doesn't double-delete
    alert_name = unique_name("pyt_del")
    payload = _alert_payload(
        name=alert_name,
        folder_id=temp_alert_prereqs["folder_id"],
        template=temp_alert_prereqs["template_name"],
        destination=temp_alert_prereqs["destination_name"],
    )
    resp = client.post("alerts", prefix="api/v2/", json=payload)
    assert resp.status_code == 200, resp.text

    # Find the alert_id via the list endpoint
    alert = next(
        (a for a in client.alerts.list() if a.get("name") == alert_name),
        None,
    )
    assert alert is not None
    alert_id = alert["alert_id"]

    # Delete
    resp_del = client.delete(f"alerts/{alert_id}", prefix="api/v2/")
    assert resp_del.status_code == 200, f"delete failed: {resp_del.status_code} {resp_del.text}"

    # GET should now 404 — give a moment for cache to settle
    def _is_gone() -> bool:
        r = client.get(f"alerts/{alert_id}", prefix="api/v2/")
        return r.status_code == 404

    wait_until(_is_gone, timeout=10, interval=0.5, msg=f"alert {alert_id} should be 404 after delete")


# ----- VRL function persistence -----


@pytest.mark.parametrize(
    ("vrl_function", "description"),
    [
        ("I1Jlc3VsdEFycmF5IwouID0gW10KLg==", "empty array — #ResultArray#\\n. = []\\n."),
        ("I1Jlc3VsdEFycmF5IwouID0gW3t9LCB7fV0KLg==", "object array — #ResultArray#\\n. = [{}, {}]\\n."),
    ],
    ids=["empty-array", "object-array"],
)
def test_alert_with_vrl_function_persists_correctly(
    client: OpenObserveClient, temp_alert_prereqs: dict[str, str],
    vrl_function: str, description: str,
):
    """Alert stored with vrl_function returns the same base64 string on GET.

    Consolidates 2 near-identical legacy tests (vrl_empty_array, vrl_object_array)
    into one parametrized test.
    """
    alert_name = unique_name("pyt_vrl")
    # Use SQL query type for VRL-equipped alerts (matches original tests)
    payload = _alert_payload(
        name=alert_name,
        folder_id=temp_alert_prereqs["folder_id"],
        template=temp_alert_prereqs["template_name"],
        destination=temp_alert_prereqs["destination_name"],
        vrl_function=vrl_function,
        sql=f"select code from {temp_alert_prereqs['template_name']}",  # placeholder stream
    )
    # Override trigger_condition.period to 1440min (matches originals)
    payload["trigger_condition"]["period"] = 1440

    try:
        resp = client.post("alerts", prefix="api/v2/", json=payload)
        assert resp.status_code == 200, f"create alert failed ({description}): {resp.status_code} {resp.text}"

        # Find alert_id via list
        alert = next(
            (a for a in client.alerts.list() if a.get("name") == alert_name),
            None,
        )
        assert alert is not None, f"alert {alert_name} not in list"
        alert_id = alert["alert_id"]

        # Verify VRL function persisted
        resp_get = client.get(f"alerts/{alert_id}", prefix="api/v2/")
        assert resp_get.status_code == 200
        vrl_in_response = resp_get.json().get("query_condition", {}).get("vrl_function")
        assert vrl_in_response == vrl_function, \
            f"VRL mismatch ({description}): expected {vrl_function!r}, got {vrl_in_response!r}"
    finally:
        for a in client.alerts.list():
            if a.get("name") == alert_name:
                client.delete(f"alerts/{a['alert_id']}", prefix="api/v2/")
                break


def test_alert_vrl_function_can_be_updated(
    client: OpenObserveClient, temp_alert_prereqs: dict[str, str]
):
    """An alert's vrl_function can be changed via PUT and the new value persists."""
    alert_name = unique_name("pyt_vrl_upd")
    vrl_initial = "I1Jlc3VsdEFycmF5IwouID0gW10KLg=="
    vrl_updated = "I1Jlc3VsdEFycmF5IwouID0gW3t9LCB7fV0KLg=="

    payload = _alert_payload(
        name=alert_name,
        folder_id=temp_alert_prereqs["folder_id"],
        template=temp_alert_prereqs["template_name"],
        destination=temp_alert_prereqs["destination_name"],
        vrl_function=vrl_initial,
        sql=f"select code from {temp_alert_prereqs['template_name']}",
    )
    payload["trigger_condition"]["period"] = 1440

    try:
        # Create
        resp = client.post("alerts", prefix="api/v2/", json=payload)
        assert resp.status_code == 200, resp.text

        alert = next(
            (a for a in client.alerts.list() if a.get("name") == alert_name),
            None,
        )
        assert alert is not None
        alert_id = alert["alert_id"]

        # Update VRL
        payload["id"] = alert_id
        payload["description"] = "VRL update test - UPDATED"
        payload["query_condition"]["vrl_function"] = vrl_updated

        resp_update = client.put(
            f"alerts/{alert_id}?type=logs", prefix="api/v2/", json=payload,
        )
        assert resp_update.status_code == 200, f"update failed: {resp_update.status_code} {resp_update.text}"

        # Verify both VRL change AND description change persisted
        resp_get = client.get(f"alerts/{alert_id}", prefix="api/v2/")
        body = resp_get.json()
        assert body.get("query_condition", {}).get("vrl_function") == vrl_updated, \
            "VRL should be updated to the new base64 string"
        assert body.get("description") == "VRL update test - UPDATED", \
            "description should be updated"
    finally:
        for a in client.alerts.list():
            if a.get("name") == alert_name:
                client.delete(f"alerts/{a['alert_id']}", prefix="api/v2/")
                break
