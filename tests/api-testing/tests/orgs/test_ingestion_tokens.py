"""Org-Level Ingestion Token API Tests.

Covers PR #11691 — org-level ingestion tokens (prefix o2oi_).

Token CRUD, enable/disable, ingestion auth (org token + backward compat),
non-ingestion path blocking. Follows the new-framework pattern from
test_serviceaccounts.py.

.. note::

    **No DELETE endpoint exists for ingestion tokens.** Tokens created during
    test runs cannot be cleaned up (the API returns 405). The ``temp_token``
    fixture logs each created token for traceability. Each test uses a unique
    name (``unique_name("tkn")``) to avoid cross-test collisions. This is a
    known limitation of the ingestion-tokens API, not a test framework gap.
"""
from __future__ import annotations

import logging
import os
from collections.abc import Generator
from http import HTTPStatus

import pytest

from support.client import OpenObserveClient
from support.factories import unique_name

logger = logging.getLogger(__name__)

ORG_ID = os.environ.get("TEST_ORG_ID", "default")


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _token_payload(name: str, **overrides) -> dict:
    payload = {"name": name, "description": ""}
    payload.update(overrides)
    return payload


def _token_client(org_id: str, token: str) -> OpenObserveClient:
    """Return a client whose Basic auth is org_id:o2oi_token."""
    return OpenObserveClient(email=org_id, password=token, org=org_id)


# ---------------------------------------------------------------------------
# fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def temp_token(client: OpenObserveClient) -> Generator[dict, None, None]:
    """Create an ingestion token with a unique name; yield full token dict.

    There is no DELETE endpoint for tokens, so cleanup only logs.
    """
    name = unique_name("tkn")
    resp = client.post("ingestion-tokens", json=_token_payload(name))
    assert resp.status_code == HTTPStatus.OK, \
        f"fixture create failed: {resp.status_code} {resp.text}"

    body = resp.json()
    assert "data" in body, f"create response missing 'data': {body}"
    token_data = body["data"]
    assert token_data.get("token"), f"token should be non-empty: {token_data}"
    assert token_data["token"].startswith("o2oi_"), \
        f"token should start with o2oi_: {token_data['token']}"

    yield token_data

    # No DELETE endpoint — tokens cannot be removed. Log for traceability.
    logger.info("temp_token %s cannot be deleted (no DELETE endpoint)", name)


# ---------------------------------------------------------------------------
# 1. Create Token — happy path
# ---------------------------------------------------------------------------


def test_create_token_returns_o2oi_prefix_and_37_chars(
    client: OpenObserveClient, temp_token: dict
):
    """POST /ingestion-tokens returns a token with o2oi_ prefix, 37 chars."""
    token = temp_token["token"]
    assert token.startswith("o2oi_"), f"bad prefix: {token}"
    assert len(token) == 37, f"expected 37 chars, got {len(token)}: {token!r}"


def test_create_token_persists_name_and_created_by(
    client: OpenObserveClient, temp_token: dict
):
    """Created token has the requested name and created_by set."""
    assert temp_token["name"].startswith("tkn_"), f"unexpected name: {temp_token}"
    assert "created_by" in temp_token, f"missing created_by: {temp_token}"
    assert temp_token.get("enabled") is True
    assert temp_token.get("is_default") is False


def test_create_token_name_only_no_description(client: OpenObserveClient):
    """POST with only name (no description) — description is empty."""
    name = unique_name("nodesc")
    resp = client.post("ingestion-tokens", json={"name": name})
    assert resp.status_code == HTTPStatus.OK, resp.text
    body = resp.json()
    assert body["data"]["description"] == "", \
        f"description should be empty: {body['data']}"


def test_create_token_hyphens_and_underscores(client: OpenObserveClient):
    """Names with hyphens and underscores are allowed."""
    name = unique_name("valid-name_test")
    resp = client.post("ingestion-tokens", json=_token_payload(name))
    assert resp.status_code == HTTPStatus.OK, resp.text
    assert resp.json()["data"]["token"].startswith("o2oi_")


# ---------------------------------------------------------------------------
# 2. Create Token — error paths
# ---------------------------------------------------------------------------


def test_create_duplicate_name_returns_400(
    client: OpenObserveClient, temp_token: dict
):
    """Duplicate token name in the same org returns 400."""
    resp = client.post("ingestion-tokens", json=_token_payload(temp_token["name"]))
    assert resp.status_code == HTTPStatus.BAD_REQUEST, \
        f"expected 400, got {resp.status_code}: {resp.text}"
    assert "already exists" in resp.json().get("message", ""), resp.text


