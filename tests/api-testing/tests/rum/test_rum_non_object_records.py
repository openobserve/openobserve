"""RUM intake answers 400 for a record that is not a JSON object (#14797).

The RUM routes add their extra fields (`ip`, `geo_info`, `user_agent` and the `oo*` query
parameters) to every NDJSON record. A JSON array or a scalar line used to panic there, so the
client got no response at all and nothing reached the access log.
"""

from __future__ import annotations

import json
import uuid

import pytest
import requests

from support.client import OpenObserveClient

ORG_ID = "default"
RECORD = {
    "application": {"id": "1"},
    "service": "pytest-14797",
    "source": "browser",
    "type": "view",
    "view": {"url": "http://127.0.0.1:5173/"},
}


def _rum_token(client: OpenObserveClient) -> str:
    resp = client.get("rumtoken")
    assert resp.status_code == 200, resp.text
    return resp.json()["data"]["rum_token"]


def _post(client: OpenObserveClient, route: str, body: str) -> requests.Response:
    return requests.post(
        f"{client.base_url}rum/v1/{ORG_ID}/{route}",
        params={"oo-api-key": _rum_token(client), "oosource": "browser", "oo-request-id": str(uuid.uuid4())},
        data=body,
        headers={"Content-Type": "text/plain"},
        timeout=10,
    )


@pytest.mark.parametrize("route", ["rum", "logs"])
@pytest.mark.parametrize(
    "body, kind",
    [
        ("[]", "an array"),
        (f"[{json.dumps(RECORD)}]", "an array"),
        ("123", "a number"),
        (f"{json.dumps(RECORD)}\n[]", "an array"),
    ],
    ids=["empty-array", "array-of-records", "scalar", "record-then-array"],
)
def test_a_record_that_is_not_an_object_is_a_bad_request(client: OpenObserveClient, route, body, kind):
    resp = _post(client, route, body)
    assert resp.status_code == 400, f"#14797: expected 400, got {resp.status_code} {resp.text}"
    assert resp.json()["message"] == f"Error# Failed processing: a record must be a JSON object, got {kind}"


@pytest.mark.parametrize("route", ["rum", "logs"])
def test_an_object_record_is_still_accepted(client: OpenObserveClient, route):
    resp = _post(client, route, json.dumps(RECORD))
    # 202 Accepted: the RUM SDKs drop the batch on any non-202 intake response.
    assert resp.status_code == 202, f"expected 202, got {resp.status_code} {resp.text}"
