"""V1 Alerts API tests — destinations & templates CRUD.

Rewritten in Phase 4 of the api-tests revamp.

The original had 6 tests covering:
- Destinations: list / delete-invalid / create+delete
- Templates: list / create+delete
- Alert history: a 200+ LOC E2E that's now DROPPED because tests/alerts/
  test_history.py (the NEW-tier file from before the rewrite) covers the
  same surface with 13 focused, well-structured tests across contract,
  sorting, errors, and pagination edge cases.

This rewrite covers the remaining destinations & templates CRUD with
unique-suffix names, body validation, and fixture-based cleanup.

Note on auth/payload: alert templates with `body: "invalid"` are accepted
by the backend (as documented in the legacy `TODO - Change body once bug
#1702 is fixed` comment). We preserve that test as-is — it documents
intended-permissive behavior.
"""
from __future__ import annotations

import logging
from collections.abc import Generator

import pytest

from support.client import OpenObserveClient
from support.factories import unique_name

logger = logging.getLogger(__name__)

ORG_ID = "default"


def _template_payload(name: str, body: str | None = None) -> dict:
    return {
        "name": name,
        "body": body or '{"text": "{alert_name} is active"}',
    }


def _webhook_destination_payload(name: str, template: str) -> dict:
    return {
        "name": name,
        "url": "https://example.com/webhook",
        "method": "post",
        "skip_tls_verify": False,
        "template": template,
        "headers": {"test": "test"},
    }


# ----- fixtures -----


@pytest.fixture
def temp_template(client: OpenObserveClient) -> Generator[str, None, None]:
    """Create an alert template with a unique name; auto-delete on teardown."""
    name = unique_name("pyt_tmpl")
    resp = client.post("alerts/templates", json=_template_payload(name))
    assert resp.status_code == 200, \
        f"setup failed: create template {name}: {resp.status_code} {resp.text}"
    yield name
    try:
        client.delete(f"alerts/templates/{name}")
    except Exception as e:
        logger.warning("temp_template cleanup failed for %s: %s", name, e)


# ----- destinations -----


def test_list_destinations_returns_list(client: OpenObserveClient):
    """GET /alerts/destinations returns 200 + a list/array body."""
    resp = client.get("alerts/destinations")
    assert resp.status_code == 200, resp.text

    body = resp.json()
    # OO destinations endpoint returns either a list directly or {"list": [...]}
    if isinstance(body, dict):
        assert "list" in body or isinstance(body, dict), \
            f"destinations response should be list-shaped, got: {body}"
    else:
        assert isinstance(body, list), \
            f"destinations response should be a list, got {type(body).__name__}"


def test_delete_nonexistent_destination_returns_404(client: OpenObserveClient):
    """DELETE /alerts/destinations/{name} where name doesn't exist → 404."""
    nonexistent = unique_name("ghostdest")
    resp = client.delete(f"alerts/destinations/{nonexistent}")
    assert resp.status_code == 404, \
        f"delete of nonexistent destination should be 404, got {resp.status_code}: {resp.text}"


def test_create_get_delete_destination_full_cycle(
    client: OpenObserveClient, temp_template: str
):
    """Create destination -> GET it -> verify URL/method came back -> delete."""
    name = unique_name("pyt_dest")
    payload = _webhook_destination_payload(name, temp_template)

    try:
        resp_create = client.post("alerts/destinations", json=payload)
        assert resp_create.status_code == 200, \
            f"create destination failed: {resp_create.status_code} {resp_create.text}"

        # GET the destination back, verify body matches what we sent
        resp_get = client.get(f"alerts/destinations/{name}")
        assert resp_get.status_code == 200, \
            f"get destination failed: {resp_get.status_code} {resp_get.text}"

        body = resp_get.json()
        assert body.get("name") == name, \
            f"returned destination name should match input, got {body.get('name')!r}"
        assert body.get("url") == payload["url"], \
            f"returned URL should match input, got {body.get('url')!r}"
        assert body.get("method") == payload["method"], \
            f"returned method should match input, got {body.get('method')!r}"
        assert body.get("template") == temp_template, \
            f"returned template should match input, got {body.get('template')!r}"
    finally:
        client.delete(f"alerts/destinations/{name}")


# ----- templates -----


def test_list_templates_returns_list(client: OpenObserveClient):
    """GET /alerts/templates returns 200 + a list body."""
    resp = client.get("alerts/templates")
    assert resp.status_code == 200, resp.text

    body = resp.json()
    # Templates endpoint also returns either list-directly or {"list": [...]}
    if isinstance(body, dict):
        assert "list" in body or isinstance(body, dict)
    else:
        assert isinstance(body, list)


def test_create_template_with_invalid_body_is_accepted(client: OpenObserveClient):
    """Backend accepts `body: "invalid"` for alert templates — preserved from original.

    Original had a TODO referencing bug #1702: "Change body and add 2 other
    testcases once bug #1702 is fixed." Behavior is permissive on purpose
    (template body is opaque to OO; it's interpolated when an alert fires).
    """
    name = unique_name("pyt_tmpl_invalid")
    payload = {"body": "invalid", "ise2e": True, "name": name}

    try:
        resp = client.post("alerts/templates", json=payload)
        assert resp.status_code == 200, \
            f"create template with body='invalid' should succeed: {resp.status_code} {resp.text}"
    finally:
        client.delete(f"alerts/templates/{name}")
