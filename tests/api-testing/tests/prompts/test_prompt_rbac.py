"""
Prompt registry RBAC: per-prompt grants and protected labels.

ENTERPRISE ONLY, with OpenFGA enabled. Root bypasses every check, so every
assertion runs as a purpose-made editor or custom-role user.

- Moving or deleting a protected label (default: `production`) needs the org-wide
  `prompt_label` grant. Editors are not blanket-approved for it.
- Changing which labels are protected needs the same grant.
- `prompt` grants are per prompt: list, match and resolve only reach prompts the
  caller can read, and `{id}` routes check the prompt itself.

All artifacts are namespaced `prompt_rbac_*`; prompts are archived on teardown
(the registry has no hard delete).
"""

import base64
import os
import time
import uuid

import pytest
import requests

ORG_ID = os.environ.get("TEST_ORG_ID", "default")
USER_PASSWORD = "Complexpass#123"


def _session_for(email, password):
    s = requests.Session()
    token = base64.b64encode(f"{email}:{password}".encode()).decode()
    s.headers.update({"Authorization": f"Basic {token}"})
    return s


def _grant(session, base_url, role_id, grants, users=()):
    resp = session.put(
        f"{base_url}api/{ORG_ID}/roles/{role_id}",
        json={
            "add": [{"object": obj, "permission": perm} for obj, perm in grants],
            "remove": [],
            "add_users": list(users),
            "remove_users": [],
        },
    )
    assert resp.status_code == 200, f"role update failed: {resp.status_code} {resp.text[:300]}"


def _create_user(root, base_url, email, role):
    resp = root.post(
        f"{base_url}api/{ORG_ID}/users",
        json={
            "email": email,
            "password": USER_PASSWORD,
            "first_name": "Prompt",
            "last_name": "Rbac",
            "role": role,
        },
    )
    assert resp.status_code in (200, 201), f"user create failed: {resp.status_code} {resp.text[:300]}"


def _create_prompt(root, base_url, name):
    resp = root.post(
        f"{base_url}api/{ORG_ID}/prompts",
        json={
            "name": name,
            "folderId": "default",
            "type": "text",
            "payload": "You are an assistant.",
            "config": {},
            "commitMessage": "v1",
        },
    )
    assert resp.status_code == 200, f"prompt create failed: {resp.status_code} {resp.text[:300]}"
    entity_id = resp.json()["prompt"]["entityId"]
    resp = root.post(
        f"{base_url}api/{ORG_ID}/prompts/{entity_id}/versions",
        json={"payload": "You are a terse assistant.", "config": {}, "commitMessage": "v2"},
    )
    assert resp.status_code == 200, f"version create failed: {resp.status_code} {resp.text[:300]}"
    return entity_id


@pytest.fixture(scope="module")
def env(create_session, base_url):
    root = create_session
    if root.get(f"{base_url}api/{ORG_ID}/roles").status_code != 200:
        pytest.skip("Roles API unavailable — not an enterprise build with OpenFGA.")

    tag = f"{int(time.time())}{uuid.uuid4().hex[:4]}"
    names = {"a": f"prompt_rbac_a_{tag}", "b": f"prompt_rbac_b_{tag}"}
    prompts = {key: _create_prompt(root, base_url, name) for key, name in names.items()}
    for entity_id in prompts.values():
        for label in ("production", "staging"):
            resp = root.put(
                f"{base_url}api/{ORG_ID}/prompts/{entity_id}/labels/{label}",
                json={"version": 1},
            )
            assert resp.status_code == 200, f"root label move failed: {resp.text[:300]}"

    editor = f"prompt_rbac_editor_{tag}@automation.local"
    scoped = f"prompt_rbac_scoped_{tag}@automation.local"
    _create_user(root, base_url, editor, "editor")
    _create_user(root, base_url, scoped, "user")

    role_id = f"prompt_rbac_role_{tag}"
    resp = root.post(f"{base_url}api/{ORG_ID}/roles", json={"role": role_id})
    assert resp.status_code in (200, 201), f"role create failed: {resp.status_code} {resp.text[:300]}"
    # Prompt A only, plus the org-wide LIST the collection routes need.
    _grant(
        root,
        base_url,
        role_id,
        [
            (f"prompt:_all_{ORG_ID}", "AllowList"),
            (f"prompt:{prompts['a']}", "AllowGet"),
            (f"prompt:{prompts['a']}", "AllowPut"),
        ],
        users=[scoped],
    )
    # OpenFGA tuple writes are not read-your-writes.
    time.sleep(2)

    yield {
        "root": root,
        "names": names,
        "prompts": prompts,
        "role_id": role_id,
        "editor": _session_for(editor, USER_PASSWORD),
        "scoped": _session_for(scoped, USER_PASSWORD),
    }

    for entity_id in prompts.values():
        root.post(f"{base_url}api/{ORG_ID}/prompts/{entity_id}/archive")
    root.delete(f"{base_url}api/{ORG_ID}/roles/{role_id}")
    for email in (editor, scoped):
        root.delete(f"{base_url}api/{ORG_ID}/users/{email}")


