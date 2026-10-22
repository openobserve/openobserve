"""
Workflow HTTP endpoints: who may read, change, test and reveal (AC-RBAC-05).

With OpenFGA on, the route table decides: GET on `workflows:{id}` reads the endpoint, PUT
changes it (and, with `require_credential_access`, reveals or mints a credential), POST runs
the test. A viewer therefore reads but changes nothing; an editor does everything.

With OpenFGA off every member passes the route table, so edit and test are open to all, but
only Admin/Root may obtain a credential value: the reveal, the secret-returning PUT (create,
mode switch) and rotate answer 403 to anyone else. The server refuses viewer and editor users
while OpenFGA is off, so the non-admin member there is a service account.

Each group runs only on the server config it describes (`/api/{org}/config` `rbac_enabled`)
and skips with the reason otherwise; the whole module skips while `workflow_hooks_enabled`
is false. Artifacts are namespaced `wf_auto_httprbac_*` and torn down by fixtures.
"""

import base64
import os
import time
import uuid

import pytest
import requests

ORG_ID = os.environ.get("TEST_ORG_ID", "default")
USER_PASSWORD = "Complexpass#123"
SINK_URL = "http://example.com/sink"


def _suffix():
    return f"{int(time.time())}{uuid.uuid4().hex[:6]}"


def _config(session, base_url):
    resp = session.get(f"{base_url}api/{ORG_ID}/config")
    return resp.json() if resp.status_code == 200 else {}


@pytest.fixture(scope="module", autouse=True)
def _require_hooks(create_session, base_url):
    if _config(create_session, base_url).get("workflow_hooks_enabled") is not True:
        msg = "Workflow HTTP endpoints are off on this server (workflow_hooks_enabled is not true)."
        if os.environ.get("WORKFLOW_HOOKS_REQUIRED") == "1":
            pytest.fail(msg)
        pytest.skip(msg)


@pytest.fixture(scope="module")
def rbac_enabled(create_session, base_url):
    return _config(create_session, base_url).get("rbac_enabled") is True


def _session_for(email, password=USER_PASSWORD):
    s = requests.Session()
    token = base64.b64encode(f"{email}:{password}".encode()).decode()
    s.headers.update({"Authorization": f"Basic {token}"})
    return s


