"""Alert prerequisites for the bug-fix regression tests."""

from __future__ import annotations

import uuid
from collections.abc import Generator
from typing import Any

import pytest

from support.client import OpenObserveClient
from support.factories import unique_name

ORG_ID = "default"
# The server's own /healthz: a destination that reliably accepts, so a trigger
# exercises the alert path rather than failing on an unreachable sink.
SINK_URL = "http://localhost:5080/healthz"
# The only stream guaranteed to exist, created by conftest's autouse ingest_data.
SEED_STREAM = "stream_pytest_data"


def alert_payload(*, name: str, folder_id: str, template: str, destination: str) -> dict[str, Any]:
    """A minimal scheduled v2 alert on a custom condition."""
    return {
        "name": name,
        "row_template": template,
        "stream_type": "logs",
        "stream_name": SEED_STREAM,
        "is_real_time": False,
        "context_attributes": {},
        "query_condition": {
            "conditions": [{
                "column": "log",
                "operator": "=",
                "value": "200",
                "type": None,
                "id": str(uuid.uuid4()),
            }],
            "search_event_type": "ui",
            "sql": "",
            "promql": "",
            "type": "custom",
            "promql_condition": None,
            "vrl_function": None,
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
        "enabled": True,
        "description": "bug-fix regression alert",
        "folderId": folder_id,
    }


@pytest.fixture
def alert_prereqs(client: OpenObserveClient) -> Generator[dict[str, str], None, None]:
    """Folder + template + destination, torn down in reverse order."""
    folder_name = unique_name("bfx_folder")
    template_name = unique_name("bfx_tmpl")
    destination_name = unique_name("bfx_dest")

    resp = client.post("folders/alerts", prefix="api/v2/",
                       json={"description": "bugfix regression", "name": folder_name})
    assert resp.status_code == 200, f"folder create failed: {resp.status_code} {resp.text}"
    folder_id = resp.json()["folderId"]

    resp = client.post("alerts/templates", json={
        "name": template_name,
        "body": '{\n  "text": "alert {alert_name} is active"\n}',
        "type": "http",
        "title": "",
    })
    assert resp.status_code == 200, f"template create failed: {resp.status_code} {resp.text}"

    resp = client.post("alerts/destinations", json={
        "url": SINK_URL,
        "method": "get",
        "skip_tls_verify": False,
        "template": template_name,
        "headers": {},
        "name": destination_name,
    })
    assert resp.status_code == 200, f"destination create failed: {resp.status_code} {resp.text}"

    yield {
        "folder_id": folder_id,
        "template_name": template_name,
        "destination_name": destination_name,
    }

    for path in (f"alerts/destinations/{destination_name}", f"alerts/templates/{template_name}"):
        client.delete(path)
    client.delete(f"folders/alerts/{folder_id}", prefix="api/v2/")


@pytest.fixture
def temp_alert(client: OpenObserveClient, alert_prereqs: dict[str, str]) -> Generator[str, None, None]:
    """A saved alert, deleted afterwards. Yields its id."""
    name = unique_name("bfx_alert")
    resp = client.post(
        f"alerts?folder={alert_prereqs['folder_id']}",
        prefix="api/v2/",
        json=alert_payload(
            name=name,
            folder_id=alert_prereqs["folder_id"],
            template=alert_prereqs["template_name"],
            destination=alert_prereqs["destination_name"],
        ),
    )
    assert resp.status_code == 200, f"alert create failed: {resp.status_code} {resp.text}"
    alert_id = resp.json().get("id") or resp.json().get("alert_id")

    yield alert_id

    client.delete(f"alerts/{alert_id}", prefix="api/v2/")
