"""
Workflow folders — folder-scoped RBAC (WFF-RBAC-01 .. WFF-RBAC-06).

Feature: folders for Workflows + folder-scoped RBAC, merged as 8bd20ac96c (#14421)
with o2-enterprise#2605 (the `workflow_folder` authorization type).
Plan: .claude/commands/nvpworkflow/workflow-folders-automation.md

These are the checks that would have caught four of the six bugs the feature work found:
a cross-folder read leak left behind by a move, an OFGA key mismatch that hid every
workflow from every non-root user, drafts created without a folder parent, and a route
ordering bug that authorized workflow folders against dashboard folders.

ENTERPRISE ONLY. The OSS `check_permissions` stub returns true unconditionally, so every
assertion here would pass vacuously on an OSS build — the suite refuses to run rather than
report a false green. It also needs OpenFGA (`O2_OPENFGA_ENABLED=true`); root bypasses every
check, so all assertions run as a purpose-made non-root user.

Permission grants are `{"object": "<resource>:<entity>", "permission": "Allow<Verb>"}` —
the variants are AllowAll / AllowGet / AllowList / AllowPost / AllowPut / AllowDelete, NOT
GET/LIST. Putting an object INTO a folder checks POST on the destination, never PUT.
An `_all_<org>` grant does NOT reach a specific folder for update/delete: those routes use
`use_self_parent: false`, so per-folder grants are the model.

All artifacts are namespaced `wf_auto_rbac_*` and torn down by fixtures.
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
    return f"{int(time.time())}{uuid.uuid4().hex[:4]}"


@pytest.fixture(scope="module", autouse=True)
def _require_enterprise_rbac(create_session, base_url):
    """Refuse to run where the assertions cannot fail: OSS builds, or RBAC turned off."""
    resp = create_session.get(f"{base_url}api/{ORG_ID}/workflows")
    if resp.status_code in (403, 404):
        pytest.skip(f"Workflows not available (/workflows returned {resp.status_code}).")

    resp = create_session.get(f"{base_url}api/{ORG_ID}/roles")
    if resp.status_code != 200:
        msg = f"Roles API unavailable ({resp.status_code}) — not an enterprise build with OpenFGA."
        if os.environ.get("WORKFLOWS_RBAC_REQUIRED") == "1":
            pytest.fail(msg)
        pytest.skip(msg)


# --------------------------------------------------------------------------- helpers


def _session_for(email, password):
    s = requests.Session()
    token = base64.b64encode(f"{email}:{password}".encode()).decode()
    s.headers.update({"Authorization": f"Basic {token}"})
    return s


def _create_folder(session, base_url, name):
    resp = session.post(
        f"{base_url}api/v2/{ORG_ID}/folders/workflows",
        json={"name": name, "description": "rbac automation"},
    )
    assert resp.status_code == 200, f"folder create failed: {resp.status_code} {resp.text[:300]}"
    return resp.json()["folderId"]


def _workflow_payload(name, dest_name):
    return {
        "workflow": {
            "id": "",
            "org_id": "",
            "created_at": 0,
            "updated_at": 0,
            "created_by": "",
            "name": name,
            "description": "rbac automation workflow",
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
        },
        "trigger_type": "AlertFired",
    }


def _list_items(session, base_url, **params):
    resp = session.get(f"{base_url}api/{ORG_ID}/workflows", params=params)
    if resp.status_code != 200:
        return None
    data = resp.json()
    return data if isinstance(data, list) else data.get("list", data.get("data", []))


def _ids(items):
    return {w.get("id") for w in (items or [])}


def _grant(session, base_url, role_id, grants, users=()):
    """PUT the role with `add` permissions and `add_users`, the shape the Roles UI sends."""
    payload = {
        "add": [{"object": obj, "permission": perm} for obj, perm in grants],
        "remove": [],
        "add_users": list(users),
        "remove_users": [],
    }
    resp = session.put(f"{base_url}api/{ORG_ID}/roles/{role_id}", json=payload)
    assert resp.status_code == 200, f"role update failed: {resp.status_code} {resp.text[:300]}"


# --------------------------------------------------------------------------- fixtures


@pytest.fixture(scope="module")
def rbac_env(create_session, base_url):
    """Two folders, a destination, a workflow in each, and a scoped non-root user.

    Module-scoped because OpenFGA tuple writes plus a login round trip are slow, and
    every test in this file wants the same starting shape.
    """
    root = create_session
    tag = _suffix()

    dest_name = f"wf_auto_rbac_dest_{tag}"
    resp = root.post(
        f"{base_url}api/{ORG_ID}/alerts/destinations?module=pipeline",
        json={
            # See test_workflow_folders.py: a loopback URL is rejected by the SSRF guard
            # at save time, which would fail this fixture on every environment.
            "name": dest_name,
            "url": SINK_URL,
            "method": "post",
            "type": "http",
        },
    )
    assert resp.status_code == 200, f"destination create failed: {resp.text[:300]}"

    folder_a = _create_folder(root, base_url, f"wf_auto_rbac_a_{tag}")
    folder_b = _create_folder(root, base_url, f"wf_auto_rbac_b_{tag}")

    created = {}
    for label, folder in (("a", folder_a), ("b", folder_b)):
        name = f"wf_auto_rbac_wf_{label}_{tag}"
        resp = root.post(
            f"{base_url}api/{ORG_ID}/workflows",
            params={"folder": folder},
            json=_workflow_payload(name, dest_name),
        )
        assert resp.status_code == 200, f"workflow create failed: {resp.text[:300]}"
        created[label] = {"id": resp.json()["id"], "name": name}

    email = f"wf_auto_rbac_user_{tag}@automation.local"
    resp = root.post(
        f"{base_url}api/{ORG_ID}/users",
        json={
            "email": email,
            "password": USER_PASSWORD,
            "first_name": "Folder",
            "last_name": "Scoped",
            # Built-in roles on an enterprise build are admin/editor/viewer/user;
            # `user` is the least-privileged base. The custom role carries the grants.
            "role": "user",
        },
    )
    assert resp.status_code in (200, 201), f"user create failed: {resp.status_code} {resp.text[:300]}"

    role_id = f"wf_auto_rbac_role_{tag}"
    resp = root.post(f"{base_url}api/{ORG_ID}/roles", json={"role": role_id})
    assert resp.status_code in (200, 201), f"role create failed: {resp.status_code} {resp.text[:300]}"

    # Folder A only, plus the org-wide list grant the list route needs to return anything.
    _grant(
        root,
        base_url,
        role_id,
        [
            (f"workflow_folder:{folder_a}", "AllowGet"),
            (f"workflow_folder:{folder_a}", "AllowList"),
            (f"workflow_folder:{folder_a}", "AllowPost"),
            (f"workflows:_all_{ORG_ID}", "AllowList"),
            # Org-wide POST on the `workflows` resource satisfies the route-level check;
            # the per-folder grant above decides WHICH folder may receive the write. Both
            # layers are needed, and granting this is what makes the folder-scoped denials
            # below meaningful rather than route-level accidents.
            (f"workflows:_all_{ORG_ID}", "AllowPost"),
            (f"workflows:{created['a']['id']}", "AllowGet"),
            (f"workflows:{created['a']['id']}", "AllowPut"),
        ],
        users=[email],
    )

    # OpenFGA tuple writes are not read-your-writes; give them a beat to land.
    time.sleep(2)

    env = {
        "tag": tag,
        "dest": dest_name,
        "folder_a": folder_a,
        "folder_b": folder_b,
        "workflows": created,
        "email": email,
        "role_id": role_id,
        "session": _session_for(email, USER_PASSWORD),
    }
    yield env

    for wf in created.values():
        root.delete(f"{base_url}api/{ORG_ID}/workflows/{wf['id']}")
    for folder in (folder_a, folder_b):
        for row in _list_items(root, base_url, folder=folder) or []:
            params = {"draft": "true"} if row.get("is_draft") else {}
            root.delete(f"{base_url}api/{ORG_ID}/workflows/{row['id']}", params=params)
        root.delete(f"{base_url}api/v2/{ORG_ID}/folders/workflows/{folder}")
    root.delete(f"{base_url}api/{ORG_ID}/alerts/destinations/{dest_name}")
    root.delete(f"{base_url}api/{ORG_ID}/roles/{role_id}")
    root.delete(f"{base_url}api/{ORG_ID}/users/{email}")


# --------------------------------------------------------------------------- WFF-RBAC-01/03


def test_folder_scoped_role_sees_only_its_folder(rbac_env, base_url):
    """WFF-RBAC-01 — a role granted folder A reads A, and cannot read or write B."""
    user = rbac_env["session"]

    in_a = _ids(_list_items(user, base_url, folder=rbac_env["folder_a"]))
    assert rbac_env["workflows"]["a"]["id"] in in_a, "the granted folder's workflow is not visible"

    resp = user.get(f"{base_url}api/{ORG_ID}/workflows", params={"folder": rbac_env["folder_b"]})
    # Either the route refuses outright or the per-item filter empties it; both are correct,
    # leaking B's workflow is not.
    if resp.status_code == 200:
        assert rbac_env["workflows"]["b"]["id"] not in _ids(
            resp.json() if isinstance(resp.json(), list) else resp.json().get("list", [])
        ), "a folder the role cannot read leaked its workflow"
    else:
        assert resp.status_code == 403, f"unexpected status {resp.status_code}: {resp.text[:300]}"


def test_create_into_an_ungranted_folder_is_forbidden(rbac_env, base_url):
    """WFF-RBAC-01b — creating into folder B is refused; the same check gates drafts."""
    user = rbac_env["session"]
    payload = _workflow_payload(f"wf_auto_rbac_denied_{_suffix()}", rbac_env["dest"])

    resp = user.post(
        f"{base_url}api/{ORG_ID}/workflows",
        params={"folder": rbac_env["folder_b"]},
        json=payload,
    )
    assert resp.status_code == 403, f"create into an ungranted folder returned {resp.status_code}"

    resp = user.post(
        f"{base_url}api/{ORG_ID}/workflows",
        params={"folder": rbac_env["folder_b"], "draft": "true"},
        json=payload,
    )
    assert resp.status_code == 403, f"draft into an ungranted folder returned {resp.status_code}"


def test_permitted_listing_is_not_empty_for_a_non_root_user(rbac_env, base_url):
    """WFF-RBAC-03 — with O2_OPENFGA_LIST_ONLY_PERMITTED=true a granted user still sees their rows.

    The pre-existing bug built the permission key as `workflow:<id>` while the OFGA model
    names it `workflows`, which hid every workflow from every non-root user.
    """
    rows = _list_items(rbac_env["session"], base_url, folder=rbac_env["folder_a"])
    assert rows is not None, "list returned a non-200 for a user holding an explicit grant"
    assert rows, "a granted non-root user saw an empty list — the OFGA key mismatch is back"


# --------------------------------------------------------------------------- WFF-RBAC-02


def test_move_requires_write_on_the_destination_folder(rbac_env, base_url):
    """WFF-RBAC-02 — PUT on the workflow is not enough; the destination folder needs POST too.

    Without the destination check a list+delete role could relocate workflows between
    folders it cannot write.
    """
    user = rbac_env["session"]
    resp = user.patch(
        f"{base_url}api/v2/{ORG_ID}/workflows/move",
        json={
            "workflow_ids": [rbac_env["workflows"]["a"]["id"]],
            "dst_folder_id": rbac_env["folder_b"],
        },
    )
    assert resp.status_code == 403, (
        f"move into an ungranted destination returned {resp.status_code}: {resp.text[:300]}"
    )

    # The workflow must not have moved.
    root_rows = _ids(_list_items(rbac_env["session"], base_url, folder=rbac_env["folder_a"]))
    assert rbac_env["workflows"]["a"]["id"] in root_rows, "a forbidden move still relocated the row"


def test_move_of_an_ungranted_workflow_is_forbidden(rbac_env, base_url):
    """WFF-RBAC-02b — every id in the batch is checked, so B's workflow cannot ride along."""
    resp = rbac_env["session"].patch(
        f"{base_url}api/v2/{ORG_ID}/workflows/move",
        json={
            "workflow_ids": [rbac_env["workflows"]["b"]["id"]],
            "dst_folder_id": rbac_env["folder_a"],
        },
    )
    assert resp.status_code == 403, (
        f"moving a workflow the role cannot PUT returned {resp.status_code}: {resp.text[:300]}"
    )


