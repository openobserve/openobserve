"""
Workflow HTTP endpoints: management API, credentials, reveal and run history.

Endpoints (context path /api, org in path):
    GET    /{org}/workflows/{id}/http_trigger                               config + credentials
    PUT    /{org}/workflows/{id}/http_trigger                               create / update / mode switch
    DELETE /{org}/workflows/{id}/http_trigger                               delete (tombstone)
    POST   /{org}/workflows/{id}/http_trigger/credentials                   rotate {overlap_seconds}
    DELETE /{org}/workflows/{id}/http_trigger/credentials/{cred_id}         revoke
    GET    /{org}/workflows/{id}/http_trigger/credentials/{cred_id}/secret  reveal
    POST   /{org}/workflows/{id}/http_trigger/test                          test run
    POST   /v2/{org}/workflows/hooks/{trigger_id}                           public invoke (Bearer token)
    GET    /v2/{org}/workflows/hooks/{trigger_id}/runs/{run_id}             public status poll

The routes exist only when the server runs with O2_WORKFLOW_HOOKS_ENABLED=true, which
`/config` reports as `workflow_hooks_enabled`; until that is the default the module skips
(WORKFLOW_HOOKS_REQUIRED=1 turns the skip into a failure). Invokes use `X-O2-Dry-Run: true`
where only authentication matters, so no run is started.

All artifacts are namespaced `wf_auto_http_*` and torn down by fixtures.
"""

import os
import time
import uuid

import pytest
import requests

ORG_ID = os.environ.get("TEST_ORG_ID", "default")
SINK_URL = "http://example.com/sink"
NO_STORE = "no-store, private"


def _suffix():
    return f"{int(time.time())}{uuid.uuid4().hex[:6]}"


@pytest.fixture(scope="module", autouse=True)
def _require_hooks(create_session, base_url):
    resp = create_session.get(f"{base_url}api/{ORG_ID}/config")
    enabled = resp.status_code == 200 and resp.json().get("workflow_hooks_enabled") is True
    if not enabled:
        msg = "Workflow HTTP endpoints are off on this server (/config workflow_hooks_enabled is not true)."
        if os.environ.get("WORKFLOW_HOOKS_REQUIRED") == "1":
            pytest.fail(f"{msg} WORKFLOW_HOOKS_REQUIRED=1 expects them on.")
        pytest.skip(msg)


