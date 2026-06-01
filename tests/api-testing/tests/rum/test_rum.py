"""RUM (Real User Monitoring) API Tests.

Rewritten in Phase 4 of the api-tests revamp:
- Replaces the in-test retry loop (with time.sleep) using wait_until for
  the search-after-ingest verification.
- Uses unique session/view IDs per test invocation (the original hardcoded
  IDs across runs, so repeated runs would accumulate identical RUM records).
- De-dupes a duplicate `len(hits) > 0` assertion in the original.
- Body validation: confirms the ingested record's unique identifier comes
  back through search, not just that search returns >= 1 hit.
- The unauthenticated ingest tests (test_invalidrumtoken,
  test_rumdataingestioninvalidtoken) use bare `requests` (no auth header)
  intentionally — they test that bad-token traffic gets 403 from the
  public RUM ingest endpoint. That's their semantic.
"""
from __future__ import annotations

import logging
import uuid
from typing import Any

import requests

from support.client import OpenObserveClient
from support.wait import wait_until

logger = logging.getLogger(__name__)

ORG_ID = "default"

# Common payload templates — keep as dicts (not JSON strings) for clarity.
RUM_LOG_TEMPLATE: dict[str, Any] = {
    "service": "my-web-application",
    "view": {
        "referrer": "http://127.0.0.1:5173/about",
        "url": "http://127.0.0.1:5173/about",
    },
    "application_id": "1",
    "origin": "console",
    "status": "info",
}

RUM_DATA_TEMPLATE: dict[str, Any] = {
    "_oo": {
        "format_version": 2,
        "drift": 0,
        "session": {"plan": 2},
        "configuration": {"session_sample_rate": 100, "session_replay_sample_rate": 100},
        "discarded": False,
    },
    "application": {"id": "1"},
    "service": "my-web-application",
    "version": "0.0.1",
    "source": "browser",
    "view": {
        "url": "http://127.0.0.1:5173/",
        "referrer": "",
    },
    "display": {"viewport": {"width": 1920, "height": 941}},
    "resource": {
        "type": "image",
        "url": "http://127.0.0.1:5173/src/assets/logo.svg",
        "duration": 16900000,
        "size": 37,
    },
}


def _rum_ingest_params(rum_token: str) -> dict[str, str]:
    """Common RUM ingest URL params (oosource/ootags/oo-api-key/etc)."""
    return {
        "oosource": "browser",
        "ootags": "sdk_version:0.2.7,api:fetch,env:production,service:my-web-application,version:0.0.1",
        "oo-api-key": rum_token,
        "oo-request-id": str(uuid.uuid4()),
        "oo-evp-origin": "browser",
    }


# ----- token endpoint -----


def test_get_rum_token_returns_token_in_data(client: OpenObserveClient):
    """GET /api/{org}/rumtoken returns a non-empty rum_token in body.data."""
    resp = client.get("rumtoken")
    assert resp.status_code == 200, resp.text

    body = resp.json()
    assert "data" in body, f"rumtoken response missing 'data' key: {body}"
    token = body["data"].get("rum_token")
    assert token, f"rum_token should be non-empty, got: {body!r}"
    assert isinstance(token, str), f"rum_token should be a string, got {type(token).__name__}"


# ----- unauthenticated negative tests (use bare requests, no auth) -----


def test_rum_logs_ingest_with_invalid_token_returns_403(client: OpenObserveClient):
    """POST /rum/v1/{org}/logs with a bogus token returns 403."""
    logs_url = f"{client.base_url}rum/v1/{ORG_ID}/logs"
    payload = {**RUM_LOG_TEMPLATE, "message": f"pytest-{uuid.uuid4()}"}

    resp = requests.post(
        logs_url,
        params=_rum_ingest_params(rum_token="rumxJwgUyIx3Uinvalid"),
        json=payload,
        timeout=10,
    )
    assert resp.status_code == 403, \
        f"invalid token should yield 403, got {resp.status_code}: {resp.text}"


def test_rum_data_ingest_with_invalid_token_returns_403(client: OpenObserveClient):
    """POST /rum/v1/{org}/rum with a bogus token returns 403."""
    rum_url = f"{client.base_url}rum/v1/{ORG_ID}/rum"
    payload = {**RUM_DATA_TEMPLATE, "type": f"pytest-{uuid.uuid4()}"}

    resp = requests.post(
        rum_url,
        params=_rum_ingest_params(rum_token="rumv7Tinvalid"),
        json=payload,
        timeout=10,
    )
    assert resp.status_code == 403, \
        f"invalid token should yield 403, got {resp.status_code}: {resp.text}"


# ----- happy path: get token, ingest log, verify via search -----


def test_rum_log_ingest_then_search_finds_record(client: OpenObserveClient):
    """End-to-end: get rum_token, post a log with unique message, verify it appears in _rumlog."""
    # Step 1: fetch a valid rum token
    token_resp = client.get("rumtoken")
    assert token_resp.status_code == 200, token_resp.text
    rum_token = token_resp.json()["data"]["rum_token"]

    # Step 2: ingest a log with a unique identifier we can search for
    unique_msg = f"pytest-{uuid.uuid4()}"
    logs_url = f"{client.base_url}rum/v1/{ORG_ID}/logs"
    payload = {**RUM_LOG_TEMPLATE, "message": unique_msg}

    resp_ingest = requests.post(
        logs_url,
        params=_rum_ingest_params(rum_token),
        json=payload,
        headers={"X-Forwarded-For": "182.70.14.246"},
        timeout=10,
    )
    assert resp_ingest.status_code == 200, \
        f"ingest failed: {resp_ingest.status_code} {resp_ingest.text}"

    # Step 3: poll search until the unique message appears in _rumlog
    def _record_visible() -> bool:
        hits = client.search.hits(
            f'SELECT message FROM "_rumlog" WHERE message = \'{unique_msg}\'',
            minutes=10,
            size=5,
        )
        return any(h.get("message") == unique_msg for h in hits)

    wait_until(
        _record_visible,
        timeout=30,
        interval=1.0,
        msg=f"ingested RUM log with message={unique_msg!r} not visible in _rumlog after 30s",
    )