# --------------------------------------------------------------------------- WFF-RBAC-04


def test_move_does_not_leave_a_read_leak_in_the_source_folder(
    create_session, rbac_env, base_url
):
    """WFF-RBAC-04 — after root moves A's workflow to B, the A-scoped role loses sight of it.

    `remove_ownership` only deletes the source folder's parent tuple when the call names the
    OLD parent; leaving it behind let a folder-scoped role keep reading a workflow that had
    moved out of its folder.
    """
    root = create_session
    user = rbac_env["session"]
    wf_id = rbac_env["workflows"]["a"]["id"]

    resp = root.patch(
        f"{base_url}api/v2/{ORG_ID}/workflows/move",
        json={"workflow_ids": [wf_id], "dst_folder_id": rbac_env["folder_b"]},
    )
    assert resp.status_code == 200, f"root move failed: {resp.status_code} {resp.text[:300]}"
    time.sleep(2)  # tuple writes are not read-your-writes

    try:
        assert wf_id not in _ids(_list_items(user, base_url, folder=rbac_env["folder_a"])), (
            "the moved workflow is still listed under the folder it left"
        )
        # The cross-folder listing is the sharper probe: it returns everything the caller
        # may see anywhere, so a stale parent tuple surfaces here even when the folder
        # listing looks clean.
        assert wf_id not in _ids(_list_items(user, base_url, all_folders="true")), (
            "a stale source-folder tuple still grants cross-folder read on the moved workflow"
        )
    finally:
        root.patch(
            f"{base_url}api/v2/{ORG_ID}/workflows/move",
            json={"workflow_ids": [wf_id], "dst_folder_id": rbac_env["folder_a"]},
        )
        time.sleep(2)