def _workflow_payload(name, dest_name):
    return {
        "workflow": {
            "id": "",
            "org_id": "",
            "created_at": 0,
            "updated_at": 0,
            "created_by": "",
            "name": name,
            "description": "http endpoint rbac automation",
            "enabled": True,
            "nodes": [
                {
                    "id": "trigger-1",
                    "data": {"node_type": "workflow_trigger"},
                    "meta": {"trigger_kind": "alert_fired"},
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
        "trigger_type": "AlertFired",
    }


@pytest.fixture(scope="module")
def env(create_session, base_url, rbac_enabled):
    """A workflow with a token endpoint, one user per role the server accepts, and a member."""
    root = create_session
    tag = _suffix()
    dest = f"wf_auto_httprbac_dest_{tag}"
    resp = root.post(
        f"{base_url}api/{ORG_ID}/alerts/destinations?module=pipeline",
        json={"name": dest, "url": SINK_URL, "method": "post", "type": "http"},
    )
    assert resp.status_code == 200, resp.text[:300]
    resp = root.post(
        f"{base_url}api/{ORG_ID}/workflows", json=_workflow_payload(f"wf_auto_httprbac_{tag}", dest)
    )
    assert resp.status_code == 200, resp.text[:300]
    wf_id = resp.json()["id"]
    users = {}
    roles = ("viewer", "editor", "admin") if rbac_enabled else ("admin",)
    for role in roles:
        email = f"wf_auto_httprbac_{role}_{tag}@automation.local"
        resp = root.post(
            f"{base_url}api/{ORG_ID}/users",
            json={
                "email": email,
                "password": USER_PASSWORD,
                "first_name": "Http",
                "last_name": role.title(),
                "role": role,
            },
        )
        assert resp.status_code in (200, 201), f"user create failed: {resp.status_code} {resp.text[:300]}"
        users[role] = _session_for(email)
        users[f"{role}_email"] = email
    member_email = None
    if not rbac_enabled:
        member_email = f"wf_auto_httprbac_member_{tag}@automation.local"
        resp = root.post(
            f"{base_url}api/{ORG_ID}/service_accounts",
            json={"email": member_email, "first_name": "Http", "last_name": "Member"},
        )
        assert resp.status_code == 200, f"service account create failed: {resp.status_code} {resp.text[:300]}"
        users["member"] = _session_for(member_email, resp.json()["token"])
    created = root.put(
        f"{base_url}api/{ORG_ID}/workflows/{wf_id}/http_trigger",
        json={"enabled": True, "auth_mode": "token"},
    )
    assert created.status_code == 201, created.text[:300]
    yield {"wf_id": wf_id, "users": users, "created": created.json()}
    root.delete(f"{base_url}api/{ORG_ID}/workflows/{wf_id}/http_trigger")
    root.delete(f"{base_url}api/{ORG_ID}/workflows/{wf_id}")
    root.delete(f"{base_url}api/{ORG_ID}/alerts/destinations/{dest}")
    for role in roles:
        root.delete(f"{base_url}api/{ORG_ID}/users/{users[f'{role}_email']}")
    if member_email:
        root.delete(f"{base_url}api/{ORG_ID}/service_accounts/{member_email}")


def _url(base_url, wf_id, rest=""):
    return f"{base_url}api/{ORG_ID}/workflows/{wf_id}/http_trigger{rest}"


def _attempts(session, base_url, env):
    """Every management call once, the destructive ones last, with each status."""
    wf_id = env["wf_id"]
    cred = env["created"]["credentials"][0]["id"]
    return {
        "get": session.get(_url(base_url, wf_id)).status_code,
        "reveal": session.get(_url(base_url, wf_id, f"/credentials/{cred}/secret")).status_code,
        "test": session.post(_url(base_url, wf_id, "/test"), json={"data": [{}]}).status_code,
        "update": session.put(
            _url(base_url, wf_id), json={"enabled": True, "auth_mode": "token"}
        ).status_code,
        "rotate": session.post(
            _url(base_url, wf_id, "/credentials"), json={"overlap_seconds": 0}
        ).status_code,
        "revoke": session.delete(_url(base_url, wf_id, "/credentials/not-a-credential")).status_code,
    }


# --------------------------------------------------------------------------- OpenFGA on


def test_viewer_can_read_but_not_change_the_endpoint(env, base_url, rbac_enabled):
    if not rbac_enabled:
        pytest.skip("needs OpenFGA on (rbac_enabled)")
    got = _attempts(env["users"]["viewer"], base_url, env)
    assert got["get"] == 200
    for action in ("update", "rotate", "revoke", "test"):
        assert got[action] == 403, (action, got)
    assert env["users"]["viewer"].delete(_url(base_url, env["wf_id"])).status_code == 403


def test_viewer_cannot_reveal(env, base_url, rbac_enabled):
    if not rbac_enabled:
        pytest.skip("needs OpenFGA on (rbac_enabled)")
    cred = env["created"]["credentials"][0]["id"]
    resp = env["users"]["viewer"].get(_url(base_url, env["wf_id"], f"/credentials/{cred}/secret"))
    assert resp.status_code == 403


def test_editor_can_reveal(env, base_url, rbac_enabled):
    if not rbac_enabled:
        pytest.skip("needs OpenFGA on (rbac_enabled)")
    cred = env["created"]["credentials"][0]["id"]
    resp = env["users"]["editor"].get(_url(base_url, env["wf_id"], f"/credentials/{cred}/secret"))
    assert resp.status_code == 200
    assert resp.json()["secret"] == env["created"]["secret"]


def test_permissions_flags_match_the_role(env, base_url, rbac_enabled):
    if not rbac_enabled:
        pytest.skip("needs OpenFGA on (rbac_enabled)")
    expected = {
        "viewer": {"edit": False, "test": False, "reveal": False},
        "editor": {"edit": True, "test": True, "reveal": True},
        "admin": {"edit": True, "test": True, "reveal": True},
    }
    for role, flags in expected.items():
        body = env["users"][role].get(_url(base_url, env["wf_id"])).json()
        assert body["permissions"] == flags, role


def test_editor_can_manage_the_endpoint(env, base_url, rbac_enabled):
    if not rbac_enabled:
        pytest.skip("needs OpenFGA on (rbac_enabled)")
    got = _attempts(env["users"]["editor"], base_url, env)
    for action, status in {"get": 200, "reveal": 200, "test": 200, "update": 200, "rotate": 201, "revoke": 404}.items():
        assert got[action] == status, (action, got)


# --------------------------------------------------------------------------- OpenFGA off


def test_member_cannot_reveal_or_mint_without_admin(env, base_url, rbac_enabled):
    if rbac_enabled:
        pytest.skip("needs OpenFGA off (rbac_enabled false)")
    member = env["users"]["member"]
    view = member.get(_url(base_url, env["wf_id"]))
    assert view.status_code == 200
    assert view.json()["permissions"] == {"edit": True, "test": True, "reveal": False}
    got = _attempts(member, base_url, env)
    for action, status in {"reveal": 403, "rotate": 403, "update": 200, "test": 200, "revoke": 404}.items():
        assert got[action] == status, (action, got)
    switch = member.put(_url(base_url, env["wf_id"]), json={"enabled": True, "auth_mode": "signature"})
    assert switch.status_code == 403


def test_admin_can_reveal_with_openfga_off(env, base_url, rbac_enabled, create_session):
    if rbac_enabled:
        pytest.skip("needs OpenFGA off (rbac_enabled false)")
    admin = env["users"]["admin"]
    view = admin.get(_url(base_url, env["wf_id"])).json()
    assert view["permissions"] == {"edit": True, "test": True, "reveal": True}
    cred = view["credentials"][0]["id"]
    resp = admin.get(_url(base_url, env["wf_id"], f"/credentials/{cred}/secret"))
    assert resp.status_code == 200
    assert resp.json()["secret"].startswith("o2wh_")