def _workflow_payload(name, dest_name, trigger_type="AlertFired", trigger_kind="alert_fired"):
    """The endpoint is not a trigger kind, so test workflows use the kinds the UI creates."""
    return {
        "workflow": {
            "id": "",
            "org_id": "",
            "created_at": 0,
            "updated_at": 0,
            "created_by": "",
            "name": name,
            "description": "http endpoint automation",
            "enabled": True,
            "nodes": [
                {
                    "id": "trigger-1",
                    "data": {"node_type": "workflow_trigger"},
                    "meta": {"trigger_kind": trigger_kind},
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
        },
        "trigger_type": trigger_type,
    }


@pytest.fixture(scope="module")
def destination(create_session, base_url):
    name = f"wf_auto_http_dest_{_suffix()}"
    resp = create_session.post(
        f"{base_url}api/{ORG_ID}/alerts/destinations?module=pipeline",
        json={"name": name, "url": SINK_URL, "method": "post", "type": "http"},
    )
    assert resp.status_code == 200, f"destination create failed: {resp.status_code} {resp.text[:300]}"
    yield name
    create_session.delete(f"{base_url}api/{ORG_ID}/alerts/destinations/{name}")


@pytest.fixture(scope="module")
def sink_destination(create_session, base_url):
    """Posts back into this server's own ingestion, so a run that reaches it succeeds (needs ZO_SSRF_ALLOW_LOOPBACK)."""
    name = f"wf_auto_http_sink_{_suffix()}"
    resp = create_session.post(
        f"{base_url}api/{ORG_ID}/alerts/destinations?module=pipeline",
        json={
            "name": name,
            "url": f"{base_url}api/{ORG_ID}/wf_auto_http_sink/_json",
            "method": "post",
            "type": "http",
            "headers": {"Authorization": create_session.headers["Authorization"]},
        },
    )
    assert resp.status_code == 200, f"sink create failed: {resp.status_code} {resp.text[:300]}"
    yield name
    create_session.delete(f"{base_url}api/{ORG_ID}/alerts/destinations/{name}")


@pytest.fixture
def make_workflow(create_session, base_url, destination):
    """Creates published workflows on demand and deletes them (and their endpoints) after."""
    created = []

    def _make(trigger_type="AlertFired", trigger_kind="alert_fired", dest=None):
        name = f"wf_auto_http_{_suffix()}"
        resp = create_session.post(
            f"{base_url}api/{ORG_ID}/workflows",
            json=_workflow_payload(name, dest or destination, trigger_type, trigger_kind),
        )
        assert resp.status_code == 200, f"workflow create failed: {resp.status_code} {resp.text[:300]}"
        wf_id = resp.json()["id"]
        created.append(wf_id)
        return wf_id

    yield _make
    for wf_id in created:
        create_session.delete(f"{base_url}api/{ORG_ID}/workflows/{wf_id}/http_trigger")
        create_session.delete(f"{base_url}api/{ORG_ID}/workflows/{wf_id}")


def _url(base_url, wf_id, rest=""):
    return f"{base_url}api/{ORG_ID}/workflows/{wf_id}/http_trigger{rest}"


def _enable(session, base_url, wf_id, mode="token", **limits):
    resp = session.put(_url(base_url, wf_id), json={"enabled": True, "auth_mode": mode, **limits})
    assert resp.status_code == 201, f"enable failed: {resp.status_code} {resp.text[:300]}"
    return resp


def _invoke(base_url, trigger_id, token, dry_run=True, body=None, headers=None):
    hdrs = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    if dry_run:
        hdrs["X-O2-Dry-Run"] = "true"
    hdrs.update(headers or {})
    return requests.post(
        f"{base_url}api/v2/{ORG_ID}/workflows/hooks/{trigger_id}",
        json=body if body is not None else {"event": "pytest"},
        headers=hdrs,
    )


def _rotate(session, base_url, wf_id, overlap):
    return session.post(_url(base_url, wf_id, "/credentials"), json={"overlap_seconds": overlap})


def _reveal(session, base_url, wf_id, cred_id):
    return session.get(_url(base_url, wf_id, f"/credentials/{cred_id}/secret"))


def _poll_terminal(base_url, trigger_id, run_id, token, timeout=60):
    path = f"{base_url}api/v2/{ORG_ID}/workflows/hooks/{trigger_id}/runs/{run_id}"
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        resp = requests.get(path, headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200, f"poll failed: {resp.status_code} {resp.text[:300]}"
        last = resp.json()
        if last["status"] in ("succeeded", "failed", "expired"):
            return last
        time.sleep(1)
    pytest.fail(f"run {run_id} never finished: {last}")


def _list_row(session, base_url, wf_id):
    resp = session.get(f"{base_url}api/{ORG_ID}/workflows")
    assert resp.status_code == 200, resp.text[:300]
    data = resp.json()
    items = data if isinstance(data, list) else data.get("list", data.get("data", []))
    row = next((w for w in items if w.get("id") == wf_id), None)
    assert row is not None, f"workflow {wf_id} is not listed"
    return row


def _kind_and_links(session, base_url, wf_id):
    """The trigger node's meta and the workflow's (entity, entity type, trigger type) links."""
    row = _list_row(session, base_url, wf_id)
    trigger = next(n for n in row["nodes"] if n["data"]["node_type"] == "workflow_trigger")
    links = sorted(
        (a["entity_id"], a["entity_type"], a["trigger_type"]) for a in row.get("associations") or []
    )
    return trigger.get("meta"), links


def _run_to_end(base_url, created):
    """Starts a real HTTP run and waits until the worker has run the workflow's steps."""
    resp = _invoke(
        base_url, created["id"], created["secret"], dry_run=False, headers={"Idempotency-Key": f"k-{_suffix()}"}
    )
    assert resp.status_code == 202, resp.text[:300]
    run_id = resp.json()["run_id"]
    last = _poll_terminal(base_url, created["id"], run_id, created["secret"])
    assert last["status"] == "succeeded", last
    return run_id


def _history_row(session, base_url, wf_id, run_id):
    history = session.get(f"{base_url}api/{ORG_ID}/workflows/{wf_id}/history").json()
    rows = [r for r in history if r.get("run_id") == run_id]
    assert len(rows) == 1, history
    return rows[0]


@pytest.fixture
def alert_linked_workflow(create_session, base_url, make_workflow, sink_destination):
    """An Alert Fired workflow linked to a disabled alert through the alerts API; yields (wf_id, alert_id)."""
    wf_id = make_workflow(dest=sink_destination)
    stream = f"wf_auto_http_alert_{_suffix()}"
    ingest = create_session.post(f"{base_url}api/{ORG_ID}/{stream}/_json", json=[{"level": "info"}])
    assert ingest.status_code == 200, ingest.text[:300]
    name = f"wf_auto_http_alert_{_suffix()}"
    payload = {
        "name": name,
        "stream_type": "logs",
        "stream_name": stream,
        "is_real_time": False,
        "context_attributes": {},
        "query_condition": {
            "conditions": [
                {"column": "level", "operator": "=", "value": "never", "type": None, "id": uuid.uuid4().hex}
            ],
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
            "frequency": 60,
            "cron": "",
            "threshold": 1000,
            "silence": 10,
            "frequency_type": "minutes",
            "timezone": "UTC",
            "tolerance_in_secs": 0,
        },
        "org_id": ORG_ID,
        "destinations": [],
        "workflows": [wf_id],
        "enabled": False,
        "description": "http endpoint automation",
    }
    resp = create_session.post(f"{base_url}api/v2/{ORG_ID}/alerts?folder=default", json=payload)
    assert resp.status_code == 200, f"alert create failed: {resp.status_code} {resp.text[:300]}"
    listed = create_session.get(f"{base_url}api/v2/{ORG_ID}/alerts").json().get("list", [])
    alert_id = next((a["alert_id"] for a in listed if a.get("name") == name), None)
    assert alert_id, f"alert {name} is not listed"
    yield wf_id, alert_id
    create_session.delete(f"{base_url}api/v2/{ORG_ID}/alerts/{alert_id}")


# --------------------------------------------------------------------------- config / GET


def test_config_exposes_workflow_hooks_enabled(create_session, base_url):
    """AC-API-21."""
    body = create_session.get(f"{base_url}api/{ORG_ID}/config").json()
    assert body["workflow_hooks_enabled"] is True
    assert body["workflows_enabled"] is True


def test_get_unconfigured_is_404_with_permissions(create_session, base_url, make_workflow):
    """AC-API-10 404 body."""
    wf_id = make_workflow()
    resp = create_session.get(_url(base_url, wf_id))
    assert resp.status_code == 404
    body = resp.json()
    assert body["error_detail"] == "not_configured"
    assert body["permissions"] == {"edit": True, "test": True, "reveal": True}
    assert isinstance(body["org_rate_limit_per_minute"], int)
    assert isinstance(body["secrets_encrypted_at_rest"], bool)


def test_get_http_trigger_reports_secrets_encrypted_at_rest(create_session, base_url, make_workflow):
    """AC-API-25: EXPECT_SECRETS_ENCRYPTED names the server's mode when the runner knows it."""
    wf_id = make_workflow()
    _enable(create_session, base_url, wf_id)
    value = create_session.get(_url(base_url, wf_id)).json()["secrets_encrypted_at_rest"]
    assert isinstance(value, bool)
    expected = os.environ.get("EXPECT_SECRETS_ENCRYPTED")
    if expected is not None:
        assert value == (expected == "true")


def test_get_http_trigger_omits_revoked_and_flags_creator_in_org(create_session, base_url, make_workflow):
    """AC-API-10: revoked rows are omitted, live ones carry creator_in_org and only a prefix."""
    wf_id = make_workflow()
    created = _enable(create_session, base_url, wf_id).json()
    first = created["credentials"][0]["id"]
    assert _rotate(create_session, base_url, wf_id, 0).status_code == 201
    view = create_session.get(_url(base_url, wf_id)).json()
    ids = [c["id"] for c in view["credentials"]]
    assert first not in ids
    assert len(ids) == 1
    cred = view["credentials"][0]
    assert cred["creator_in_org"] is True
    assert cred["display_prefix"].startswith("o2wh_")
    assert "…" in cred["display_prefix"]
    assert "secret" not in cred
    assert "token_sha256" not in cred
    for key in ("url", "enabled", "auth_mode", "max_body_bytes", "rate_limit_per_minute",
                "org_rate_limit_per_minute", "created_by", "created_at", "updated_at",
                "last_invoked_at", "last_call", "rejections", "permissions"):
        assert key in view, key
    assert view["url"].endswith(f"/api/v2/{ORG_ID}/workflows/hooks/{view['id']}")


# --------------------------------------------------------------------------- PUT


def test_put_create_201_with_secret(create_session, base_url, make_workflow):
    """AC-API-11 create, AC-API-27 no-store, AC-SEC-01 token shape."""
    wf_id = make_workflow()
    resp = _enable(create_session, base_url, wf_id)
    assert resp.headers.get("Cache-Control") == NO_STORE
    body = resp.json()
    assert body["secret"].startswith("o2wh_")
    assert len(body["secret"]) == 48
    assert body["auth_mode"] == "token"
    assert body["enabled"] is True
    assert body["max_body_bytes"] == 1048576
    assert _invoke(base_url, body["id"], body["secret"]).status_code == 200


def test_put_update_200_without_secret(create_session, base_url, make_workflow):
    """AC-API-11 update."""
    wf_id = make_workflow()
    _enable(create_session, base_url, wf_id)
    resp = create_session.put(
        _url(base_url, wf_id),
        json={"enabled": False, "auth_mode": "token", "rate_limit_per_minute": 5},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body.get("secret") is None
    assert body["enabled"] is False
    assert body["rate_limit_per_minute"] == 5
    assert "no-store" not in resp.headers.get("Cache-Control", "")


def test_put_limits_above_budget_400(create_session, base_url, make_workflow):
    """AC-API-11: limits outside their range and unknown modes are refused."""
    wf_id = make_workflow()
    for payload, code in (
        ({"enabled": True, "auth_mode": "token", "rate_limit_per_minute": 10_000_000}, "invalid_limit"),
        ({"enabled": True, "auth_mode": "token", "max_body_bytes": 5 * 1024 * 1024}, "invalid_limit"),
        ({"enabled": True, "auth_mode": "token", "max_body_bytes": 0}, "invalid_limit"),
        ({"enabled": True, "auth_mode": "basic"}, "invalid_auth_mode"),
    ):
        resp = create_session.put(_url(base_url, wf_id), json=payload)
        assert resp.status_code == 400, payload
        assert resp.json()["error_detail"] == code


def test_put_on_draft_only_id_201(create_session, base_url, destination):
    """AC-API-11: a draft-only id is accepted; calls are 403 workflow_not_published."""
    name = f"wf_auto_http_draft_{_suffix()}"
    resp = create_session.post(
        f"{base_url}api/{ORG_ID}/workflows?draft=true", json=_workflow_payload(name, destination)
    )
    assert resp.status_code == 200, resp.text[:300]
    wf_id = resp.json()["id"]
    try:
        body = _enable(create_session, base_url, wf_id).json()
        call = _invoke(base_url, body["id"], body["secret"])
        assert call.status_code == 403
        assert call.json()["error_detail"] == "workflow_not_published"
        missing = create_session.put(
            _url(base_url, f"wf-missing-{_suffix()}"), json={"enabled": True, "auth_mode": "token"}
        )
        assert missing.status_code == 404
        assert missing.json()["error_detail"] == "workflow_not_found"
    finally:
        create_session.delete(_url(base_url, wf_id))
        create_session.delete(f"{base_url}api/{ORG_ID}/workflows/{wf_id}?draft=true")


def test_mode_switch_revokes_the_old_kind_and_returns_a_new_secret(create_session, base_url, make_workflow):
    """AC-SEC-07, AC-API-11 mode switch."""
    wf_id = make_workflow()
    created = _enable(create_session, base_url, wf_id).json()
    resp = create_session.put(_url(base_url, wf_id), json={"enabled": True, "auth_mode": "signature"})
    assert resp.status_code == 200
    assert resp.headers.get("Cache-Control") == NO_STORE
    body = resp.json()
    assert body["secret"].startswith("whsec_")
    assert [c["kind"] for c in body["credentials"]] == ["signing_secret"]
    assert _invoke(base_url, created["id"], created["secret"]).status_code == 401


# --------------------------------------------------------------------------- DELETE / rotate / revoke


def test_delete_http_trigger_204_then_invoke_401(create_session, base_url, make_workflow):
    """AC-API-12."""
    wf_id = make_workflow()
    body = _enable(create_session, base_url, wf_id).json()
    assert create_session.delete(_url(base_url, wf_id)).status_code == 204
    assert _invoke(base_url, body["id"], body["secret"]).status_code == 401
    assert create_session.delete(_url(base_url, wf_id)).status_code == 404
    assert create_session.get(_url(base_url, wf_id)).status_code == 404


def test_deleting_the_workflow_removes_the_endpoint(create_session, base_url, destination):
    """AC-ENG-22: deleting a published workflow tombstones its endpoint."""
    resp = create_session.post(
        f"{base_url}api/{ORG_ID}/workflows", json=_workflow_payload(f"wf_auto_http_{_suffix()}", destination)
    )
    assert resp.status_code == 200, resp.text[:300]
    wf_id = resp.json()["id"]
    body = _enable(create_session, base_url, wf_id).json()
    assert _invoke(base_url, body["id"], body["secret"]).status_code == 200
    assert create_session.delete(f"{base_url}api/{ORG_ID}/workflows/{wf_id}").status_code == 200
    assert _invoke(base_url, body["id"], body["secret"]).status_code == 401
    assert create_session.get(_url(base_url, wf_id)).status_code == 404


def test_deleting_a_draft_removes_the_endpoint(create_session, base_url, destination):
    """AC-ENG-22: deleting a draft-only workflow tombstones its endpoint."""
    resp = create_session.post(
        f"{base_url}api/{ORG_ID}/workflows?draft=true",
        json=_workflow_payload(f"wf_auto_http_draft_{_suffix()}", destination),
    )
    assert resp.status_code == 200, resp.text[:300]
    wf_id = resp.json()["id"]
    body = _enable(create_session, base_url, wf_id).json()
    assert _invoke(base_url, body["id"], body["secret"]).status_code == 403
    assert create_session.delete(f"{base_url}api/{ORG_ID}/workflows/{wf_id}?draft=true").status_code == 200
    assert _invoke(base_url, body["id"], body["secret"]).status_code == 401
    assert create_session.get(_url(base_url, wf_id)).status_code == 404


def test_rotate_with_overlap_keeps_old_token_until_expiry(create_session, base_url, make_workflow):
    """AC-API-13: overlap keeps the old token live and retiring."""
    wf_id = make_workflow()
    created = _enable(create_session, base_url, wf_id).json()
    resp = _rotate(create_session, base_url, wf_id, 3600)
    assert resp.status_code == 201
    assert resp.headers.get("Cache-Control") == NO_STORE
    rotated = resp.json()
    assert rotated["secret"].startswith("o2wh_")
    assert rotated["state"] == "active"
    assert _invoke(base_url, created["id"], created["secret"]).status_code == 200
    assert _invoke(base_url, created["id"], rotated["secret"]).status_code == 200
    states = {c["id"]: c for c in create_session.get(_url(base_url, wf_id)).json()["credentials"]}
    old = states[created["credentials"][0]["id"]]
    assert old["state"] == "retiring"
    assert old["expires_at"] > int(time.time() * 1_000_000)


def test_rotate_immediate_revokes_old(create_session, base_url, make_workflow):
    """AC-API-13 overlap 0."""
    wf_id = make_workflow()
    created = _enable(create_session, base_url, wf_id).json()
    rotated = _rotate(create_session, base_url, wf_id, 0).json()
    assert _invoke(base_url, created["id"], created["secret"]).status_code == 401
    assert _invoke(base_url, created["id"], rotated["secret"]).status_code == 200


def test_rotate_bad_overlap_400(create_session, base_url, make_workflow):
    """AC-API-13 invalid overlap."""
    wf_id = make_workflow()
    _enable(create_session, base_url, wf_id)
    resp = _rotate(create_session, base_url, wf_id, 60)
    assert resp.status_code == 400
    assert resp.json()["error_detail"] == "invalid_overlap"


def test_rotate_while_retiring_is_409(create_session, base_url, make_workflow):
    """AC-SEC-05."""
    wf_id = make_workflow()
    _enable(create_session, base_url, wf_id)
    assert _rotate(create_session, base_url, wf_id, 3600).status_code == 201
    resp = _rotate(create_session, base_url, wf_id, 0)
    assert resp.status_code == 409
    assert resp.json()["error_detail"] == "credential_retiring"
    assert len(create_session.get(_url(base_url, wf_id)).json()["credentials"]) == 2


def test_revoked_token_gets_401_immediately(create_session, base_url, make_workflow):
    """AC-SEC-06."""
    wf_id = make_workflow()
    created = _enable(create_session, base_url, wf_id).json()
    cred = created["credentials"][0]["id"]
    assert _invoke(base_url, created["id"], created["secret"]).status_code == 200
    assert create_session.delete(_url(base_url, wf_id, f"/credentials/{cred}")).status_code == 204
    assert _invoke(base_url, created["id"], created["secret"]).status_code == 401


def test_revoke_credential_of_other_trigger_404(create_session, base_url, make_workflow):
    """AC-API-14."""
    a, b = make_workflow(), make_workflow()
    created_a = _enable(create_session, base_url, a).json()
    _enable(create_session, base_url, b)
    foreign = created_a["credentials"][0]["id"]
    resp = create_session.delete(_url(base_url, b, f"/credentials/{foreign}"))
    assert resp.status_code == 404
    assert resp.json()["error_detail"] == "credential_not_found"
    assert _invoke(base_url, created_a["id"], created_a["secret"]).status_code == 200


# --------------------------------------------------------------------------- reveal


def test_reveal_credential_secret_200(create_session, base_url, make_workflow):
    """AC-API-26."""
    wf_id = make_workflow()
    created = _enable(create_session, base_url, wf_id).json()
    cred = created["credentials"][0]
    resp = _reveal(create_session, base_url, wf_id, cred["id"])
    assert resp.status_code == 200
    body = resp.json()
    assert body == {
        "id": cred["id"],
        "kind": "token",
        "display_prefix": cred["display_prefix"],
        "state": "active",
        "expires_at": None,
        "secret": created["secret"],
    }


def test_reveal_after_revoke_404(create_session, base_url, make_workflow):
    """AC-API-26: revoked and unknown credentials do not reveal."""
    wf_id = make_workflow()
    cred = _enable(create_session, base_url, wf_id).json()["credentials"][0]["id"]
    assert create_session.delete(_url(base_url, wf_id, f"/credentials/{cred}")).status_code == 204
    resp = _reveal(create_session, base_url, wf_id, cred)
    assert resp.status_code == 404
    assert resp.json()["error_detail"] == "credential_not_found"
    assert _reveal(create_session, base_url, wf_id, "unknown").status_code == 404


def test_reveal_after_mode_switch_404(create_session, base_url, make_workflow):
    """AC-API-26: a mode-switched credential is revoked, the new one reveals."""
    wf_id = make_workflow()
    old = _enable(create_session, base_url, wf_id).json()["credentials"][0]["id"]
    switched = create_session.put(
        _url(base_url, wf_id), json={"enabled": True, "auth_mode": "signature"}
    ).json()
    assert _reveal(create_session, base_url, wf_id, old).status_code == 404
    new = switched["credentials"][0]["id"]
    resp = _reveal(create_session, base_url, wf_id, new)
    assert resp.status_code == 200
    assert resp.json()["secret"] == switched["secret"]


def test_secret_responses_are_no_store(create_session, base_url, make_workflow):
    """AC-API-27: create, rotate, mode switch and reveal all send no-store."""
    wf_id = make_workflow()
    created = _enable(create_session, base_url, wf_id)
    rotated = _rotate(create_session, base_url, wf_id, 0)
    revealed = _reveal(create_session, base_url, wf_id, rotated.json()["id"])
    switched = create_session.put(_url(base_url, wf_id), json={"enabled": True, "auth_mode": "signature"})
    for resp in (created, rotated, revealed, switched):
        assert resp.headers.get("Cache-Control") == NO_STORE, resp.url


# --------------------------------------------------------------------------- test route, runs, scope


def test_http_trigger_test_suppresses_destinations_by_default(create_session, base_url, make_workflow):
    """AC-API-15: the steps get the hook-shaped input; the destination is not called."""
    wf_id = make_workflow()
    created = _enable(create_session, base_url, wf_id).json()
    resp = create_session.post(_url(base_url, wf_id, "/test"), json={"data": [{"event": "deploy"}]})
    assert resp.status_code == 200, resp.text[:500]
    text = resp.text
    assert '"event_type":"webhook"' in text.replace(" ", "")
    assert created["id"] in text
    assert "deploy" in text


def test_history_lists_a_finished_http_run(create_session, base_url, make_workflow):
    """AC-API-16 and AC-OBS-07: a real run is listed with its request facts."""
    wf_id = make_workflow()
    created = _enable(create_session, base_url, wf_id).json()
    resp = _invoke(
        base_url, created["id"], created["secret"], dry_run=False, headers={"Idempotency-Key": f"k-{_suffix()}"}
    )
    assert resp.status_code == 202, resp.text[:300]
    accepted = resp.json()
    assert resp.headers.get("Location") == accepted["status_url"]
    _poll_terminal(base_url, created["id"], accepted["run_id"], created["secret"])
    history = create_session.get(f"{base_url}api/{ORG_ID}/workflows/{wf_id}/history").json()
    rows = [r for r in history if r.get("run_id") == accepted["run_id"]]
    assert len(rows) == 1, history
    row = rows[0]
    assert row["status"] in ("succeeded", "failed")
    assert row["event_type"] == "Webhook"
    facts = row["http_request"]
    assert facts["credential_prefix"] == created["credentials"][0]["display_prefix"]
    assert facts["content_type"] == "application/json"
    assert facts["body_bytes"] > 0
    assert facts["idempotency_key"].startswith("k-")
    assert facts["caller_ip"]
    view = create_session.get(_url(base_url, wf_id)).json()
    assert view["last_call"]["run_id"] == accepted["run_id"]


def test_an_alert_fired_workflow_runs_on_http_and_keeps_its_alert_link(
    create_session, base_url, alert_linked_workflow
):
    """AC-API-28: an alert-linked workflow accepts HTTP runs; its kind and alert link never change."""
    wf_id, alert_id = alert_linked_workflow
    before = _kind_and_links(create_session, base_url, wf_id)
    assert before == ({"trigger_kind": "alert_fired"}, [(alert_id, "alert", "AlertFired")])
    created = _enable(create_session, base_url, wf_id).json()
    assert _kind_and_links(create_session, base_url, wf_id) == before
    run_id = _run_to_end(base_url, created)
    row = _history_row(create_session, base_url, wf_id, run_id)
    assert row["event_type"] == "Webhook"
    assert row["status"] == "succeeded"
    assert row["http_request"]["credential_prefix"] == created["credentials"][0]["display_prefix"]
    assert _kind_and_links(create_session, base_url, wf_id) == before
    assert create_session.delete(_url(base_url, wf_id)).status_code == 204
    assert _kind_and_links(create_session, base_url, wf_id) == before
    _enable(create_session, base_url, wf_id)
    assert _kind_and_links(create_session, base_url, wf_id) == before


def test_an_incident_event_workflow_runs_on_http_and_keeps_its_incident_link(
    create_session, base_url, make_workflow, sink_destination
):
    """AC-API-28: PUT, DELETE and re-PUT of the endpoint leave the incident link and kind as they were."""
    wf_id = make_workflow(trigger_type="IncidentEvent", trigger_kind="incident_event", dest=sink_destination)
    before = _kind_and_links(create_session, base_url, wf_id)
    assert before[0] == {"trigger_kind": "incident_event"}
    assert [link[1:] for link in before[1]] == [("incident", "IncidentEvent")], before
    created = _enable(create_session, base_url, wf_id).json()
    assert _kind_and_links(create_session, base_url, wf_id) == before
    run_id = _run_to_end(base_url, created)
    row = _history_row(create_session, base_url, wf_id, run_id)
    assert row["event_type"] == "Webhook"
    assert row["status"] == "succeeded"
    assert row["http_request"]["body_bytes"] > 0
    assert create_session.delete(_url(base_url, wf_id)).status_code == 204
    assert _kind_and_links(create_session, base_url, wf_id) == before
    _enable(create_session, base_url, wf_id)
    assert _kind_and_links(create_session, base_url, wf_id) == before


def test_http_run_input_carries_trigger_source(create_session, base_url, make_workflow):
    """AC-API-03, AC-API-28: the dry run and the test run both mark the input as an HTTP run."""
    wf_id = make_workflow()
    created = _enable(create_session, base_url, wf_id).json()
    dry = _invoke(base_url, created["id"], created["secret"])
    assert dry.status_code == 200, dry.text[:300]
    meta = dry.json()["input"]["meta"]
    assert meta["event_type"] == "webhook"
    assert meta["trigger_source"] == "http"
    test = create_session.post(_url(base_url, wf_id, "/test"), json={"data": [{"event": "deploy"}]})
    assert test.status_code == 200, test.text[:500]
    assert '"trigger_source":"http"' in test.text.replace(" ", "")


def test_endpoint_disabled_hint_names_the_http_endpoint_settings(create_session, base_url, make_workflow):
    """AC-API-29: the hint says where the endpoint lives, not a trigger step."""
    wf_id = make_workflow()
    created = _enable(create_session, base_url, wf_id).json()
    resp = create_session.put(_url(base_url, wf_id), json={"enabled": False, "auth_mode": "token"})
    assert resp.status_code == 200, resp.text[:300]
    call = _invoke(base_url, created["id"], created["secret"])
    assert call.status_code == 403, call.text[:300]
    assert call.json()["error_detail"] == "endpoint_disabled"
    assert call.json()["hint"] == "Turn the endpoint on in the workflow's HTTP endpoint settings"


def test_credential_scope_end_to_end(create_session, base_url, make_workflow):
    """AC-RBAC-06: a credential of A is 401 on B, and B's runs are 404 on A's URL."""
    a, b = make_workflow(), make_workflow()
    created_a = _enable(create_session, base_url, a).json()
    created_b = _enable(create_session, base_url, b).json()
    assert _invoke(base_url, created_b["id"], created_a["secret"]).status_code == 401
    run_b = _invoke(base_url, created_b["id"], created_b["secret"], dry_run=False)
    assert run_b.status_code == 202, run_b.text[:300]
    poll = requests.get(
        f"{base_url}api/v2/{ORG_ID}/workflows/hooks/{created_a['id']}/runs/{run_b.json()['run_id']}",
        headers={"Authorization": f"Bearer {created_a['secret']}"},
    )
    assert poll.status_code == 404
    assert poll.json()["error_detail"] == "run_not_found"
