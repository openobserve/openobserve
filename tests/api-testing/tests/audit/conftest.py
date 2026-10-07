"""Fixtures for the audit-trail redaction suite.

Runs serially and against a deployment with `O2_AUDIT_BATCH_SIZE=1`. At the
default batch size of 500 the audit rows these tests assert on would not be
published for ten minutes, so the module skips with that instruction instead of
timing out one test at a time.
"""
from __future__ import annotations

import logging
import os
import uuid
from collections.abc import Generator

import pytest
import requests

from support.client import OpenObserveClient
from support.factories import unique_email, unique_name, user_payload

from .helpers import PROBE_PASSWORD, AuditTrail

log = logging.getLogger("o2-api.audit")


# The CI shard sets this when it starts the server for this suite. Its presence
# means the prerequisites were arranged on purpose, so a missing trail is a
# failure to investigate — not something to skip past. A silent skip in CI reads
# exactly like coverage, which is the one outcome this suite must not produce.
_SUITE_IS_REQUIRED = "O2_AUDIT_BATCH_SIZE=1" in os.environ.get("SHARD_SERVER_ENV", "")

_UNAVAILABLE = (
    "the _meta audit stream is not searchable. This suite needs an enterprise build with "
    "O2_AUDIT_ENABLED=true (the default since o2-enterprise#2789) and O2_AUDIT_BATCH_SIZE=1 "
    "— at the default batch size of 500, rows are not published for "
    "O2_AUDIT_PUBLISH_INTERVAL (600s) and no test can observe its own request. "
    "It also needs a caller with meta-org read: the trail lives in `_meta`, so CI's root "
    "user works but an ordinary org member does not."
)


@pytest.fixture(scope="module")
def trail(client: OpenObserveClient) -> AuditTrail:
    """The audit reader.

    A probe request goes first: the trail is only searchable once a row has been
    published, and on a fresh instance these tests may be the first thing to
    generate one.

    Skips when run somewhere that was not set up for it, but **fails** when the
    CI shard set the server up and the trail still cannot be read — see
    `_SUITE_IS_REQUIRED`.
    """
    at = AuditTrail(client)
    client.get("settings", raise_for_status=False)  # audited, so it seeds the stream
    if not at.available():
        if _SUITE_IS_REQUIRED:
            raise AssertionError(
                f"{_UNAVAILABLE}\n\nThe shard configured the server for this suite "
                "(SHARD_SERVER_ENV carries O2_AUDIT_BATCH_SIZE=1), so this is a real "
                "failure rather than an unmet prerequisite. Nothing about credential "
                "redaction is being verified until it is fixed."
            )
        pytest.skip(_UNAVAILABLE)
    return at


def _require_cleaned(resp: requests.Response, what: str) -> None:
    """404 counts as cleaned; anything else means the resource is still there."""
    assert resp.status_code in (200, 404), f"could not clean up {what}: {resp.status_code} {resp.text}"


@pytest.fixture
def probe_user(client: OpenObserveClient) -> Generator[str, None, None]:
    """A user created with `PROBE_PASSWORD`, deleted afterwards.

    The create itself is what the password-redaction test inspects, so this
    fixture deliberately does the create rather than leaving it to the test.
    """
    email = unique_email("audit")
    resp = client.post(
        "users",
        json=user_payload(
            email=email, password=PROBE_PASSWORD, first_name="Audit", last_name="Probe"
        ),
        raise_for_status=False,
    )
    assert resp.status_code == 200, f"could not create the probe user: {resp.status_code} {resp.text}"
    yield email
    _require_cleaned(client.delete(f"users/{email}", raise_for_status=False), f"user {email}")


@pytest.fixture
def probe_destination(client: OpenObserveClient) -> Generator[dict, None, None]:
    """An alert destination carrying a webhook URL and a bearer token.

    Yields the payload that was sent, so a test can assert on the exact secret
    strings rather than on a pattern that might match something else.
    """
    template = unique_name("audit_tmpl")
    tmpl = client.post(
        "alerts/templates",
        json={"name": template, "body": '{"text":"{alert_name}"}', "type": "http", "title": ""},
        raise_for_status=False,
    )
    assert tmpl.status_code == 200, f"could not create the template: {tmpl.status_code} {tmpl.text}"

    payload = {
        "name": unique_name("audit_dest"),
        "url": "https://hooks.slack.com/services/T000AUDIT/B000AUDIT/zAuditProbeWebhookToken",
        "method": "post",
        "template": template,
        "type": "http",
        "headers": {"Authorization": "Bearer audit-probe-bearer-token-9f3c"},
    }
    resp = client.post("alerts/destinations", json=payload, raise_for_status=False)
    assert resp.status_code == 200, f"could not create the destination: {resp.status_code} {resp.text}"

    yield payload

    _require_cleaned(
        client.delete(f"alerts/destinations/{payload['name']}", raise_for_status=False),
        f"destination {payload['name']}",
    )
    _require_cleaned(
        client.delete(f"alerts/templates/{template}", raise_for_status=False),
        f"template {template}",
    )


@pytest.fixture
def nested_alert(client: OpenObserveClient, probe_destination: dict) -> Generator[dict, None, None]:
    """An alert whose `context_attributes` nests a credential beside an identifier.

    Exists because the routes that take a free-form object are typed: `POST
    /{org}/settings` answers 400 "No valid field found" for arbitrary keys, and
    audit records only 2xx — so a rejected request leaves no row at all and any
    assertion about it is vacuous. An alert create does take a free-form map,
    one level down, and answers 200.

    Yields the two marker strings so the test asserts on exact values.
    """
    secret = f"nestedsecret{uuid.uuid4().hex[:8]}"
    identifier = f"keptident{uuid.uuid4().hex[:8]}"
    stream = unique_name("audit_probe_stream")
    client.post(f"{stream}/_json", json=[{"i": 1}], raise_for_status=False)

    name = unique_name("audit_alert")
    payload = {
        "name": name,
        "stream_type": "logs",
        "stream_name": stream,
        "is_real_time": False,
        "query_condition": {"type": "sql", "sql": f'SELECT count(*) as cnt FROM "{stream}"'},
        "trigger_condition": {
            "period": 5, "operator": ">=", "threshold": 1, "frequency": 1, "silence": 10,
        },
        "destinations": [probe_destination["name"]],
        # The payload under test: a credential `*key` next to an identifier `*key`.
        "context_attributes": {"api_key": secret, "group_key": identifier},
        "row_template": "",
        "enabled": False,
    }
    resp = client.post("alerts", json=payload, prefix="api/v2/", raise_for_status=False)
    assert resp.status_code == 200, f"could not create the probe alert: {resp.status_code} {resp.text}"
    alert_id = resp.json().get("id")

    yield {"name": name, "secret": secret, "identifier": identifier}

    if alert_id:
        _require_cleaned(
            client.delete(f"alerts/{alert_id}", prefix="api/v2/", raise_for_status=False),
            f"alert {name}",
        )
    client.delete(f"streams/{stream}?type=logs", raise_for_status=False)