def test_create_token_empty_name_returns_400(client: OpenObserveClient):
    resp = client.post("ingestion-tokens", json=_token_payload(""))
    assert resp.status_code == HTTPStatus.BAD_REQUEST, \
        f"expected 400, got {resp.status_code}: {resp.text}"
    assert "cannot be empty" in resp.json().get("message", "").lower(), \
        f"unexpected error message: {resp.text}"


def test_create_token_whitespace_name_returns_400(client: OpenObserveClient):
    resp = client.post("ingestion-tokens", json=_token_payload("   "))
    assert resp.status_code == HTTPStatus.BAD_REQUEST, \
        f"expected 400, got {resp.status_code}: {resp.text}"
    assert "cannot be empty" in resp.json().get("message", "").lower(), \
        f"unexpected error message: {resp.text}"


def test_create_token_name_too_long_returns_400(client: OpenObserveClient):
    resp = client.post("ingestion-tokens", json=_token_payload("a" * 257))
    assert resp.status_code == HTTPStatus.BAD_REQUEST, \
        f"expected 400, got {resp.status_code}: {resp.text}"
    assert resp.json().get("message"), \
        f"error message should be non-empty: {resp.text}"


@pytest.mark.parametrize(
    "bad_name",
    ["spaces in name", "at@sign", "dot.in.name", "slash/name"],
    ids=["spaces", "at-sign", "dot", "slash"],
)
def test_create_token_special_chars_returns_400(
    client: OpenObserveClient, bad_name: str
):
    """Special characters other than - and _ are rejected."""
    resp = client.post("ingestion-tokens", json=_token_payload(bad_name))
    assert resp.status_code == HTTPStatus.BAD_REQUEST, \
        f"expected 400 for {bad_name!r}, got {resp.status_code}: {resp.text}"
    assert "alphanumeric" in resp.json().get("message", ""), resp.text


# ---------------------------------------------------------------------------
# 3. List Tokens
# ---------------------------------------------------------------------------


def test_list_tokens_returns_data_array(client: OpenObserveClient):
    """GET /ingestion-tokens returns a list under the `data` key."""
    resp = client.get("ingestion-tokens")
    assert resp.status_code == HTTPStatus.OK, resp.text
    body = resp.json()
    assert "data" in body, f"response missing 'data' field: {body}"
    assert isinstance(body["data"], list), \
        f"'data' should be a list, got {type(body['data']).__name__}"


def test_list_tokens_includes_created_token(
    client: OpenObserveClient, temp_token: dict
):
    """After creating a token, it appears in the list."""
    resp = client.get("ingestion-tokens")
    assert resp.status_code == HTTPStatus.OK, resp.text
    names = [t["name"] for t in resp.json()["data"]]
    assert temp_token["name"] in names, \
        f"token {temp_token['name']} not found in list: {names}"


def test_list_tokens_are_unmasked(client: OpenObserveClient, temp_token: dict):
    """Token values in list response are full / unmasked (current behaviour)."""
    resp = client.get("ingestion-tokens")
    assert resp.status_code == HTTPStatus.OK, resp.text
    for t in resp.json()["data"]:
        if t["name"] == temp_token["name"]:
            assert t["token"] == temp_token["token"], \
                f"token mismatch: {t['token']} != {temp_token['token']}"
            break
    else:
        pytest.fail(f"token {temp_token['name']} not in list")


# ---------------------------------------------------------------------------
# 4. Enable / Disable
# ---------------------------------------------------------------------------


def test_disable_token(client: OpenObserveClient, temp_token: dict):
    """PATCH with enabled=false disables the token."""
    resp = client.patch(
        f"ingestion-tokens/{temp_token['name']}",
        json={"enabled": False},
    )
    assert resp.status_code == HTTPStatus.OK, resp.text
    # Verify it shows as disabled in list
    list_resp = client.get("ingestion-tokens")
    for t in list_resp.json()["data"]:
        if t["name"] == temp_token["name"]:
            assert t["enabled"] is False, f"token still enabled: {t}"
            break


