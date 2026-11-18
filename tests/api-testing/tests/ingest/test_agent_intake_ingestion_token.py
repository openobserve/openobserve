"""The `/datadog/{org}` agent intake accepts only that org's `o2oi_` ingestion token (#16596)."""

from __future__ import annotations

import os
import uuid

import pytest
import requests

from support.client import OpenObserveClient
from support.factories import search_payload, time_window, unique_name
from support.wait import wait_until

KEY_HEADER = "DD-API-KEY"


@pytest.fixture(scope="module")
def ingestion_token(client: OpenObserveClient) -> str:
    # tokens have no DELETE endpoint, so one per module keeps the leftovers to one
    resp = client.post("ingestion-tokens", json={"name": unique_name("pyt_intake"), "description": ""})
    assert resp.status_code in (200, 201), f"token create failed: {resp.status_code} {resp.text}"
    token = resp.json()["data"]["token"]
    assert token.startswith("o2oi_"), token
    return token


@pytest.fixture(scope="module")
def other_org(client: OpenObserveClient) -> str:
    # orgs have no working DELETE yet (#15241), so one per module keeps the leftovers to one
    resp = client.post("api/organizations", json={"name": unique_name("pytintakeorg")}, prefix="")
    assert resp.status_code == 200, f"org create failed: {resp.status_code} {resp.text}"
    identifier = resp.json().get("identifier")
    assert identifier, resp.text
    return identifier


def _intake(client: OpenObserveClient, method: str, path: str, headers: dict[str, str], **kwargs) -> requests.Response:
    # no basic auth, so only the intake's own key can let the request in
    url = f"{client.base_url.rstrip('/')}/datadog/{path}"
    return requests.request(method, url, headers=headers, timeout=30, **kwargs)


def test_validate_accepts_the_orgs_ingestion_token(client: OpenObserveClient, ingestion_token: str):
    """openobserve#16596: the agent's startup check must pass with an `o2oi_` token of the org in the path."""
    resp = _intake(client, "GET", f"{client.org}/api/v1/validate", {KEY_HEADER: ingestion_token})
    assert resp.status_code == 200, f"{resp.status_code} {resp.text}"
    assert resp.json() == {"valid": True}, resp.text


@pytest.mark.parametrize(
    ("case", "key"),
    [
        pytest.param("not-o2oi", os.environ.get("ZO_ROOT_USER_PASSWORD", "x"), id="not-an-ingestion-token"),
        pytest.param("unknown", "o2oi_doesnotexist0000", id="unknown-token"),
        pytest.param("missing", "", id="missing-key"),
    ],
)
def test_validate_refuses_any_other_key(client: OpenObserveClient, case: str, key: str):
    """openobserve#16596: a key that is not this org's ingestion token must be a 403, which the agent does not retry."""
    headers = {} if key == "" else {KEY_HEADER: key}
    resp = _intake(client, "GET", f"{client.org}/api/v1/validate", headers)
    assert resp.status_code == 403, f"{case}: {resp.status_code} {resp.text}"


def test_validate_refuses_a_token_of_another_existing_org(
    client: OpenObserveClient, ingestion_token: str, other_org: str
):
    """openobserve#16596: a token is bound to its org, so another org that exists and has its own token must refuse it."""
    resp = client.post(
        "ingestion-tokens", json={"name": unique_name("pyt_intake_other"), "description": ""}, org=other_org
    )
    assert resp.status_code in (200, 201), f"token create in {other_org} failed: {resp.status_code} {resp.text}"
    own = _intake(client, "GET", f"{other_org}/api/v1/validate", {KEY_HEADER: resp.json()["data"]["token"]})
    assert own.status_code == 200, f"the other org must accept its own token first: {own.status_code} {own.text}"
    resp = _intake(client, "GET", f"{other_org}/api/v1/validate", {KEY_HEADER: ingestion_token})
    assert resp.status_code == 403, f"{resp.status_code} {resp.text}"


def test_the_intake_key_does_not_authenticate_other_routes(client: OpenObserveClient, ingestion_token: str):
    """openobserve#16596: the header is parsed only by the intake, so it must not open the regular ingest API."""
    url = client.url(f"{unique_name('pyt_intake_other')}/_json")
    resp = requests.post(url, json=[{"m": 1}], headers={KEY_HEADER: ingestion_token}, timeout=30)
    assert resp.status_code == 401, f"{resp.status_code} {resp.text}"


def test_logs_sent_with_the_token_are_stored(client: OpenObserveClient, ingestion_token: str):
    """openobserve#16596: a log line posted to `/datadog/{org}/api/v2/logs` lands in the org's default stream."""
    marker = f"pyt-intake-{uuid.uuid4().hex}"
    body = [{"message": marker, "service": "pyt-intake", "ddsource": "pytest", "ddtags": "env:ci", "status": "warn"}]
    resp = _intake(client, "POST", f"{client.org}/api/v2/logs", {KEY_HEADER: ingestion_token}, json=body)
    assert resp.status_code in (200, 202), f"{resp.status_code} {resp.text}"

    def stored() -> list[dict] | None:
        start, end = time_window(minutes=30)
        sql = f"SELECT * FROM \"default\" WHERE body = '{marker}'"
        r = client.post("_search", json=search_payload(sql, start_time=start, end_time=end + 60_000_000))
        return r.json().get("hits") if r.status_code == 200 and r.json().get("hits") else None

    hits = wait_until(stored, timeout=30, msg=f"the intake log {marker} was not stored")
    assert len(hits) == 1, hits
    # the agent's `message` and `status` are stored as the log body and severity
    assert (hits[0].get("service"), hits[0].get("severity")) == ("pyt-intake", "warn"), hits[0]
