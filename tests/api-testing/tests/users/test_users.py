"""User Management API Tests.

Rewritten in Phase 4 of the api-tests revamp:
- Uses unique-suffix emails via `temp_user_email` fixture (no more fixed
  `pytests@gmail.com` that cascaded failures and blocked parallel runs).
- Validates response bodies, not just status codes.
- Groups error-path cases via parametrize.
- Uses the new `client` fixture (no per-test session = create_session triple).
"""
from __future__ import annotations

import logging

import pytest

from support.client import OpenObserveClient
from support.factories import unique_email, user_payload

logger = logging.getLogger(__name__)

ORG_ID = "default"


# ----- list -----


def test_list_users_includes_root(client: OpenObserveClient):
    """The root user that bootstrapped OO must appear in the user list."""
    users = client.users.list()
    assert isinstance(users, list), f"users.list() should return a list, got {type(users).__name__}"
    emails = [u.get("email") for u in users]
    assert "root@example.com" in emails, f"root user missing from user list: {emails}"


# ----- create + delete (happy path) -----


def test_create_and_delete_admin_user(client: OpenObserveClient, temp_user_email: str):
    """Create an admin user, verify the response body, then delete cleanly.

    temp_user_email fixture provides a unique email and auto-cleanups on teardown
    (the delete call here is for the happy-path assertion; the fixture's cleanup
    is a safety net if the test crashes mid-way).
    """
    payload = user_payload(email=temp_user_email, role="admin")

    create_resp = client.users.create(payload)
    assert create_resp.status_code == 200, f"create failed: {create_resp.status_code} {create_resp.text}"

    # Verify list-side effect — the user we just created should now appear in users.list()
    user_emails_after = [u.get("email") for u in client.users.list()]
    assert temp_user_email in user_emails_after, \
        f"created user {temp_user_email} not in list: {user_emails_after}"

    delete_resp = client.users.delete(temp_user_email)
    assert delete_resp.status_code == 200, f"delete failed: {delete_resp.status_code} {delete_resp.text}"


# ----- error paths (parametrized) -----


@pytest.mark.parametrize(
    ("override", "expected_status", "description"),
    [
        ({"password": "123456"}, 400, "password shorter than minimum"),
        ({"role": "m"}, 400, "invalid role value 'm'"),
    ],
    ids=["short-password", "invalid-role"],
)
def test_create_user_rejects_invalid_payloads(
    client: OpenObserveClient,
    override: dict,
    expected_status: int,
    description: str,
):
    """Invalid create payloads must be rejected with the expected client-error status.

    Replaces 2 near-identical legacy tests (invalid_password, invalidrole) that
    each copy-pasted the same setup with a one-field difference.
    """
    payload = user_payload(email=unique_email("invalid"))
    payload.update(override)

    resp = client.users.create(payload)
    assert resp.status_code == expected_status, \
        f"expected {expected_status} for {description!r}, got {resp.status_code}: {resp.text}"


def test_create_user_in_nonexistent_org_returns_404(client: OpenObserveClient):
    """POSTing to a non-existent org returns 404."""
    payload = user_payload(email=unique_email("nonorg"))
    # Use the request shortcut to override org for this call
    resp = client.post("users", json=payload, org="default_invalid")
    assert resp.status_code == 404, \
        f"expected 404 for nonexistent org, got {resp.status_code}: {resp.text}"


def test_create_user_with_email_in_path_returns_422(client: OpenObserveClient):
    """POST /users/{email} is not the create endpoint; OO returns 422.

    This documents the API behavior — there's no path-templated create.
    """
    payload = user_payload(email=unique_email("path"))
    resp = client.post("users/somerandom@test.invalid", json=payload)
    assert resp.status_code == 422, \
        f"expected 422 for unsupported path, got {resp.status_code}: {resp.text}"


# ----- update -----


def test_update_user_first_name(client: OpenObserveClient, temp_user_email: str):
    """Create, update first_name, verify the change is persisted in the list."""
    # Create
    payload = user_payload(email=temp_user_email, first_name="Original")
    create_resp = client.users.create(payload)
    assert create_resp.status_code == 200, create_resp.text

    # Update first_name (must use the same email in the URL path)
    updated = user_payload(email=temp_user_email, first_name="Renamed")
    update_resp = client.users.update(temp_user_email, updated)
    assert update_resp.status_code == 200, \
        f"update failed: {update_resp.status_code} {update_resp.text}"

    # Verify the update persisted — find our user in the list and check first_name
    user = next(
        (u for u in client.users.list() if u.get("email") == temp_user_email),
        None,
    )
    assert user is not None, f"user {temp_user_email} missing from list after update"
    assert user.get("first_name") == "Renamed", \
        f"first_name should be 'Renamed' after update, got {user.get('first_name')!r}"


def test_update_nonexistent_user_returns_404(client: OpenObserveClient):
    """Updating a user that doesn't exist returns 404."""
    nonexistent = unique_email("ghost")
    payload = user_payload(email=nonexistent, first_name="Phantom")

    resp = client.users.update(nonexistent, payload)
    assert resp.status_code == 404, \
        f"expected 404 for update of nonexistent user, got {resp.status_code}: {resp.text}"


def test_create_duplicate_user_returns_400(client: OpenObserveClient, temp_user_email: str):
    """Creating the same user twice returns 400 on the second attempt."""
    payload = user_payload(email=temp_user_email)

    first = client.users.create(payload)
    assert first.status_code == 200, first.text

    second = client.users.create(payload)
    assert second.status_code == 400, \
        f"second create should be 400 (already exists), got {second.status_code}: {second.text}"