# --------------------------------------------------------------------------- WFF-RBAC-05


def test_draft_in_a_granted_folder_is_reachable_and_promotable(rbac_env, base_url):
    """WFF-RBAC-05 — a draft gets its folder as authz parent, so an A-scoped role can promote it.

    Two regressions guarded here. Drafts used to be registered with `Authz::new(id)` and no
    folder parent, so folder-scoped grants never reached them. And promote without `?folder=`
    used to authorize against the DEFAULT folder rather than the draft's own, so a role holding
    full grants on its own folder was denied unless it also held write on `default`
    (o2-enterprise#2653). Requires that fix to be present.
    """
    user = rbac_env["session"]
    name = f"wf_auto_rbac_draft_{_suffix()}"

    resp = user.post(
        f"{base_url}api/{ORG_ID}/workflows",
        params={"folder": rbac_env["folder_a"], "draft": "true"},
        json=_workflow_payload(name, rbac_env["dest"]),
    )
    assert resp.status_code == 200, f"draft create in a granted folder failed: {resp.text[:300]}"
    draft_id = resp.json()["id"]
    time.sleep(2)

    try:
        rows = _list_items(user, base_url, folder=rbac_env["folder_a"])
        assert draft_id in _ids(rows), "a draft in the granted folder is not visible to that role"

        resp = user.post(f"{base_url}api/{ORG_ID}/workflows/promote/{draft_id}")
        # 201 Created, not 200 — `MetaHttpResponse::created`.
        assert resp.status_code == 201, (
            f"promoting a draft inside the granted folder returned {resp.status_code}: {resp.text[:300]}"
        )
    finally:
        # A promoted draft is published now, so the plain delete is the right one;
        # fall back to ?draft=true if the promote never happened.
        if user.delete(f"{base_url}api/{ORG_ID}/workflows/{draft_id}").status_code == 404:
            user.delete(f"{base_url}api/{ORG_ID}/workflows/{draft_id}", params={"draft": "true"})


