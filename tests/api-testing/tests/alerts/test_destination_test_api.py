"""Alert destination "Test" endpoint  [regression #10202].

Two halves of the bug, both fixed in PR #10529:
  - a prebuilt EMAIL destination's Test button did nothing, because the
    endpoint answered "Unsupported destination type for testing: email";
  - the UI reported an error even when the call had in fact succeeded, so the
    response shape (`success` / `statusCode` / `error`) is part of the contract
    and is asserted here rather than only in the browser.

Email delivery itself needs SMTP, which a test instance has no reason to carry.
The regression is that `type: "email"` is ROUTED at all -- so these assert the
request is handled on its own terms (recipient validation, a real delivery
error) and never falls through to the unsupported-type arm.
"""
from __future__ import annotations

import logging
import uuid

from support.client import OpenObserveClient

logger = logging.getLogger(__name__)

UNSUPPORTED = "Unsupported destination type for testing"


def _test_destination(client: OpenObserveClient, payload: dict) -> dict:
    resp = client.post(
        "alerts/destinations/test",
        json=payload,
        raise_for_status=False,
    )
    assert resp.status_code == 200, \
        f"test-destination should answer 200 with a result body, got {resp.status_code}: {resp.text}"
    return resp.json()


def test_email_destination_type_is_routed_not_rejected(client: OpenObserveClient):
    """`type: "email"` reaches the email path instead of the unsupported arm."""
    body = _test_destination(
        client,
        {
            "type": "email",
            "recipients": [f"qa-{uuid.uuid4().hex[:8]}@example.com"],
            "body": "regression #10202",
        },
    )

    assert UNSUPPORTED not in (body.get("error") or ""), \
        f"email destination must be supported for testing, got: {body!r}"
    assert isinstance(body.get("success"), bool), \
        f"response must carry a boolean `success`, got: {body!r}"


def test_email_destination_without_recipients_is_rejected_on_its_own_terms(
    client: OpenObserveClient,
):
    """Missing recipients is an email-specific validation, not a type rejection."""
    body = _test_destination(client, {"type": "email", "recipients": []})

    assert body.get("success") is False, f"expected failure, got: {body!r}"
    assert "recipient" in (body.get("error") or "").lower(), \
        f"expected a recipient-specific error, got: {body!r}"


def test_http_destination_without_url_is_rejected(client: OpenObserveClient):
    """The HTTP path still validates its own required field."""
    body = _test_destination(client, {"type": "http", "url": ""})

    assert body.get("success") is False, f"expected failure, got: {body!r}"
    assert "url" in (body.get("error") or "").lower(), \
        f"expected a url-specific error, got: {body!r}"


def test_unsupported_destination_type_still_reports_unsupported(client: OpenObserveClient):
    """Negative control: a type with no test path keeps saying so.

    Without this, the email assertions above would pass on a build where the
    unsupported-type arm was simply deleted.
    """
    body = _test_destination(client, {"type": "sns", "url": "arn:aws:sns:us-east-1:1:x"})

    assert body.get("success") is False, f"expected failure, got: {body!r}"
    assert UNSUPPORTED in (body.get("error") or ""), \
        f"expected the unsupported-type error, got: {body!r}"