def test_enable_disabled_token(client: OpenObserveClient, temp_token: dict):
    """Disable then re-enable the same token."""
    # disable
    client.patch(
        f"ingestion-tokens/{temp_token['name']}",
        json={"enabled": False},
    )
    # re-enable
    resp = client.patch(
        f"ingestion-tokens/{temp_token['name']}",
        json={"enabled": True},
    )
    assert resp.status_code == HTTPStatus.OK, resp.text
    # Verify
    list_resp = client.get("ingestion-tokens")
    for t in list_resp.json()["data"]:
        if t["name"] == temp_token["name"]:
            assert t["enabled"] is True, f"token not re-enabled: {t}"
            break


def test_double_disable_is_noop(client: OpenObserveClient, temp_token: dict):
    """Disabling an already-disabled token succeeds (no-op)."""
    # disable once
    client.patch(
        f"ingestion-tokens/{temp_token['name']}",
        json={"enabled": False},
    )
    # disable again
    resp = client.patch(
        f"ingestion-tokens/{temp_token['name']}",
        json={"enabled": False},
    )
    assert resp.status_code == HTTPStatus.OK, resp.text


def test_toggle_nonexistent_token_returns_404(client: OpenObserveClient):
    resp = client.patch("ingestion-tokens/nonexistent_tkn", json={"enabled": False})
    assert resp.status_code == HTTPStatus.NOT_FOUND, \
        f"expected 404, got {resp.status_code}: {resp.text}"


# ---------------------------------------------------------------------------
# 5. DELETE — not supported
# ---------------------------------------------------------------------------


def test_delete_token_returns_405(client: OpenObserveClient, temp_token: dict):
    resp = client.delete(f"ingestion-tokens/{temp_token['name']}")
    assert resp.status_code == HTTPStatus.METHOD_NOT_ALLOWED, \
        f"expected 405, got {resp.status_code}: {resp.text}"


# ---------------------------------------------------------------------------
# 6. Ingestion Auth — Org Token
# ---------------------------------------------------------------------------


def test_ingest_with_org_token_succeeds(
    client: OpenObserveClient, temp_token: dict
):
    """Ingest using org_id:o2oi_token as Basic auth."""
    tc = _token_client(ORG_ID, temp_token["token"])
    stream = unique_name("ingest")
    try:
        resp = tc.post(
            f"{stream}/_json",
            json=[{"ts": 0, "message": "org-token ingest"}],
        )
        assert resp.status_code == HTTPStatus.OK, resp.text
        body = resp.json()
        assert body["status"][0]["successful"] == 1, body
    finally:
        client.streams.delete(stream)


def test_ingest_with_disabled_token_fails(
    client: OpenObserveClient, temp_token: dict
):
    """Disabled org token is rejected on ingestion."""
    # disable
    client.patch(
        f"ingestion-tokens/{temp_token['name']}",
        json={"enabled": False},
    )
    tc = _token_client(ORG_ID, temp_token["token"])
    resp = tc.post(
        "disabled_test/_json",
        json=[{"ts": 0, "message": "should fail"}],
    )
    assert resp.status_code == HTTPStatus.UNAUTHORIZED, \
        f"expected 401, got {resp.status_code}: {resp.text}"

    # Re-enable to leave the token in its original state
    client.patch(
        f"ingestion-tokens/{temp_token['name']}",
        json={"enabled": True},
    )


def test_ingest_with_nonexistent_token_fails(client: OpenObserveClient):
    """A random o2oi_ token that does not exist returns 401."""
    tc = _token_client(ORG_ID, "o2oi_" + "x" * 32)
    resp = tc.post(
        "fake_token_test/_json",
        json=[{"ts": 0, "message": "bad token"}],
    )
    assert resp.status_code == HTTPStatus.UNAUTHORIZED, \
        f"expected 401, got {resp.status_code}: {resp.text}"


def test_ingest_wrong_org_with_valid_token_fails(
    client: OpenObserveClient, temp_token: dict
):
    """Using a valid token from org-A to ingest into org-B returns 401."""
    tc = _token_client("wrongorg", temp_token["token"])
    resp = tc.post(
        "cross_org/_json",
        json=[{"ts": 0, "message": "wrong org"}],
    )
    assert resp.status_code == HTTPStatus.UNAUTHORIZED, \
        f"expected 401, got {resp.status_code}: {resp.text}"


def test_org_token_blocked_on_search(
    client: OpenObserveClient, temp_token: dict
):
    """Org token returns 401 on the search endpoint."""
    tc = _token_client(ORG_ID, temp_token["token"])
    resp = tc.post(
        "_search",
        json={
            "query": {
                "sql": 'SELECT * FROM "nonexistent" LIMIT 1',
                "start_time": 0,
                "end_time": 1,
                "from": 0,
                "size": 1,
                "quick_mode": False,
            }
        },
    )
    assert resp.status_code == HTTPStatus.UNAUTHORIZED, \
        f"expected 401 on search, got {resp.status_code}: {resp.text}"


