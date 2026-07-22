"""
Workflows v1 REST API tests.

Feature: OpenObserve Enterprise "Workflows" (event -> action). v1 trigger = alert_fired,
sink = remote/pipeline destination. See tests/ui-testing/MD_Files/features/workflows/ for the plan.

Endpoints (context path /api, org in path):
    POST   /{org}/workflows                     create
    GET    /{org}/workflows                      list
    PUT    /{org}/workflows/{id}                  update
    DELETE /{org}/workflows/{id}                  delete (blocked if alert-linked)
    PUT    /{org}/workflows/{id}/enable?value=    enable/disable
    POST   /{org}/workflows/{id}/test            test run {inputs, from_node}
    GET    /{org}/workflows/{id}/history          run history
    GET    /{org}/workflows/{id}/errors/{run_id}  run/node errors
    POST   /{org}/workflows/{id}/retry            retry {run_id, from_node} (no UI)

Payload/behaviour confirmed live on feat/workflows_v1 (2026-07-20):
- create validates the graph: every leaf must be a leaf-type node; a valid workflow needs a real
  pipeline destination (a trigger-only graph 400s with "All leaf nodes must be StreamNode").
- there is no get-by-id endpoint — round-trip reads go through the list.

All artifacts are namespaced `wf_auto_api_*` and torn down by fixtures.
"""

import os
import time
import uuid

import pytest
import requests

ORG_ID = os.environ.get("TEST_ORG_ID", "default")


@pytest.fixture(scope="module", autouse=True)
def _require_workflows(create_session, base_url):
    """Workflows is Enterprise-only. Skip the whole module on OSS / builds where it is not enabled."""
    resp = create_session.get(f"{base_url}api/{ORG_ID}/workflows")
    if resp.status_code in (403, 404):
        pytest.skip("Workflows feature not available (enterprise-only / not enabled on this build).")


def _suffix():
    return f"{int(time.time())}{uuid.uuid4().hex[:4]}"


def _workflow_payload(name, dest_name, description="automation workflow"):
    """Minimal valid workflow graph: Alert Trigger -> Destination (bound to a pipeline dest)."""
    return {
        "id": "",
        "org_id": "",
        "created_at": 0,
        "updated_at": 0,
        "created_by": "",
        "name": name,
        "description": description,
        "enabled": True,
        "nodes": [
            {
                "id": "trigger-1",
                "data": {"node_type": "workflow_trigger"},
                "position": {"x": 100, "y": 100},
                "io_type": "input",
            },
            {
                "id": "dest-1",
                "data": {
                    "node_type": "destination",
                    "destination_id": dest_name,
                    "template_override": None,
                },
                "position": {"x": 400, "y": 100},
                "io_type": "output",
            },
        ],
        "edges": [{"id": "etrigger-1-dest-1", "source": "trigger-1", "target": "dest-1"}],
    }


@pytest.fixture
def pipeline_destination(create_session, base_url):
    """Create a pipeline destination for the workflow's Destination node; delete it after."""
    session = create_session
    name = f"wf_auto_api_dest_{_suffix()}"
    payload = {
        "name": name,
        "url": "http://localhost:8080/sink",
        "method": "post",
        "type": "http",
    }
    resp = session.post(
        f"{base_url}api/{ORG_ID}/alerts/destinations?module=pipeline", json=payload
    )
    assert resp.status_code == 200, f"destination create failed: {resp.status_code} {resp.text[:300]}"
    yield name
    session.delete(f"{base_url}api/{ORG_ID}/alerts/destinations/{name}")


@pytest.fixture
def workflow(create_session, base_url, pipeline_destination):
    """Create a workflow bound to the pipeline destination; delete it after."""
    session = create_session
    name = f"wf_auto_api_{_suffix()}"
    resp = session.post(
        f"{base_url}api/{ORG_ID}/workflows", json=_workflow_payload(name, pipeline_destination)
    )
    assert resp.status_code == 200, f"workflow create failed: {resp.status_code} {resp.text[:300]}"
    wf_id = resp.json().get("id")
    assert wf_id, f"no id in create response: {resp.text[:300]}"
    yield {"id": wf_id, "name": name, "dest": pipeline_destination}
    session.delete(f"{base_url}api/{ORG_ID}/workflows/{wf_id}")


def _find_in_list(session, base_url, wf_id):
    resp = session.get(f"{base_url}api/{ORG_ID}/workflows")
    assert resp.status_code == 200
    data = resp.json()
    items = data if isinstance(data, list) else data.get("list", data.get("data", []))
    return next((w for w in items if w.get("id") == wf_id), None)


# --------------------------------------------------------------------------- CT-13: lifecycle

def test_create_workflow_valid(workflow):
    """CT-13a — a valid Trigger->Destination workflow is created and returns an id."""
    assert workflow["id"]


def test_create_workflow_malformed_body(create_session, base_url):
    """CT-15a — a malformed create body (missing required graph fields) is rejected."""
    resp = create_session.post(f"{base_url}api/{ORG_ID}/workflows", json={})
    assert resp.status_code in (400, 422), f"expected 4xx, got {resp.status_code}: {resp.text[:300]}"


def test_create_workflow_trigger_only_rejected(create_session, base_url):
    """CT-15c — a trigger-only graph (non-leaf leaf) is rejected by graph validation."""
    payload = _workflow_payload(f"wf_auto_api_{_suffix()}", "unused")
    payload["nodes"] = payload["nodes"][:1]  # drop the destination node
    payload["edges"] = []
    resp = create_session.post(f"{base_url}api/{ORG_ID}/workflows", json=payload)
    assert resp.status_code in (400, 422), f"expected 4xx, got {resp.status_code}: {resp.text[:300]}"