def _move(session, base_url, entity_id, label, version):
    return session.put(
        f"{base_url}api/{ORG_ID}/prompts/{entity_id}/labels/{label}",
        json={"version": version},
    )


def test_editor_moves_unprotected_label(env, base_url):
    resp = _move(env["editor"], base_url, env["prompts"]["a"], "staging", 2)
    assert resp.status_code == 200, resp.text


def test_editor_cannot_move_or_delete_production(env, base_url):
    entity_id = env["prompts"]["a"]
    resp = _move(env["editor"], base_url, entity_id, "production", 2)
    assert resp.status_code == 403, resp.text
    resp = env["editor"].delete(f"{base_url}api/{ORG_ID}/prompts/{entity_id}/labels/production")
    assert resp.status_code == 403, resp.text


def test_editor_cannot_unprotect_production(env, base_url):
    settings = f"{base_url}api/{ORG_ID}/prompts/settings"
    resp = env["editor"].put(settings, json={"protectedLabels": ["staging"], "webhook": None})
    assert resp.status_code == 403, resp.text
    # Saving settings without touching the protected set still works.
    resp = env["editor"].put(settings, json={"protectedLabels": ["production"], "webhook": None})
    assert resp.status_code == 200, resp.text


def test_scoped_user_sees_only_granted_prompt(env, base_url):
    s, prompts = env["scoped"], env["prompts"]
    resp = s.get(f"{base_url}api/{ORG_ID}/prompts")
    assert resp.status_code == 200, resp.text
    ids = {p["entityId"] for p in resp.json()["list"]}
    assert prompts["a"] in ids
    assert prompts["b"] not in ids

    assert s.get(f"{base_url}api/{ORG_ID}/prompts/{prompts['a']}").status_code == 200
    assert s.get(f"{base_url}api/{ORG_ID}/prompts/{prompts['b']}").status_code == 403


def test_scoped_user_resolves_only_granted_prompt(env, base_url):
    s, names = env["scoped"], env["names"]
    resolve = f"{base_url}api/{ORG_ID}/prompts/resolve"
    assert s.get(resolve, params={"name": names["a"]}).status_code == 200
    # An unreadable prompt must look exactly like a missing one, whatever the selector.
    for params in ({"name": names["b"]}, {"name": names["b"], "label": "no-such-label"}):
        resp = s.get(resolve, params=params)
        assert resp.status_code == 404, resp.text
        assert resp.json()["code"] == "prompt_not_found", resp.text
    resp = s.get(resolve, params={"name": f"prompt_rbac_missing_{uuid.uuid4().hex[:6]}"})
    assert resp.json()["code"] == "prompt_not_found", resp.text


def test_scoped_user_writes_only_granted_prompt(env, base_url):
    s, prompts = env["scoped"], env["prompts"]
    assert _move(s, base_url, prompts["a"], "staging", 2).status_code == 200
    assert _move(s, base_url, prompts["b"], "staging", 2).status_code == 403


def test_protected_label_grant_is_explicit(env, base_url):
    s, entity_id = env["scoped"], env["prompts"]["a"]
    # Prompt PUT alone is not enough.
    assert _move(s, base_url, entity_id, "production", 2).status_code == 403

    _grant(env["root"], base_url, env["role_id"], [(f"prompt_label:_all_{ORG_ID}", "AllowPut")])
    time.sleep(2)
    resp = _move(s, base_url, entity_id, "production", 2)
    assert resp.status_code == 200, resp.text