# --------------------------------------------------------------------------- WFF-RBAC-06


def test_workflow_folder_routes_authorize_against_workflow_folders(rbac_env, base_url):
    """WFF-RBAC-06 — `folders/workflows/{id}` must not be swallowed by the `folders/{type}/{id}` catch-all.

    First match wins in the router, so before the peer route was moved ahead of the generic
    one, workflow folder get/update/delete authorized against DASHBOARD folders and 403'd
    even with full workflow-folder grants.
    """
    user = rbac_env["session"]

    resp = user.get(f"{base_url}api/v2/{ORG_ID}/folders/workflows/{rbac_env['folder_a']}")
    assert resp.status_code == 200, (
        f"a granted workflow folder returned {resp.status_code} — "
        f"the generic folders/{{type}}/{{id}} route is matching first again: {resp.text[:300]}"
    )
    assert resp.json().get("folderId") == rbac_env["folder_a"]


def test_promote_into_an_ungranted_folder_is_forbidden(rbac_env, base_url):
    """WFF-RBAC-07 — promoting is a create into the destination, so it needs write there.

    Cross-folder promote is the only way a draft changes folder (the move endpoint refuses
    drafts outright), so without this check it would be the hole every other folder grant
    is closing: draft in a folder you own, publish into one you do not.
    """
    user = rbac_env["session"]
    name = f"wf_auto_rbac_promote_denied_{_suffix()}"

    resp = user.post(
        f"{base_url}api/{ORG_ID}/workflows",
        params={"folder": rbac_env["folder_a"], "draft": "true"},
        json=_workflow_payload(name, rbac_env["dest"]),
    )
    assert resp.status_code == 200, f"draft create in the granted folder failed: {resp.text[:300]}"
    draft_id = resp.json()["id"]
    time.sleep(2)

    try:
        resp = user.post(
            f"{base_url}api/{ORG_ID}/workflows/promote/{draft_id}",
            params={"folder": rbac_env["folder_b"]},
        )
        assert resp.status_code == 403, (
            f"promote into an ungranted folder returned {resp.status_code}: {resp.text[:300]}"
        )
        # And it must not have published anyway.
        rows = _list_items(rbac_env["session"], base_url, folder=rbac_env["folder_a"])
        row = next((w for w in (rows or []) if w.get("id") == draft_id), None)
        assert row is not None and row.get("is_draft") is True, (
            "a forbidden promote still published the draft"
        )
    finally:
        # Deleting a draft without ?draft=true 404s, leaking it and blocking folder teardown.
        user.delete(f"{base_url}api/{ORG_ID}/workflows/{draft_id}", params={"draft": "true"})