def test_org_token_blocked_on_dashboards(
    client: OpenObserveClient, temp_token: dict
):
    """Org token returns 401 on the dashboards endpoint."""
    tc = _token_client(ORG_ID, temp_token["token"])
    resp = tc.get("dashboards")
    assert resp.status_code == HTTPStatus.UNAUTHORIZED, \
        f"expected 401 on dashboards, got {resp.status_code}: {resp.text}"


# ---------------------------------------------------------------------------
# 7. Backward Compatibility
# ---------------------------------------------------------------------------


def test_ingest_with_user_password_still_works(client: OpenObserveClient):
    """Root user + password ingestion still works (pre-PR behaviour)."""
    stream = unique_name("bwpwd")
    try:
        resp = client.post(
            f"{stream}/_json",
            json=[{"ts": 0, "message": "password auth"}],
        )
        assert resp.status_code == HTTPStatus.OK, resp.text
        assert resp.json()["status"][0]["successful"] == 1
    finally:
        client.streams.delete(stream)


def test_ingest_with_non_o2oi_service_account_token(
    client: OpenObserveClient,
):
    """A non-o2oi_ user token falls through to user lookup and works."""
    import base64

    from support.factories import unique_email

    email = unique_email("bwsa")
    sa_resp = client.post(
        "service_accounts",
        json={
            "email": email,
            "organization": ORG_ID,
            "first_name": "bw",
            "last_name": "compat",
        },
    )
    assert sa_resp.status_code == HTTPStatus.OK, sa_resp.text
    sa_token = sa_resp.json()["token"]
    assert not sa_token.startswith("o2oi_"), \
        f"service account token should not have o2oi_ prefix: {sa_token[:10]}"

    try:
        stream = unique_name("bwsa")
        auth = base64.b64encode(f"{email}:{sa_token}".encode()).decode()
        resp = client.request(
            "POST",
            f"{stream}/_json",
            headers={"Authorization": f"Basic {auth}"},
            json=[{"ts": 0, "message": "sa token"}],
        )
        assert resp.status_code == HTTPStatus.OK, \
            f"non-o2oi_ token should work: {resp.status_code} {resp.text}"
    finally:
        client.streams.delete(stream)
        client.delete(f"service_accounts/{email}")


# ---------------------------------------------------------------------------
# 8. Multi-token scenarios
# ---------------------------------------------------------------------------


def test_create_five_tokens_all_visible_in_list(client: OpenObserveClient):
    """Create 5 tokens in the same org; all appear in list."""
    created = []
    for _ in range(5):
        name = unique_name("multi")
        resp = client.post("ingestion-tokens", json=_token_payload(name))
        assert resp.status_code == HTTPStatus.OK, resp.text
        created.append(resp.json()["data"]["name"])

    list_resp = client.get("ingestion-tokens")
    list_names = [t["name"] for t in list_resp.json()["data"]]
    for name in created:
        assert name in list_names, f"{name} missing from list"


def test_disable_one_token_others_remain_enabled(client: OpenObserveClient):
    """Disabling one token does not affect others."""
    # create two tokens
    t1 = unique_name("t1")
    t2 = unique_name("t2")
    for name in (t1, t2):
        resp = client.post("ingestion-tokens", json=_token_payload(name))
        assert resp.status_code == HTTPStatus.OK, resp.text

    # disable t1
    client.patch(f"ingestion-tokens/{t1}", json={"enabled": False})

    # verify
    list_resp = client.get("ingestion-tokens")
    states = {t["name"]: t["enabled"] for t in list_resp.json()["data"]}
    assert states.get(t1) is False, f"{t1} should be disabled: {states}"
    assert states.get(t2) is True, f"{t2} should remain enabled: {states}"


# ---------------------------------------------------------------------------
# 9. Security / validation
# ---------------------------------------------------------------------------


def test_sql_injection_in_token_name_rejected(client: OpenObserveClient):
    """SQL injection attempt in token name is rejected by validation."""
    resp = client.post(
        "ingestion-tokens",
        json=_token_payload("'; DROP TABLE tokens--"),
    )
    assert resp.status_code == HTTPStatus.BAD_REQUEST, \
        f"SQL injection name should be 400, got {resp.status_code}: {resp.text}"
    assert "alphanumeric" in resp.json().get("message", ""), resp.text


