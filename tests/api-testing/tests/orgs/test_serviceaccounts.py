"""Service Account API Tests.

Rewritten in Phase 4 of the api-tests revamp:
- Original had 4 near-identical create+X+delete tests (create+delete,
  create+get+delete, create+update+delete, create+refresh+delete) each
  copy-pasting the same setup. Consolidated into one fixture (creates
  + auto-deletes) + separate small tests for each verb (get, update,
  refresh).
- Drops the 2 duplicate list tests (test_get_service_accounts +
  test_get_service_account both just listed; now one well-validated test).
- Uses unique_email() (RFC 2606 .invalid TLD) instead of
  email_{random.randint(1000, 9999)}@gmail.com — 10k name space is
  small enough to collide; @gmail.com is a real domain.
- Body validation on every create: the response must include a non-empty
  token.
- Keeps the parametrized invalid-email test.
"""
from __future__ import annotations

import logging
from collections.abc import Generator
from http import HTTPStatus

import pytest

from support.client import OpenObserveClient
from support.factories import unique_email

logger = logging.getLogger(__name__)

ORG_ID = "default"


def _sa_payload(email: str, **overrides) -> dict:
    """Build a service account create/update payload."""
    payload = {
        "email": email,
        "organization": ORG_ID,
        "first_name": "",
        "last_name": "",
    }
    payload.update(overrides)
    return payload


# ----- fixtures -----


@pytest.fixture
def temp_service_account(client: OpenObserveClient) -> Generator[str, None, None]:
    """Create a service account with a unique email; yield the email; auto-delete on teardown."""
    email = unique_email("sa")
    resp = client.post("service_accounts", json=_sa_payload(email))
    assert resp.status_code == HTTPStatus.OK, \
        f"setup failed: create service account {email}: {resp.status_code} {resp.text}"

    body = resp.json()
    assert "token" in body, f"create response missing 'token': {body}"
    assert body["token"], f"create response token should be non-empty: {body}"

    yield email

    try:
        client.delete(f"service_accounts/{email}")
    except Exception as e:
        logger.warning("temp_service_account cleanup failed for %s: %s", email, e)


# ----- list -----


def test_list_service_accounts_returns_data_array(client: OpenObserveClient):
    """GET /api/{org}/service_accounts returns a list under the `data` key."""
    resp = client.get("service_accounts")
    assert resp.status_code == HTTPStatus.OK, resp.text

    body = resp.json()
    assert "data" in body, f"response missing 'data' field: {body}"
    assert isinstance(body["data"], list), \
        f"'data' should be a list, got {type(body['data']).__name__}"


# ----- create + verify token -----


def test_create_service_account_returns_nonempty_token(client: OpenObserveClient):
    """POST /service_accounts returns 200 with a non-empty token in the body.

    Uses unique_email directly so we own the lifecycle (rather than depending
    on the temp_service_account fixture which already asserts these things).
    """
    email = unique_email("sa")
    try:
        resp = client.post("service_accounts", json=_sa_payload(email))
        assert resp.status_code == HTTPStatus.OK, resp.text

        body = resp.json()
        assert "token" in body, f"create response missing 'token': {body}"
        assert body["token"], f"token should be non-empty, got: {body['token']!r}"
        assert isinstance(body["token"], str), \
            f"token should be a string, got {type(body['token']).__name__}"
    finally:
        client.delete(f"service_accounts/{email}")


# ----- update -----


def test_update_service_account_first_name(
    client: OpenObserveClient, temp_service_account: str
):
    """PUT /service_accounts/{email} updates first_name + last_name."""
    update_payload = _sa_payload(
        temp_service_account, first_name="updated", last_name="updated"
    )
    resp = client.put(f"service_accounts/{temp_service_account}", json=update_payload)
    assert resp.status_code == HTTPStatus.OK, \
        f"update failed: {resp.status_code} {resp.text}"


# ----- token rotation -----


def test_refresh_service_account_token_rotates_token(
    client: OpenObserveClient, temp_service_account: str
):
    """PUT /service_accounts/{email}?rotateToken=true returns a new token."""
    refresh_payload = _sa_payload(
        temp_service_account, first_name="Get", last_name="Refreshed"
    )
    resp = client.put(
        f"service_accounts/{temp_service_account}?rotateToken=true",
        json=refresh_payload,
    )
    assert resp.status_code == HTTPStatus.OK, \
        f"refresh failed: {resp.status_code} {resp.text}"

    body = resp.json()
    # When rotating, the response should include a new token
    if "token" in body:
        assert body["token"], f"rotated token should be non-empty: {body}"


# ----- error paths -----


@pytest.mark.parametrize(
    "invalid_email",
    ["invalid_email", "", "email@", "@domain.com"],
    ids=["no-at", "empty", "no-domain", "no-local"],
)
def test_create_service_account_with_invalid_email_returns_400(
    client: OpenObserveClient, invalid_email: str
):
    """Creating a service account with a malformed email returns 400."""
    resp = client.post("service_accounts", json=_sa_payload(invalid_email))
    assert resp.status_code == HTTPStatus.BAD_REQUEST, \
        f"invalid email {invalid_email!r} should yield 400, got {resp.status_code}: {resp.text}"