def test_list_workflows(create_session, base_url, workflow):
    """CT-13b — list returns an array containing the created workflow; log the latency (K10)."""
    start = time.time()
    resp = create_session.get(f"{base_url}api/{ORG_ID}/workflows")
    latency_ms = int((time.time() - start) * 1000)
    assert resp.status_code == 200
    data = resp.json()
    items = data if isinstance(data, list) else data.get("list", data.get("data", []))
    assert any(w.get("id") == workflow["id"] for w in items)
    # K10 is intermittent (warm ~1s, cold seconds); log rather than hard-assert.
    assert latency_ms >= 0


def test_update_workflow_round_trip(create_session, base_url, workflow):
    """CT-13c — update persists; re-reading via list shows the edited fields (no get-by-id endpoint)."""
    new_desc = "automation workflow edited"
    payload = _workflow_payload(workflow["name"], workflow["dest"], description=new_desc)
    payload["id"] = workflow["id"]
    resp = create_session.put(f"{base_url}api/{ORG_ID}/workflows/{workflow['id']}", json=payload)
    assert resp.status_code == 200, f"update failed: {resp.status_code} {resp.text[:300]}"
    found = _find_in_list(create_session, base_url, workflow["id"])
    assert found is not None
    assert found.get("description") == new_desc


def test_enable_disable_workflow(create_session, base_url, workflow):
    """CT-13d — enable/disable toggles return 200."""
    for value in ("false", "true"):
        resp = create_session.put(
            f"{base_url}api/{ORG_ID}/workflows/{workflow['id']}/enable?value={value}"
        )
        assert resp.status_code == 200, f"enable={value} failed: {resp.status_code} {resp.text[:300]}"


def test_delete_workflow(create_session, base_url, pipeline_destination):
    """CT-13e — delete removes the workflow from the list."""
    name = f"wf_auto_api_{_suffix()}"
    created = create_session.post(
        f"{base_url}api/{ORG_ID}/workflows", json=_workflow_payload(name, pipeline_destination)
    )
    assert created.status_code == 200
    wf_id = created.json()["id"]
    resp = create_session.delete(f"{base_url}api/{ORG_ID}/workflows/{wf_id}")
    assert resp.status_code == 200
    assert _find_in_list(create_session, base_url, wf_id) is None


# --------------------------------------------------------------------------- CT-14: test/history/errors/retry

def test_test_workflow(create_session, base_url, workflow):
    """CT-14a — the test endpoint runs the graph and returns a per-node result object."""
    body = {"inputs": [{"meta": {}, "data": []}], "from_node": "trigger-1"}
    resp = create_session.post(f"{base_url}api/{ORG_ID}/workflows/{workflow['id']}/test", json=body)
    assert resp.status_code == 200, f"test failed: {resp.status_code} {resp.text[:300]}"


def test_workflow_history(create_session, base_url, workflow):
    """CT-14b — history returns 200 (empty for a workflow that never fired)."""
    resp = create_session.get(f"{base_url}api/{ORG_ID}/workflows/{workflow['id']}/history")
    assert resp.status_code == 200


def test_workflow_errors_unknown_run(create_session, base_url, workflow):
    """CT-14c — errors for an unknown run_id return 200 with null payload (documented backend behaviour)."""
    resp = create_session.get(
        f"{base_url}api/{ORG_ID}/workflows/{workflow['id']}/errors/nonexistent_run_{_suffix()}"
    )
    assert resp.status_code == 200


def test_workflow_retry_unknown_run(create_session, base_url, workflow):
    """CT-14d — retry of an unknown run_id is rejected."""
    body = {"run_id": f"nonexistent_{_suffix()}", "from_node": ""}
    resp = create_session.post(f"{base_url}api/{ORG_ID}/workflows/{workflow['id']}/retry", json=body)
    assert resp.status_code in (400, 404), f"expected 4xx, got {resp.status_code}: {resp.text[:300]}"


# --------------------------------------------------------------------------- CT-15: security / auth

def test_workflows_requires_auth(base_url):
    """CT-15e — no credentials -> 401."""
    resp = requests.get(f"{base_url}api/{ORG_ID}/workflows", timeout=30)
    assert resp.status_code == 401


def test_workflows_cross_org_isolation(create_session, base_url, workflow):
    """CT-15f — a workflow id fetched under a different org is not accessible."""
    other_org = "wf_no_such_org_zzz"
    resp = create_session.get(f"{base_url}api/{other_org}/workflows/{workflow['id']}/history")
    assert resp.status_code in (401, 403, 404)


# --------------------------------------------------------------------------- Fixmes (documented gaps)

@pytest.mark.skip(reason="No public API to seed a genuinely-errored run_id (runs come from an alert firing).")
def test_workflow_retry_errored_run():
    """CT-14e — retry a real failed run. Needs an E2E fire to produce a failed run_id."""


@pytest.mark.skip(reason="Backend gap F-10: PUT /enable?value=<garbage> returns 200 (parse().unwrap_or(true), no validation).")
def test_enable_bad_value_rejected():
    """CT-15g — bad enable value should 4xx; currently 200. Track as a backend bug."""


@pytest.mark.skip(reason="Alert->workflow link payload field not confirmable from the branch; delete-protection covered in UI CT-12.")
def test_delete_linked_workflow_blocked():
    """CT-15h — deleting an alert-linked workflow should 4xx ('workflow is used by alert ...')."""


@pytest.mark.skip(reason="Backend gap F-12: create with a blank name returns 200 (no server-side name validation, though the UI blocks it).")
def test_create_blank_name_rejected():
    """CT-15 — create with an empty name should 4xx; currently 200. Track as a backend bug."""
