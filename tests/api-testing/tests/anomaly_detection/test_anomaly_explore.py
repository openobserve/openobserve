from __future__ import annotations

import uuid
from http import HTTPStatus

import pytest

from support.client import OpenObserveClient
from support.factories import unique_name
from support.wait import wait_until

STREAM = "anomaly_explore_api"
PASSWORD = "Complexpass#123"
RESPONSE_KEYS = {
    "url", "label", "target", "filter_applied", "name", "measure", "stream", "filter",
    "state", "state_source", "summary", "model_version", "last_detection_run", "cursor_us",
    "no_new_data_since_us", "window", "explore_start_us",
}


@pytest.fixture(scope="module", autouse=True)
def _require_anomaly_detection(client: OpenObserveClient) -> None:
    resp = client.get("anomaly_detection", raise_for_status=False)
    if resp.status_code == HTTPStatus.NOT_FOUND:
        pytest.skip("anomaly detection is not available on this build (OSS)")


@pytest.fixture
def detector(client: OpenObserveClient):
    body = {
        "name": unique_name("anomexplore"),
        "stream_name": STREAM,
        "stream_type": "logs",
        "query_mode": "filters",
        "filters": [],
        "custom_sql": None,
        "detection_function": "count",
        "detection_function_field": None,
        "histogram_interval": "15m",
        "schedule_interval": "15m",
        "detection_window_seconds": 3600,
        "training_window_days": 7,
        "retrain_interval_days": 7,
        "percentile": 97,
        "alert_enabled": False,
        "enabled": True,
        "folder_id": "default",
    }
    resp = client.post("anomaly_detection", json=body)
    assert resp.status_code == HTTPStatus.OK, resp.text
    created = resp.json()
    try:
        yield created
    finally:
        client.delete(f"anomaly_detection/{created['anomaly_id']}")


def _explore(c: OpenObserveClient, anomaly_id: str, **params):
    return c.get(f"anomaly_detection/{anomaly_id}/explore", params={"folder": "default", **params})


def _user(client: OpenObserveClient, created: list[str]) -> OpenObserveClient:
    email = f"anomexplore_{uuid.uuid4().hex[:8]}@test.invalid"
    resp = client.users.create({
        "email": email, "password": PASSWORD, "first_name": "Anomaly",
        "last_name": "Explore", "role": "user", "organization": client.org,
    })
    if resp.status_code != HTTPStatus.OK and "open-fga" in resp.text.lower():
        pytest.skip("custom roles need OpenFGA on")
    assert resp.status_code == HTTPStatus.OK, resp.text
    created.append(email)
    return OpenObserveClient(email=email, password=PASSWORD, org=client.org)


@pytest.fixture
def plain_user(client: OpenObserveClient):
    if client.get("roles").status_code != HTTPStatus.OK:
        pytest.skip("custom roles need an enterprise build with OpenFGA on")
    created: list[str] = []
    try:
        yield _user(client, created)
    finally:
        for email in created:
            client.users.delete(email)


def test_never_ran_detector_returns_no_runs_and_a_link(client: OpenObserveClient, detector):
    resp = _explore(client, detector["anomaly_id"])
    assert resp.status_code == HTTPStatus.OK, resp.text
    body = resp.json()
    assert RESPONSE_KEYS <= body.keys(), body
    assert body["state"] == "no_runs", body
    assert body["state_source"] == "buckets"
    assert body["window"] is None and body["summary"] is None, body
    assert body["model_version"] == 0, "an untrained detector serves model 0"
    assert body["name"] == detector["name"]
    assert body["stream"] == STREAM and body["target"] == "logs"
    assert "/web/logs" in body["url"], body["url"]
    assert f"from_anomaly={detector['anomaly_id']}" in body["url"], body["url"]
    assert body["label"], body
    assert body["explore_start_us"] > 0


def test_a_point_request_returns_a_link_for_that_bucket(client: OpenObserveClient, detector):
    end = 1_800_000_000_000_000
    start = end - 900_000_000
    resp = _explore(client, detector["anomaly_id"], start=start, end=end, pad=0, model_version=0)
    assert resp.status_code == HTTPStatus.OK, resp.text
    body = resp.json()
    assert body["explore_start_us"] == start, "pad=0 opens the bucket with no lead-in"
    assert f"to={end}" in body["url"], body["url"]


def test_unknown_detector_is_404(client: OpenObserveClient):
    resp = _explore(client, "2ZZZZZZZZZZZZZZZZZZZZZZZZZZ")
    assert resp.status_code == HTTPStatus.NOT_FOUND, resp.text


def test_old_model_version_is_409(client: OpenObserveClient, detector):
    resp = _explore(client, detector["anomaly_id"], model_version=1_700_000_000_000_000)
    assert resp.status_code == HTTPStatus.CONFLICT, resp.text


def test_start_without_end_is_400(client: OpenObserveClient, detector):
    resp = _explore(client, detector["anomaly_id"], start=1)
    assert resp.status_code == HTTPStatus.BAD_REQUEST, resp.text


def test_detector_read_is_enough_and_no_anomalies_stream_grant_is_needed(
    client: OpenObserveClient, detector, plain_user: OpenObserveClient
):
    anomaly_id = detector["anomaly_id"]
    refused = _explore(plain_user, anomaly_id)
    assert refused.status_code == HTTPStatus.FORBIDDEN, refused.text

    role = unique_name("anomexplore_role")
    assert client.post("roles", json={"role": role}).status_code in (200, 201)
    try:
        # Detector read only: no grant on any stream, `_anomalies` included.
        grants = [("afolder:default", "AllowGet"), ("afolder:default", "AllowList")]
        resp = client.put(f"roles/{role}", json={
            "add": [{"object": o, "permission": p} for o, p in grants],
            "remove": [], "add_users": [plain_user.email], "remove_users": [],
        })
        assert resp.status_code == HTTPStatus.OK, resp.text
        # OpenFGA tuple writes are not read-your-writes.
        allowed = wait_until(
            lambda: (r := _explore(plain_user, anomaly_id)).status_code == HTTPStatus.OK and r,
            timeout=30, interval=1, msg="the folder grant never reached OpenFGA",
        )
        assert allowed.json()["name"] == detector["name"]
        stream_read = plain_user.post(
            "_search?type=logs",
            json={"query": {"sql": 'SELECT * FROM "_anomalies"', "start_time": 0,
                            "end_time": 1_900_000_000_000_000, "from": 0, "size": 1}},
        )
        assert stream_read.status_code == HTTPStatus.FORBIDDEN, \
            f"the user must lack _anomalies access for this test to mean anything: {stream_read.text}"
    finally:
        client.delete(f"roles/{role}")