# ---------------------------------------------------------------------------
# 10. Backward Compatibility — non-ingestion endpoints
# ---------------------------------------------------------------------------
# Org tokens (o2oi_) are blocked on non-ingestion endpoints (search, dashboards).
# User passwords and non-o2oi_ tokens must still succeed on those same endpoints.
# Without these tests, a bug that blocks ALL auth on search/dashboards would be
# masked — the org-token blocking tests would pass but backward compat is broken.


def test_user_password_on_search_succeeds(client: OpenObserveClient):
    """User password auth must still work on search (unlike org tokens which get 401)."""
    from support.factories import time_window

    start, end = time_window(minutes=15)
    resp = client.post(
        "_search",
        json={
            "query": {
                "sql": 'SELECT * FROM "stream_pytest_data" LIMIT 1',
                "start_time": start,
                "end_time": end,
                "from": 0,
                "size": 1,
                "quick_mode": False,
            }
        },
    )
    assert resp.status_code == HTTPStatus.OK, \
        f"user password on search should succeed, got {resp.status_code}: {resp.text}"


def test_user_password_on_dashboards_succeeds(client: OpenObserveClient):
    """User password auth must still work on dashboards (unlike org tokens)."""
    resp = client.get("dashboards")
    assert resp.status_code == HTTPStatus.OK, \
        f"user password on dashboards should succeed, got {resp.status_code}: {resp.text}"


def test_non_o2oi_token_not_blocked_on_search(client: OpenObserveClient):
    """Non-o2oi_ token must not be blocked by the o2oi_ prefix check on search.

    Org tokens (o2oi_) get 401 on search. Non-o2oi_ tokens must fall through
    to user auth. Service accounts without search permissions get 403, not 401
    — proving the prefix check did not catch them.
    """
    import base64

    from support.factories import unique_email

    email = unique_email("bwsrch")
    sa_resp = client.post(
        "service_accounts",
        json={
            "email": email,
            "organization": ORG_ID,
            "first_name": "bw",
            "last_name": "search",
        },
    )
    assert sa_resp.status_code == HTTPStatus.OK, sa_resp.text
    sa_token = sa_resp.json()["token"]
    assert not sa_token.startswith("o2oi_"), \
        f"service account token should not have o2oi_ prefix: {sa_token[:10]}"

    try:
        auth = base64.b64encode(f"{email}:{sa_token}".encode()).decode()
        resp = client.request(
            "POST",
            "_search",
            headers={"Authorization": f"Basic {auth}"},
            json={
                "query": {
                    "sql": 'SELECT * FROM "nonexistent" LIMIT 1',
                    "start_time": 0,
                    "end_time": 1,
                    "from": 0,
                    "size": 1,
                    "quick_mode": False,
                }
            },
        )
        assert resp.status_code != HTTPStatus.UNAUTHORIZED, \
            f"non-o2oi_ token should not get 401 on search, got {resp.status_code}: {resp.text}"
    finally:
        client.delete(f"service_accounts/{email}")


def test_non_o2oi_token_not_blocked_on_dashboards(client: OpenObserveClient):
    """Non-o2oi_ token must not be blocked by the o2oi_ prefix check on dashboards.

    Org tokens (o2oi_) get 401 on dashboards. Non-o2oi_ tokens must fall
    through to user auth (even if the SA lacks dashboard permissions → 403).
    """
    import base64

    from support.factories import unique_email

    email = unique_email("bwdash")
    sa_resp = client.post(
        "service_accounts",
        json={
            "email": email,
            "organization": ORG_ID,
            "first_name": "bw",
            "last_name": "dash",
        },
    )
    assert sa_resp.status_code == HTTPStatus.OK, sa_resp.text
    sa_token = sa_resp.json()["token"]
    assert not sa_token.startswith("o2oi_"), \
        f"service account token should not have o2oi_ prefix: {sa_token[:10]}"

    try:
        auth = base64.b64encode(f"{email}:{sa_token}".encode()).decode()
        resp = client.request(
            "GET",
            "dashboards",
            headers={"Authorization": f"Basic {auth}"},
        )
        assert resp.status_code != HTTPStatus.UNAUTHORIZED, \
            f"non-o2oi_ token should not get 401 on dashboards, got {resp.status_code}: {resp.text}"
    finally:
        client.delete(f"service_accounts/{email}")
